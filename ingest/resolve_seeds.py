#!/usr/bin/env python3
"""Stage 0 — resolve canonical seed work IDs and pin them to seeds.json.

OpenAlex entity resolution is unreliable (duplicate/variant records, mis-dated
metadata, DOI gaps; the canonical "Attention Is All You Need" record resists
title/DOI lookup). So seeds are resolved deliberately — by id when known, else
by a year-windowed, author-verified title search that surfaces candidates for
inspection — and written to ingest/seeds.json (version-controlled), which the
puller reads.

    python3 ingest/resolve_seeds.py
"""
import json
import os
import urllib.parse
import urllib.request

MAILTO = "holleyism@gmail.com"
SEEDS_OUT = os.path.join(os.path.dirname(__file__), "seeds.json")
SELECT = "id,display_name,publication_year,cited_by_count,authorships"

# Each seed: a label plus either a known id, or a title (+ year window + author
# hint) to resolve.
SEED_SPECS = [
    {"label": "Hopfield 1982 — associative memory", "id": "W2128084896"},
    {"label": "Ramsauer 2021 — Hopfield Networks is All You Need (bridge)", "id": "W3127151792"},
    {
        "label": "Vaswani 2017 — Attention Is All You Need (transformer)",
        "title": "Attention Is All You Need",
        "year": 2017,
        "author_hint": "Vaswani",
    },
]


def fetch(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def authors_of(w):
    return [
        (a.get("author") or {}).get("display_name", "") for a in (w.get("authorships") or [])
    ]


def by_id(wid):
    return fetch(f"https://api.openalex.org/works/{wid}?select={SELECT}&mailto={MAILTO}")


def candidates(title):
    """Union of title-field filter and broad search, ranked by citations.

    Deliberately does NOT filter by year — OpenAlex metadata is exactly what we
    don't trust (the transformer paper is mis-dated 2025), so the author hint is
    the disambiguator, not the year.
    """
    out = {}
    title_flt = urllib.parse.quote(f"title.search:{title}", safe=":")
    urls = [
        f"https://api.openalex.org/works?filter={title_flt}&per_page=25&select={SELECT}&mailto={MAILTO}",
        "https://api.openalex.org/works?"
        + urllib.parse.urlencode(
            {"search": title, "per_page": 50, "select": SELECT, "mailto": MAILTO}
        ),
    ]
    for u in urls:
        for w in fetch(u).get("results", []):
            out[w["id"]] = w
    return sorted(out.values(), key=lambda w: -(w.get("cited_by_count") or 0))


def resolve(spec):
    if spec.get("id"):
        return by_id(spec["id"]), "pinned id", []
    cands = candidates(spec["title"])
    hint = (spec.get("author_hint") or "").lower()
    verified = [w for w in cands if any(hint in a.lower() for a in authors_of(w))] if hint else cands
    pick = (verified or cands or [None])[0]
    conf = "author-verified" if (hint and verified and pick in verified) else "best-effort"
    # Flag (don't discard) records whose year disagrees with the spec — OpenAlex
    # mis-dates some works (the transformer is filed as 2025).
    if pick and spec.get("year") and pick.get("publication_year") != spec["year"]:
        conf += f" [year {pick.get('publication_year')}!={spec['year']}, metadata bug]"
    return pick, conf, cands[:5]


def line(w, extra=""):
    if not w:
        return "  <none>"
    return (
        f"  {w['id'].split('/')[-1]:>12}  {w.get('publication_year')}  "
        f"{(w.get('cited_by_count') or 0):>8,}  {str(w.get('display_name'))[:46]:46}{extra}"
    )


def main():
    seeds = []
    for spec in SEED_SPECS:
        print(f"\n# {spec['label']}")
        pick, conf, alts = resolve(spec)
        print(line(pick, f"  [{conf}]"))
        if conf == "best-effort" and alts:
            print("  alternatives:")
            for w in alts:
                print(line(w))
        if pick:
            seeds.append(
                {
                    "id": pick["id"].split("/")[-1],
                    "label": spec["label"],
                    "title": pick.get("display_name"),
                    "year": pick.get("publication_year"),
                    "cited_by": pick.get("cited_by_count"),
                    "confidence": conf,
                }
            )

    with open(SEEDS_OUT, "w") as f:
        json.dump(seeds, f, indent=2)
    print(f"\nwrote {len(seeds)} seeds -> {SEEDS_OUT}")
    flagged = [
        s
        for s in seeds
        if not (s["confidence"].startswith("pinned id") or s["confidence"].startswith("author-verified"))
    ]
    if flagged:
        print("REVIEW (best-effort, confirm before the full pull):",
              ", ".join(s["id"] for s in flagged))


if __name__ == "__main__":
    main()
