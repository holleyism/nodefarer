#!/usr/bin/env python3
"""Stage 2 — load the OpenAlex JSONL slice into Neo4j.

Reads <base>.nodes.jsonl / <base>.edges.jsonl (from pull_openalex.py) and
MERGEs them into Neo4j: one label per node type, typed relationships per edge
kind. Idempotent (MERGE on id). Connection settings come from config.py
(env / gitignored .env); the password is never read or logged here.

    ingest/.venv/bin/python ingest/load_neo4j.py [--wipe]
"""
import argparse
import json
import sys
from itertools import islice

from neo4j import GraphDatabase
import neo4j.exceptions as nx

import config

TYPE_LABEL = {
    "work": "Work",
    "author": "Author",
    "concept": "Concept",
    "venue": "Venue",
    "institution": "Institution",
}
# edge kind -> (src label, dst label, relationship type)
KIND = {
    "cites": ("Work", "Work", "CITES"),
    "authored_by": ("Work", "Author", "AUTHORED_BY"),
    "has_concept": ("Work", "Concept", "HAS_CONCEPT"),
    "published_in": ("Work", "Venue", "PUBLISHED_IN"),
    "affiliated_work": ("Work", "Institution", "AFFILIATED_WITH"),
    "affiliated_author": ("Author", "Institution", "AFFILIATED_WITH"),
}


def chunks(seq, n):
    it = iter(seq)
    while True:
        batch = list(islice(it, n))
        if not batch:
            return
        yield batch


def read_jsonl(path):
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="ingest/data/openalex")
    ap.add_argument("--batch", type=int, default=1000)
    ap.add_argument("--wipe", action="store_true", help="DETACH DELETE all nodes first")
    a = ap.parse_args()

    s = config.neo4j_settings()
    print("connecting:", config.describe())
    driver = GraphDatabase.driver(s["uri"], auth=s["auth"])
    try:
        driver.verify_connectivity()
    except nx.AuthError:
        sys.exit("Neo4j auth failed — check NEO4J_USER/PASSWORD in ingest/.env (not echoed).")
    except Exception as e:
        sys.exit(f"Neo4j unreachable at {config.NEO4J_URI}: {type(e).__name__}")

    with driver.session(database=s["database"]) as ses:
        if a.wipe:
            print("wiping graph...")
            while ses.run(
                "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) AS c"
            ).single()["c"]:
                pass

        nodes_by_type = {}
        for n in read_jsonl(a.base + ".nodes.jsonl"):
            nodes_by_type.setdefault(n["type"], []).append(n)
        for ntype, rows in nodes_by_type.items():
            label = TYPE_LABEL.get(ntype)
            if not label:
                print(f"  skip unknown node type: {ntype}")
                continue
            ses.run(f"CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.id IS UNIQUE")
            for batch in chunks(rows, a.batch):
                for r in batch:
                    r.pop("type", None)  # the label is the source of truth
                ses.run(f"UNWIND $rows AS r MERGE (n:{label} {{id: r.id}}) SET n += r", rows=batch)
            print(f"  +{len(rows):>7} :{label}")

        edges_by_kind = {}
        for e in read_jsonl(a.base + ".edges.jsonl"):
            props = {k: v for k, v in e.items() if k not in ("src", "dst", "kind")}
            edges_by_kind.setdefault(e["kind"], []).append(
                {"src": e["src"], "dst": e["dst"], "props": props}
            )
        for kind, rows in edges_by_kind.items():
            m = KIND.get(kind)
            if not m:
                print(f"  skip unknown edge kind: {kind}")
                continue
            sl, dl, rt = m
            q = (
                f"UNWIND $rows AS r "
                f"MATCH (a:{sl} {{id: r.src}}) MATCH (b:{dl} {{id: r.dst}}) "
                f"MERGE (a)-[e:{rt}]->(b) SET e += r.props"
            )
            for batch in chunks(rows, a.batch):
                ses.run(q, rows=batch)
            print(f"  +{len(rows):>7} -[:{rt}]->")

        print("\nin graph:")
        for label in TYPE_LABEL.values():
            c = ses.run(f"MATCH (n:{label}) RETURN count(n) AS c").single()["c"]
            print(f"  {label:8} {c}")
        rc = ses.run("MATCH ()-[r]->() RETURN count(r) AS c").single()["c"]
        print(f"  rels     {rc}")

    driver.close()


if __name__ == "__main__":
    main()
