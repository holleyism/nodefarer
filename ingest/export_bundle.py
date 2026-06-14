#!/usr/bin/env python3
"""Stage 5 — bake a bounded demo slice into a self-contained JSON bundle.

The store is 6-digit; the browser scene is always bounded. This exports a
*session/tour snapshot*: a few-thousand-node slice grown from the pinned seeds
(stage 0) by **best-first BFS over CITES, ordered by PageRank** — so the slice
is the high-signal citation backbone reachable from the narrative, not the
19k low-value works citing Hopfield. Attribute nodes (authors/concepts/venues/
institutions) incident to the chosen works are folded in (authors capped), the
induced structural subgraph is kept, and semantic "wormhole" edges are added
from the stage-4 kNN sidecar (both endpoints in-slice, above threshold, not
already cited). Zero backend: the app fetches this one file.

Reads Neo4j (config.py / gitignored .env) + ingest/data/openalex.knn.jsonl.

    ingest/.venv/bin/python ingest/export_bundle.py --max-works 2000

Output (default ingest/data/bundle.json — gitignored; the app-wiring step
copies it into the served dir):
  {meta, nodes[], edges[], communities[]}
"""
import argparse
import datetime
import json
import os
import sys

from neo4j import GraphDatabase
import neo4j.exceptions as nx

import config

SEEDS_FILE = os.path.join(os.path.dirname(__file__), "seeds.json")

# relationship type in Neo4j -> (edge kind for the app, human label)
REL = {
    "CITES": ("structural", "cites"),
    "AUTHORED_BY": ("structural", "authored by"),
    "HAS_CONCEPT": ("structural", "concept"),
    "PUBLISHED_IN": ("structural", "published in"),
    "AFFILIATED_WITH": ("structural", "affiliated with"),
}


def load_seeds():
    with open(SEEDS_FILE) as f:
        return [s["id"] for s in json.load(f)]


def select_works(ses, seeds, max_works, max_hops):
    """Best-first BFS over CITES (undirected), expanding the highest-PageRank
    neighbours first, until the work budget is hit."""
    present = ses.run(
        "MATCH (w:Work) WHERE w.id IN $s RETURN collect(w.id) AS ids", s=seeds
    ).single()["ids"]
    missing = set(seeds) - set(present)
    if missing:
        print(f"  WARNING: seeds not in graph (skipped): {sorted(missing)}")
    selected = set(present)
    frontier = set(present)
    for hop in range(max_hops):
        if len(selected) >= max_works or not frontier:
            break
        rows = ses.run(
            "MATCH (w:Work)-[:CITES]-(n:Work) "
            "WHERE w.id IN $f AND NOT n.id IN $s "
            "RETURN DISTINCT n.id AS id, coalesce(n.pagerank, 0.0) AS pr "
            "ORDER BY pr DESC",
            f=list(frontier),
            s=list(selected),
        )
        new = []
        for r in rows:
            if len(selected) >= max_works:
                break
            selected.add(r["id"])
            new.append(r["id"])
        print(f"  hop {hop + 1}: +{len(new)} works (total {len(selected)})")
        frontier = set(new)
    return selected


def fetch_nodes(ses, label, ids, props):
    """Pull a node label's rows for the given ids, keeping `props` keys."""
    out = {}
    if not ids:
        return out
    proj = ", ".join(f"n.{p} AS {p}" for p in props)
    for r in ses.run(
        f"MATCH (n:{label}) WHERE n.id IN $ids RETURN n.id AS id, {proj}",
        ids=list(ids),
    ):
        d = {"id": r["id"], "type": label.lower()}
        for p in props:
            if r[p] is not None:
                d[p] = r[p]
        out[r["id"]] = d
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ingest/data/bundle.json")
    ap.add_argument("--knn", default="ingest/data/openalex.knn.jsonl")
    ap.add_argument("--max-works", type=int, default=2000, help="BFS work budget")
    ap.add_argument("--max-hops", type=int, default=6)
    ap.add_argument("--authors-per-work", type=int, default=5, help="0 to skip authors")
    ap.add_argument("--abstract-chars", type=int, default=600,
                    help="truncate work abstracts (0=omit, -1=full)")
    ap.add_argument("--sem-threshold", type=float, default=0.55,
                    help="min cosine for a wormhole edge")
    ap.add_argument("--sem-per-node", type=int, default=3,
                    help="max semantic edges kept per work")
    a = ap.parse_args()

    s = config.neo4j_settings()
    print("connecting:", config.describe())
    driver = GraphDatabase.driver(s["uri"], auth=s["auth"])
    try:
        driver.verify_connectivity()
    except nx.AuthError:
        sys.exit("Neo4j auth failed — check ingest/.env (not echoed).")
    except Exception as e:
        sys.exit(f"Neo4j unreachable at {config.NEO4J_URI}: {type(e).__name__}")

    nodes = {}
    edges = []
    edge_seen = set()

    def add_edge(src, dst, rel, props=None):
        kind, label = REL[rel]
        key = (src, dst, rel)
        if key in edge_seen:
            return
        edge_seen.add(key)
        e = {"id": f"{rel}:{src}->{dst}", "source": src, "target": dst,
             "kind": kind, "rel": rel.lower(), "label": label}
        if props:
            e["props"] = {k: v for k, v in props.items() if v is not None}
        edges.append(e)

    with driver.session(database=s["database"]) as ses:
        seeds = load_seeds()
        print(f"seeds: {', '.join(seeds)}")
        work_ids = select_works(ses, seeds, a.max_works, a.max_hops)

        # Work nodes (+ truncated abstract).
        works = fetch_nodes(ses, "Work", work_ids,
                            ["name", "communityId", "pagerank", "year", "cited_by",
                             "field", "abstract"])
        for w in works.values():
            w["community"] = w.pop("communityId", None)
            if "abstract" in w:
                if a.abstract_chars == 0:
                    w.pop("abstract")
                elif a.abstract_chars > 0:
                    w["abstract"] = w["abstract"][: a.abstract_chars]
        nodes.update(works)

        # Induced CITES among selected works.
        for r in ses.run(
            "MATCH (a:Work)-[:CITES]->(b:Work) WHERE a.id IN $ids AND b.id IN $ids "
            "RETURN a.id AS s, b.id AS t", ids=list(work_ids)):
            add_edge(r["s"], r["t"], "CITES")

        # Concepts / venues (small, shared) + their edges.
        for r in ses.run(
            "MATCH (w:Work)-[e:HAS_CONCEPT]->(c:Concept) WHERE w.id IN $ids "
            "RETURN w.id AS s, c.id AS t, c.name AS name, c.level AS level, e.score AS score",
            ids=list(work_ids)):
            nodes.setdefault(r["t"], {"id": r["t"], "type": "concept",
                                      "name": r["name"], "level": r["level"]})
            add_edge(r["s"], r["t"], "HAS_CONCEPT", {"score": r["score"]})
        for r in ses.run(
            "MATCH (w:Work)-[:PUBLISHED_IN]->(v:Venue) WHERE w.id IN $ids "
            "RETURN w.id AS s, v.id AS t, v.name AS name, v.venue_type AS venue_type",
            ids=list(work_ids)):
            nodes.setdefault(r["t"], {"id": r["t"], "type": "venue",
                                      "name": r["name"], "venue_type": r["venue_type"]})
            add_edge(r["s"], r["t"], "PUBLISHED_IN")

        # Authors, capped per work (keeps the multi-relational structure without
        # flooding the slice with degree-1 author nodes).
        if a.authors_per_work:
            per_work = {}
            for r in ses.run(
                "MATCH (w:Work)-[e:AUTHORED_BY]->(au:Author) WHERE w.id IN $ids "
                "RETURN w.id AS s, au.id AS t, au.name AS name, "
                "e.position AS position, e.corresponding AS corresponding",
                ids=list(work_ids)):
                kept = per_work.setdefault(r["s"], 0)
                # prioritise first/corresponding, then fill to the cap
                first = r["position"] == "first" or r["corresponding"]
                if kept >= a.authors_per_work and not first:
                    continue
                per_work[r["s"]] = kept + 1
                nodes.setdefault(r["t"], {"id": r["t"], "type": "author", "name": r["name"]})
                add_edge(r["s"], r["t"], "AUTHORED_BY",
                         {"position": r["position"], "corresponding": r["corresponding"]})
            # Institutions affiliated with included works.
            for r in ses.run(
                "MATCH (w:Work)-[:AFFILIATED_WITH]->(i:Institution) WHERE w.id IN $ids "
                "RETURN w.id AS s, i.id AS t, i.name AS name, i.country AS country, "
                "i.inst_type AS inst_type", ids=list(work_ids)):
                nodes.setdefault(r["t"], {"id": r["t"], "type": "institution", "name": r["name"],
                                          "country": r["country"], "inst_type": r["inst_type"]})
                add_edge(r["s"], r["t"], "AFFILIATED_WITH")

    driver.close()

    # Semantic wormhole edges from the stage-4 kNN sidecar (works only).
    sem_added = 0
    if os.path.exists(a.knn):
        cited = {(e["source"], e["target"]) for e in edges if e["rel"] == "cites"}
        cited |= {(t, s) for s, t in cited}
        with open(a.knn) as f:
            for line in f:
                row = json.loads(line)
                src = row["id"]
                if src not in work_ids:
                    continue
                kept = 0
                for nid, sim in row.get("neighbors", []):
                    if kept >= a.sem_per_node:
                        break
                    if sim < a.sem_threshold or nid not in work_ids:
                        continue
                    if (src, nid) in cited:
                        continue
                    lo, hi = sorted((src, nid))
                    key = ("SEM", lo, hi)
                    if key in edge_seen:
                        continue
                    edge_seen.add(key)
                    edges.append({"id": f"SEM:{lo}~{hi}", "source": src, "target": nid,
                                  "kind": "semantic", "rel": "semantic", "label": "wormhole",
                                  "props": {"similarity": round(sim, 4)}})
                    kept += 1
                    sem_added += 1
    else:
        print(f"  WARNING: {a.knn} not found — no semantic/wormhole edges.")

    # Per-community stats (communities present in the slice).
    from collections import Counter, defaultdict
    comm_works = defaultdict(list)
    for w in nodes.values():
        if w["type"] == "work" and w.get("community") is not None:
            comm_works[w["community"]].append(w)
    concept_by_work = defaultdict(list)
    name_of = {nid: n.get("name") for nid, n in nodes.items()}
    for e in edges:
        if e["rel"] == "concept":
            concept_by_work[e["source"]].append(name_of.get(e["target"]))
    communities = []
    for cid, members in comm_works.items():
        rep = max(members, key=lambda w: w.get("pagerank", 0.0))
        concepts = Counter(c for w in members for c in concept_by_work.get(w["id"], []) if c)
        communities.append({
            "id": cid,
            "size": len(members),
            "representative": {"id": rep["id"], "name": rep.get("name")},
            "dominantConcept": concepts.most_common(1)[0][0] if concepts else None,
        })
    communities.sort(key=lambda c: -c["size"])

    model = None
    meta_path = os.path.join(os.path.dirname(a.knn), "openalex.embeddings.meta.json")
    if os.path.exists(meta_path):
        model = json.load(open(meta_path)).get("model")

    by_type = Counter(n["type"] for n in nodes.values())
    by_kind = Counter(e["kind"] for e in edges)
    bundle = {
        "meta": {
            "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "seeds": seeds,
            "counts": {"nodes": len(nodes), "edges": len(edges),
                       "byType": dict(by_type), "byKind": dict(by_kind)},
            "communities": len(communities),
            "embeddingModel": model,
            "params": {"maxWorks": a.max_works, "semThreshold": a.sem_threshold},
        },
        "nodes": list(nodes.values()),
        "edges": edges,
        "communities": communities,
    }

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(bundle, f, separators=(",", ":"))
    size_mb = os.path.getsize(a.out) / 1e6

    print(f"\nbundle -> {a.out}  ({size_mb:.1f} MB)")
    print(f"  nodes {len(nodes)}  by type: {dict(by_type)}")
    print(f"  edges {len(edges)}  by kind: {dict(by_kind)}  (semantic: {sem_added})")
    print(f"  communities: {len(communities)}")


if __name__ == "__main__":
    main()
