#!/usr/bin/env python3
"""Capped snowball pull of a multi-relational OpenAlex subgraph.

Stdlib only (urllib + sqlite3), resumable, polite-pool friendly. Seeds are
pinned OpenAlex work IDs — never resolved by search, which is unreliable
(duplicate/variant records, mis-dated metadata, DOI gaps; the canonical
"Attention Is All You Need" record is effectively unreachable by title/DOI).
Resolving + deduping seeds is its own pipeline stage; this puller takes
verified IDs.

The snowball expands each *work* by its references (outgoing) and its top-N
most-cited citing works (incoming), to a bounded depth and work budget — the
same capped expansion the app does at runtime, so the slice stays connected
and navigable. Each fetched work is also *enriched* with its authors, concepts
(the leveled OpenAlex taxonomy), and venue, attached by typed edges. Only works
snowball; attribute nodes attach but never expand the frontier (a shared
concept would otherwise blow it up).

Node types: work | author | concept | venue
Edge kinds: cites | authored_by | has_concept | published_in

Smoke run (safe, ~a dozen-plus API calls):
    python3 ingest/pull_openalex.py

Full run (hours; on the 64GB + GPU box, alongside Neo4j):
    python3 ingest/pull_openalex.py --in-cap 150 --out-cap 200 \
        --max-depth 3 --max-works 200000 --rps 9
"""
import argparse
import json
import os
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.openalex.org/works"
MAILTO = "holleyism@gmail.com"

# Seeds come from seeds.json (written by resolve_seeds.py — stage 0). Falls back
# to this list if that file is absent. Never resolved by search at pull time.
SEEDS_FILE = os.path.join(os.path.dirname(__file__), "seeds.json")
SEEDS_FALLBACK = [
    "W2128084896",  # Hopfield 1982 — associative memory (neuroscience galaxy)
    "W3127151792",  # Ramsauer 2021 — "Hopfield Networks is All You Need" (the bridge)
]


def load_seeds():
    if os.path.exists(SEEDS_FILE):
        with open(SEEDS_FILE) as f:
            return [s["id"] for s in json.load(f)]
    return SEEDS_FALLBACK

WORK_SELECT = ",".join(
    [
        "id",
        "display_name",
        "publication_year",
        "cited_by_count",
        "primary_topic",
        "referenced_works",
        "abstract_inverted_index",
        "authorships",
        "concepts",
        "primary_location",
    ]
)

MAX_AUTHORS = 25  # papers rarely exceed this; guards consortium author lists
CONCEPT_MIN_SCORE = 0.3
MAX_CONCEPTS = 5


class Rate:
    """Crude single-thread rate limiter for the polite pool."""

    def __init__(self, rps):
        self.min_gap = 1.0 / rps
        self.last = 0.0

    def wait(self):
        gap = time.monotonic() - self.last
        if gap < self.min_gap:
            time.sleep(self.min_gap - gap)
        self.last = time.monotonic()


def get(url, rate, tries=4):
    for i in range(tries):
        rate.wait()
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            # Transient — back off and retry.
            if e.code in (429, 500, 502, 503, 504):
                if i < tries - 1:
                    time.sleep(2**i)
                    continue
                raise
            # Other 4xx (404 dangling/merged id, 410 gone, ...) — skip this node
            # rather than crashing the whole crawl; OpenAlex has dead references.
            if 400 <= e.code < 500:
                return None
            raise
        except Exception:
            if i < tries - 1:
                time.sleep(2**i)
                continue
            raise
    return None


def abstract_from_inverted(inv):
    if not inv:
        return None
    pos = {}
    for word, idxs in inv.items():
        for i in idxs:
            pos[i] = word
    text = " ".join(pos[i] for i in sorted(pos))
    return text[:4000] or None


def sid(oid):
    return oid.rsplit("/", 1)[-1]


def db_init(path):
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS nodes(
            id TEXT PRIMARY KEY, type TEXT, name TEXT, props TEXT,
            depth INT, fetched INT DEFAULT 0);
        CREATE TABLE IF NOT EXISTS edges(
            src TEXT, dst TEXT, kind TEXT, PRIMARY KEY(src, dst, kind));
        CREATE TABLE IF NOT EXISTS frontier(id TEXT PRIMARY KEY, depth INT);
        """
    )
    db.commit()
    return db


def upsert(db, oid, ntype, depth, name=None, props=None, fetched=False):
    s = sid(oid)
    db.execute("INSERT OR IGNORE INTO nodes(id, type, depth) VALUES(?, ?, ?)", (s, ntype, depth))
    sets, vals = [], []
    if name is not None:
        sets.append("name=?")
        vals.append(name)
    if props is not None:
        sets.append("props=?")
        vals.append(json.dumps(props))
    if fetched:
        sets.append("fetched=1")
    if sets:
        vals.append(s)
        db.execute(f"UPDATE nodes SET {', '.join(sets)} WHERE id=?", vals)


def add_edge(db, src, dst, kind):
    db.execute(
        "INSERT OR IGNORE INTO edges(src, dst, kind) VALUES(?, ?, ?)", (sid(src), sid(dst), kind)
    )


def enrich(db, w, depth):
    """Fill the work node and attach authors / concepts / venue (typed edges)."""
    field = ((w.get("primary_topic") or {}).get("field") or {}).get("display_name")
    upsert(
        db,
        w["id"],
        "work",
        depth,
        name=w.get("display_name"),
        props={
            "year": w.get("publication_year"),
            "cited_by": w.get("cited_by_count"),
            "field": field,
            "abstract": abstract_from_inverted(w.get("abstract_inverted_index")),
        },
        fetched=True,
    )
    for a in (w.get("authorships") or [])[:MAX_AUTHORS]:
        au = a.get("author") or {}
        if au.get("id"):
            upsert(db, au["id"], "author", depth, name=au.get("display_name"), props={}, fetched=True)
            add_edge(db, w["id"], au["id"], "authored_by")
    concepts = sorted(w.get("concepts") or [], key=lambda c: -(c.get("score") or 0))
    for c in [c for c in concepts if (c.get("score") or 0) >= CONCEPT_MIN_SCORE][:MAX_CONCEPTS]:
        if c.get("id"):
            upsert(db, c["id"], "concept", depth, name=c.get("display_name"),
                   props={"level": c.get("level")}, fetched=True)
            add_edge(db, w["id"], c["id"], "has_concept")
    src = (w.get("primary_location") or {}).get("source") or {}
    if src.get("id"):
        # key is venue_type, not type — 'type' is the node's own field in export
        upsert(db, src["id"], "venue", depth, name=src.get("display_name"),
               props={"venue_type": src.get("type")}, fetched=True)
        add_edge(db, w["id"], src["id"], "published_in")


def export(db, dbpath):
    base = dbpath.rsplit(".", 1)[0]
    with open(base + ".nodes.jsonl", "w") as f:
        for nid, ntype, name, props, depth in db.execute(
            "SELECT id, type, name, props, depth FROM nodes"
        ):
            row = {"id": nid, "type": ntype, "name": name, "depth": depth}
            if props:
                row.update(json.loads(props))
            f.write(json.dumps(row) + "\n")
    with open(base + ".edges.jsonl", "w") as f:
        for src, dst, kind in db.execute("SELECT src, dst, kind FROM edges"):
            f.write(json.dumps({"src": src, "dst": dst, "kind": kind}) + "\n")

    by_type = dict(db.execute("SELECT type, COUNT(*) FROM nodes GROUP BY type").fetchall())
    by_kind = dict(db.execute("SELECT kind, COUNT(*) FROM edges GROUP BY kind").fetchall())
    print(f"\nexport -> {base}.nodes/edges.jsonl")
    print(f"  nodes by type: {by_type}")
    print(f"  edges by kind: {by_kind}")


def fill_pass(db, rate, top):
    """Enrich already-discovered but unfetched works (metadata + authors /
    concepts / venue), without expanding the snowball further. Optionally only
    the top-N most cited-within-the-graph (degree) — the core worth content.
    Resumable: each filled work flips fetched=1.
    """
    if top:
        db.executescript(
            """
            CREATE TEMP TABLE IF NOT EXISTS deg AS
            SELECT id, COUNT(*) AS d FROM
                (SELECT src AS id FROM edges UNION ALL SELECT dst AS id FROM edges)
            GROUP BY id;
            """
        )
        rows = db.execute(
            "SELECT n.id FROM nodes n LEFT JOIN deg ON deg.id = n.id "
            "WHERE n.type='work' AND n.fetched=0 "
            "ORDER BY COALESCE(deg.d, 0) DESC LIMIT ?",
            (top,),
        ).fetchall()
    else:
        rows = db.execute("SELECT id FROM nodes WHERE type='work' AND fetched=0").fetchall()

    ids = [r[0] for r in rows]
    print(f"fill: enriching {len(ids)} works")
    for i, wid in enumerate(ids):
        w = get(f"{API}/{wid}?select={WORK_SELECT}&mailto={MAILTO}", rate)
        if w:
            enrich(db, w, 0)  # existing depth is preserved (upsert doesn't touch it)
        if i % 200 == 0:
            db.commit()
            print(f"  {i}/{len(ids)}")
    db.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="ingest/data/openalex.sqlite")
    ap.add_argument("--in-cap", type=int, default=4, help="top-N most-cited citers per work")
    ap.add_argument("--out-cap", type=int, default=6, help="references kept per work")
    ap.add_argument("--max-depth", type=int, default=1)
    ap.add_argument("--max-works", type=int, default=30, help="snowball budget (works only)")
    ap.add_argument("--rps", type=float, default=8.0)
    ap.add_argument("--reset", action="store_true", help="discard any existing pull and start fresh")
    ap.add_argument("--fill", action="store_true",
                    help="enrich already-discovered unfetched works (no expansion)")
    ap.add_argument("--fill-top", type=int, default=0,
                    help="with --fill: only the top-N unfetched works by graph degree (0=all)")
    a = ap.parse_args()

    os.makedirs(os.path.dirname(a.db), exist_ok=True)
    if a.reset and os.path.exists(a.db):
        os.remove(a.db)
        print(f"reset: removed {a.db}")
    db = db_init(a.db)
    rate = Rate(a.rps)

    if a.fill:
        fill_pass(db, rate, a.fill_top)
        export(db, a.db)
        db.close()
        return

    fresh = db.execute("SELECT COUNT(*) FROM nodes WHERE fetched=1").fetchone()[0] == 0
    pending = db.execute("SELECT COUNT(*) FROM frontier").fetchone()[0]
    if fresh and pending == 0:
        seeds = load_seeds()
        print(f"seeds: {', '.join(seeds)}")
        for s in seeds:
            upsert(db, s, "work", 0)
            db.execute("INSERT OR IGNORE INTO frontier(id, depth) VALUES(?, 0)", (sid(s),))
        db.commit()
    elif pending == 0:
        n = db.execute("SELECT COUNT(*) FROM nodes WHERE type='work'").fetchone()[0]
        print(
            f"existing pull at {a.db} is already complete ({n} works), frontier empty.\n"
            f"Use --reset to start a new run, or --db <path> for a separate one."
        )
        export(db, a.db)
        db.close()
        return

    while True:
        n_works = db.execute("SELECT COUNT(*) FROM nodes WHERE type='work'").fetchone()[0]
        if n_works >= a.max_works:
            print(f"reached work budget ({n_works})")
            break
        row = db.execute("SELECT id, depth FROM frontier ORDER BY depth ASC LIMIT 1").fetchone()
        if not row:
            print("frontier empty")
            break
        node_id, depth = row
        db.execute("DELETE FROM frontier WHERE id=?", (node_id,))

        w = get(f"{API}/{node_id}?select={WORK_SELECT}&mailto={MAILTO}", rate)
        if not w:
            db.commit()
            continue
        enrich(db, w, depth)

        if depth < a.max_depth:
            for ref in (w.get("referenced_works") or [])[: a.out_cap]:
                upsert(db, ref, "work", depth + 1)
                add_edge(db, w["id"], ref, "cites")
                db.execute("INSERT OR IGNORE INTO frontier(id, depth) VALUES(?, ?)",
                           (sid(ref), depth + 1))
            q = urllib.parse.urlencode(
                {
                    "filter": f"cites:{node_id}",
                    "sort": "cited_by_count:desc",
                    "per_page": a.in_cap,
                    "select": "id",
                    "mailto": MAILTO,
                }
            )
            cit = get(f"{API}?{q}", rate) or {"results": []}
            for c in cit.get("results", []):
                upsert(db, c["id"], "work", depth + 1)
                add_edge(db, c["id"], w["id"], "cites")
                db.execute("INSERT OR IGNORE INTO frontier(id, depth) VALUES(?, ?)",
                           (sid(c["id"]), depth + 1))

        db.commit()
        print(
            f"  [{n_works:>6} works] d{depth} {node_id} "
            f"cited_by={w.get('cited_by_count')} :: {str(w.get('display_name'))[:46]}"
        )

    export(db, a.db)
    db.close()


if __name__ == "__main__":
    main()
