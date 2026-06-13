#!/usr/bin/env python3
"""Stage 3 — GDS analytics: community detection + centrality.

Projects the Work–CITES graph, runs Louvain (communities → nebulae) and
PageRank (importance → the nebula's "brightest star"), writing both back as
node properties. Idempotent (drops any stale projection first). Meaningful at
scale; on the smoke slice the communities are trivial — here it mainly proves
the GDS plugin is installed and the pipeline Cypher runs end-to-end.

    ingest/.venv/bin/python ingest/gds_analyze.py
"""
import sys

from neo4j import GraphDatabase
import neo4j.exceptions as nx

import config

GRAPH = "works"


def main():
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
        try:
            version = ses.run("RETURN gds.version() AS v").single()["v"]
        except nx.ClientError as e:
            sys.exit(
                "GDS not available — install the Graph Data Science plugin "
                '(NEO4J_PLUGINS=["graph-data-science"] on the container). ' + e.code
            )
        print("GDS version:", version)

        if ses.run("CALL gds.graph.exists($g) YIELD exists RETURN exists", g=GRAPH).single()[
            "exists"
        ]:
            ses.run("CALL gds.graph.drop($g)", g=GRAPH)

        proj = ses.run(
            "CALL gds.graph.project($g, 'Work', {CITES: {orientation: 'UNDIRECTED'}}) "
            "YIELD nodeCount, relationshipCount",
            g=GRAPH,
        ).single()
        print(f"projected: {proj['nodeCount']} works, {proj['relationshipCount']} cites (undirected)")

        lou = ses.run(
            "CALL gds.louvain.write($g, {writeProperty: 'communityId'}) "
            "YIELD communityCount, modularity",
            g=GRAPH,
        ).single()
        print(f"louvain: {lou['communityCount']} communities, modularity={lou['modularity']:.4f}")

        ses.run("CALL gds.pageRank.write($g, {writeProperty: 'pagerank'})", g=GRAPH)
        print("pagerank: written")

        ses.run("CALL gds.graph.drop($g)", g=GRAPH)

        print("\ncommunity sizes (top):")
        for r in ses.run(
            "MATCH (w:Work) WHERE w.communityId IS NOT NULL "
            "RETURN w.communityId AS c, count(*) AS n ORDER BY n DESC LIMIT 8"
        ):
            print(f"  community {r['c']}: {r['n']} works")

    driver.close()


if __name__ == "__main__":
    main()
