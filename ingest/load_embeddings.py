#!/usr/bin/env python3
"""Stage 6 (live path) — load stage-4 embeddings + kNN into Neo4j.

For the *live* product (Track B) the graph is the runtime source of truth, so
the vectors and similarity links have to live in Neo4j — not just as sidecar
files. This reads the stage-4 outputs and:

  1. SETs `w.embedding` (a float list) on each Work, from the .npy + ids.json.
  2. CREATEs a **vector index** on `Work.embedding` (cosine) → live semantic
     search ("papers like this / like this text").
  3. MERGEs `SIMILAR_TO` relationships from the kNN sidecar (top-K, score) →
     wormholes become a graph traversal, not a file lookup.

Idempotent (SET / MERGE). Run after load_neo4j + gds_analyze, once embed.py has
finished. Needs numpy (from requirements-embed.txt) + the neo4j driver.

    ingest/.venv/bin/python ingest/load_embeddings.py
    ingest/.venv/bin/python ingest/load_embeddings.py --no-similar   # vectors only
"""
import argparse
import json
import os
import sys

import numpy as np
from neo4j import GraphDatabase
import neo4j.exceptions as nx

import config

INDEX_NAME = "work_embedding"


def chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="ingest/data/openalex",
                    help="prefix for .embeddings.* and .knn.jsonl")
    ap.add_argument("--batch", type=int, default=1000)
    ap.add_argument("--no-index", action="store_true", help="skip vector index creation")
    ap.add_argument("--no-similar", action="store_true", help="skip SIMILAR_TO edges")
    ap.add_argument("--sim-min", type=float, default=0.5, help="min cosine for SIMILAR_TO")
    ap.add_argument("--top-k", type=int, default=15, help="max neighbors kept per work")
    ap.add_argument("--drop-similar", action="store_true",
                    help="delete existing SIMILAR_TO first (clean rebuild)")
    a = ap.parse_args()

    ids_path = a.base + ".embeddings.ids.json"
    npy_path = a.base + ".embeddings.f32.npy"
    meta_path = a.base + ".embeddings.meta.json"
    knn_path = a.base + ".knn.jsonl"
    for p in (ids_path, npy_path, meta_path):
        if not os.path.exists(p):
            sys.exit(f"missing stage-4 output: {p} (run embed.py first)")

    ids = json.load(open(ids_path))
    meta = json.load(open(meta_path))
    dim = meta["dim"]
    mat = np.load(npy_path, mmap_mode="r")
    if mat.shape[0] != len(ids) or mat.shape[1] != dim:
        sys.exit(f"shape mismatch: {npy_path} {mat.shape} vs ids {len(ids)} dim {dim}")
    print(f"vectors: {len(ids)} × {dim}  (model {meta.get('model')})")

    s = config.neo4j_settings()
    print("connecting:", config.describe())
    driver = GraphDatabase.driver(s["uri"], auth=s["auth"])
    try:
        driver.verify_connectivity()
    except nx.AuthError:
        sys.exit("Neo4j auth failed — check ingest/.env (not echoed).")
    except Exception as e:
        sys.exit(f"Neo4j unreachable at {config.NEO4J_URI}: {type(e).__name__}")

    with driver.session(database=s["database"]) as ses:
        # 1. vectors onto Work nodes
        n = len(ids)
        idx = list(range(n))
        for batch in chunks(idx, a.batch):
            rows = [{"id": ids[i], "v": [float(x) for x in mat[i]]} for i in batch]
            ses.run(
                "UNWIND $rows AS r MATCH (w:Work {id: r.id}) "
                "CALL db.create.setNodeVectorProperty(w, 'embedding', r.v)",
                rows=rows,
            )
            if batch[0] % (a.batch * 20) == 0:
                print(f"  embeddings {batch[0]}/{n}")
        print(f"  embeddings set on {n} works")

        # 2. vector index
        if not a.no_index:
            ses.run(
                f"CREATE VECTOR INDEX {INDEX_NAME} IF NOT EXISTS "
                "FOR (w:Work) ON (w.embedding) OPTIONS {indexConfig: {"
                "`vector.dimensions`: $dim, `vector.similarity_function`: 'cosine'}}",
                dim=dim,
            )
            print(f"  vector index '{INDEX_NAME}' ensured (cosine, dim {dim})")

        # 3. SIMILAR_TO from kNN sidecar
        if not a.no_similar:
            if a.drop_similar:
                print("  dropping existing SIMILAR_TO ...")
                while ses.run(
                    "MATCH ()-[s:SIMILAR_TO]->() WITH s LIMIT 50000 "
                    "DELETE s RETURN count(s) AS c"
                ).single()["c"]:
                    pass
            if not os.path.exists(knn_path):
                print(f"  WARNING: {knn_path} not found — skipping SIMILAR_TO.")
            else:
                rows, total = [], 0
                with open(knn_path) as f:
                    for line in f:
                        r = json.loads(line)
                        kept = 0
                        for nid, sim in r.get("neighbors", []):
                            if kept >= a.top_k or sim < a.sim_min:
                                break
                            rows.append({"src": r["id"], "dst": nid, "score": float(sim)})
                            kept += 1
                            if len(rows) >= a.batch:
                                ses.run(
                                    "UNWIND $rows AS r "
                                    "MATCH (x:Work {id: r.src}) MATCH (y:Work {id: r.dst}) "
                                    "MERGE (x)-[e:SIMILAR_TO]->(y) SET e.score = r.score",
                                    rows=rows,
                                )
                                total += len(rows)
                                if total % (a.batch * 20) == 0:
                                    print(f"  SIMILAR_TO {total}")
                                rows = []
                if rows:
                    ses.run(
                        "UNWIND $rows AS r "
                        "MATCH (x:Work {id: r.src}) MATCH (y:Work {id: r.dst}) "
                        "MERGE (x)-[e:SIMILAR_TO]->(y) SET e.score = r.score",
                        rows=rows,
                    )
                    total += len(rows)
                print(f"  SIMILAR_TO edges: {total}")

    driver.close()
    print("done.")


if __name__ == "__main__":
    main()
