#!/usr/bin/env python3
"""Stage 4 — text embeddings + per-node semantic kNN (offline wormholes).

Reads the snowball export (``*.nodes.jsonl``) directly — embeddings are a pure
function of node text, so this stage needs no graph and no Neo4j. That also
decouples it from the load order: it runs against the fresh JSONL regardless of
whether Neo4j has been (re)loaded yet.

Only **works** are embedded. They carry ``name`` (title) + ``abstract`` — real
text — and the demo's semantic links are work↔work (the Hopfield→attention
"wormhole"). Authors/concepts/venues/institutions have only short names, a
different text distribution that would pollute a shared cosine space, so they
are skipped (override with ``--types`` if you ever want them).

Outputs (written next to the nodes file, all gitignored under ingest/data/):
  - ``<base>.embeddings.f32.npy``    float32 [N, dim], **L2-normalised** (memmap)
  - ``<base>.embeddings.ids.json``   the N node ids, parallel to the matrix rows
  - ``<base>.embeddings.meta.json``  model / dim / count / types / normalised
  - ``<base>.knn.jsonl``             per node: {"id", "neighbors": [[id, sim], …]}

Embedding is resumable: rows fill a pre-sized memmap and a ``.progress`` marker
records how many are done; re-running continues where it stopped (as long as
model/types/id-list are unchanged). kNN is fast once vectors exist and is just
recomputed.

GPU box (RTX 5060 Ti, 16 GB) — sized to fit comfortably:
    python3 ingest/embed.py --device cuda --batch-size 64 --knn 15

The Blackwell card needs a CUDA 12.8+ PyTorch build; see requirements-embed.txt.
Pushing vectors into a Neo4j vector index is a later, separate step (the DB
isn't loaded with this export yet) — kept out of here on purpose.
"""
import argparse
import json
import os
import sys

import numpy as np


def base_of(nodes_path):
    """ingest/data/openalex.nodes.jsonl -> ingest/data/openalex"""
    p = nodes_path
    for suf in (".nodes.jsonl", ".jsonl"):
        if p.endswith(suf):
            return p[: -len(suf)]
    return os.path.splitext(p)[0]


def node_text(row, max_chars):
    """Title + abstract for a work; falls back to title alone."""
    title = (row.get("name") or "").strip()
    abstract = (row.get("abstract") or "").strip()
    if title and abstract:
        text = f"{title}\n\n{abstract}"
    else:
        text = title or abstract
    return text[:max_chars].strip()


def collect_rows(nodes_path, types, max_chars):
    """Scan the JSONL once; return (ids, texts) for embeddable nodes, in file
    order (stable across runs → resumable)."""
    ids, texts = [], []
    skipped = 0
    with open(nodes_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("type") not in types:
                continue
            text = node_text(row, max_chars)
            if not text:  # stub with no title/abstract — nothing to embed
                skipped += 1
                continue
            ids.append(row["id"])
            texts.append(text)
    return ids, texts, skipped


def load_model(model_name, device):
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        sys.exit(
            "sentence-transformers not installed.\n"
            "  pip install -r ingest/requirements-embed.txt\n"
            "(and a CUDA-matched torch build — see that file's header)."
        )
    import torch

    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        print("WARNING: running on CPU — this will be slow for 6-digit node counts.")
    model = SentenceTransformer(model_name, device=device)
    return model, device


def embed(model, texts, mat, batch_size, progress_path, done):
    """Fill mat[done:] in batches, checkpointing the memmap + progress marker."""
    n = len(texts)
    for start in range(done, n, batch_size):
        end = min(start + batch_size, n)
        vecs = model.encode(
            texts[start:end],
            batch_size=batch_size,
            normalize_embeddings=True,  # unit vectors → dot product == cosine
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        mat[start:end] = vecs.astype(np.float32)
        if (start // batch_size) % 50 == 0 or end == n:
            mat.flush()
            with open(progress_path, "w") as f:
                f.write(str(end))
            print(f"  embedded {end}/{n}")
    mat.flush()


def knn(mat, ids, k, device, tile):
    """Exact cosine kNN via tiled matrix products on the GPU. Vectors are already
    unit-norm, so sims = X · Xᵀ. Self is masked out per tile."""
    import torch

    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    x = torch.from_numpy(np.ascontiguousarray(mat)).to(device)
    n = x.shape[0]
    out = []
    for start in range(0, n, tile):
        end = min(start + tile, n)
        sims = x[start:end] @ x.T  # [t, N]
        # mask self (row i ↔ global col start+i)
        rows = torch.arange(end - start, device=device)
        sims[rows, start + rows] = -1.0
        kk = min(k, n - 1)
        vals, idx = sims.topk(kk, dim=1)
        vals = vals.cpu().numpy()
        idx = idx.cpu().numpy()
        for i in range(end - start):
            out.append(
                {
                    "id": ids[start + i],
                    "neighbors": [
                        [ids[int(j)], round(float(v), 4)]
                        for j, v in zip(idx[i], vals[i])
                    ],
                }
            )
        print(f"  knn {end}/{n}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nodes", default="ingest/data/openalex.nodes.jsonl")
    ap.add_argument("--out-dir", default=None, help="default: alongside --nodes")
    ap.add_argument("--model", default="BAAI/bge-large-en-v1.5")
    ap.add_argument(
        "--types",
        default="work",
        help="comma-separated node types to embed (default: work)",
    )
    ap.add_argument("--max-chars", type=int, default=4000)
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    ap.add_argument("--knn", type=int, default=15, help="neighbors per node (0=skip)")
    ap.add_argument("--knn-tile", type=int, default=2048, help="query rows per kNN tile")
    ap.add_argument("--knn-only", action="store_true", help="reuse existing vectors")
    a = ap.parse_args()

    types = {t.strip() for t in a.types.split(",") if t.strip()}
    base = base_of(a.nodes)
    if a.out_dir:
        base = os.path.join(a.out_dir, os.path.basename(base))
    npy_path = base + ".embeddings.f32.npy"
    ids_path = base + ".embeddings.ids.json"
    meta_path = base + ".embeddings.meta.json"
    progress_path = base + ".embeddings.progress"
    knn_path = base + ".knn.jsonl"

    print(f"scanning {a.nodes} for types {sorted(types)} …")
    ids, texts, skipped = collect_rows(a.nodes, types, a.max_chars)
    print(f"  {len(ids)} embeddable nodes ({skipped} stubs with no text skipped)")
    if not ids:
        sys.exit("nothing to embed")

    if not a.knn_only:
        model, device = load_model(a.model, a.device)
        dim = model.get_sentence_embedding_dimension()

        # Resume only if the prior run's id-list + dims match this scan exactly.
        done = 0
        if os.path.exists(meta_path) and os.path.exists(npy_path) and os.path.exists(ids_path):
            meta = json.load(open(meta_path))
            old_ids = json.load(open(ids_path))
            if (
                meta.get("model") == a.model
                and meta.get("dim") == dim
                and old_ids == ids
                and os.path.exists(progress_path)
            ):
                done = int(open(progress_path).read().strip() or 0)
                print(f"  resuming from row {done}")

        json.dump(ids, open(ids_path, "w"))
        mode = "r+" if (done and os.path.exists(npy_path)) else "w+"
        mat = np.lib.format.open_memmap(
            npy_path, mode=mode, dtype=np.float32, shape=(len(ids), dim)
        )
        json.dump(
            {
                "model": a.model,
                "dim": dim,
                "count": len(ids),
                "types": sorted(types),
                "normalized": True,
            },
            open(meta_path, "w"),
            indent=2,
        )
        embed(model, texts, mat, a.batch_size, progress_path, done)
        del mat
        print(f"vectors -> {npy_path}  ({len(ids)} × {dim})")

    if a.knn:
        meta = json.load(open(meta_path))
        mat = np.load(npy_path, mmap_mode="r")
        print(f"computing top-{a.knn} cosine kNN over {mat.shape[0]} vectors …")
        rows = knn(mat, ids, a.knn, a.device, a.knn_tile)
        with open(knn_path, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print(f"knn -> {knn_path}")


if __name__ == "__main__":
    main()
