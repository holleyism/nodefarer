// Package services holds the graph query logic over Neo4j. Every query is
// bounded (the store is 6-digit; the rendered scene is not) and ranked by
// PageRank, mirroring the StaticBundleSource so the client behaves identically
// against either source.
package services

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"

	"github.com/holleyism/nodefarer/backend/internal/models"
)

type GraphService struct {
	driver neo4j.DriverWithContext
	db     string
	vindex string
}

func NewGraphService(driver neo4j.DriverWithContext, db, vectorIndex string) *GraphService {
	return &GraphService{driver: driver, db: db, vindex: vectorIndex}
}

// OpenAlex ids encode the entity type in their first char, so we can match with
// the right label (and its id index) instead of a label-less scan.
func labelForID(id string) string {
	if id == "" {
		return "Work"
	}
	switch id[0] {
	case 'A':
		return "Author"
	case 'C':
		return "Concept"
	case 'S':
		return "Venue"
	case 'I':
		return "Institution"
	default:
		return "Work"
	}
}

// Entry grows a bounded multi-hop neighborhood with a per-node fan-out cap, so
// no single node contributes a hairball.
const (
	entryMaxNodes = 100
	entryFanout   = 10
	entryMaxHops  = 3
)

type relMeta struct{ kind, label string }

var rels = map[string]relMeta{
	"CITES":          {"structural", "cites"},
	"AUTHORED_BY":    {"structural", "authored by"},
	"HAS_CONCEPT":    {"structural", "concept"},
	"PUBLISHED_IN":   {"structural", "published in"},
	"AFFILIATED_WITH": {"structural", "affiliated with"},
	"SIMILAR_TO":     {"semantic", "wormhole"},
}

func (s *GraphService) run(ctx context.Context, cypher string, params map[string]any) ([]*neo4j.Record, error) {
	res, err := neo4j.ExecuteQuery(ctx, s.driver, cypher, params,
		neo4j.EagerResultTransformer, neo4j.ExecuteQueryWithDatabase(s.db))
	if err != nil {
		return nil, err
	}
	return res.Records, nil
}

// ── parsing helpers (neo4j ints→int64, floats→float64) ──────────────────────
func i64p(v any) *int64 {
	if n, ok := v.(int64); ok {
		return &n
	}
	return nil
}
func f64p(v any) *float64 {
	switch n := v.(type) {
	case float64:
		return &n
	case int64:
		f := float64(n)
		return &f
	}
	return nil
}
func str(v any) string {
	if sv, ok := v.(string); ok {
		return sv
	}
	return ""
}

func groupByLabel(ids []string) map[string][]string {
	g := map[string][]string{}
	for _, id := range ids {
		l := labelForID(id)
		g[l] = append(g[l], id)
	}
	return g
}

// topNeighbors returns, per frontier node, its top-`fanout` neighbors by
// PageRank (excluding `seen`), deduped. Grouped by label so each MATCH hits the
// id index.
const fanoutCypher = `
UNWIND $ids AS fid
MATCH (a:%s {id: fid})-[]-(n)
WITH fid, n WHERE NOT n.id IN $seen
WITH fid, n ORDER BY coalesce(n.pagerank, 0.0) DESC
WITH fid, collect(DISTINCT n.id)[0..$fanout] AS ns
UNWIND ns AS nid RETURN DISTINCT nid AS id
`

func (s *GraphService) topNeighbors(ctx context.Context, frontier, seen []string, fanout int) ([]string, error) {
	var out []string
	for label, fids := range groupByLabel(frontier) {
		if len(fids) == 0 {
			continue
		}
		recs, err := s.run(ctx, fmt.Sprintf(fanoutCypher, label),
			map[string]any{"ids": fids, "seen": seen, "fanout": fanout})
		if err != nil {
			return nil, err
		}
		for _, r := range recs {
			if id := str(r.AsMap()["id"]); id != "" {
				out = append(out, id)
			}
		}
	}
	return out, nil
}

// ── nodes ───────────────────────────────────────────────────────────────────
const nodeCypher = `
MATCH (x:Work) WHERE x.id IN $w RETURN x.id AS id, 'work' AS type, x{.name,.communityId,.pagerank,.year,.cited_by,.field} AS p
UNION
MATCH (x:Author) WHERE x.id IN $a RETURN x.id AS id, 'author' AS type, x{.name} AS p
UNION
MATCH (x:Concept) WHERE x.id IN $c RETURN x.id AS id, 'concept' AS type, x{.name,.level} AS p
UNION
MATCH (x:Venue) WHERE x.id IN $s RETURN x.id AS id, 'venue' AS type, x{.name,.venue_type} AS p
UNION
MATCH (x:Institution) WHERE x.id IN $i RETURN x.id AS id, 'institution' AS type, x{.name,.country,.inst_type} AS p
`

func (s *GraphService) getNodes(ctx context.Context, ids []string) ([]models.Node, error) {
	groups := map[string][]string{"Work": {}, "Author": {}, "Concept": {}, "Venue": {}, "Institution": {}}
	for _, id := range ids {
		l := labelForID(id)
		groups[l] = append(groups[l], id)
	}
	recs, err := s.run(ctx, nodeCypher, map[string]any{
		"w": groups["Work"], "a": groups["Author"], "c": groups["Concept"],
		"s": groups["Venue"], "i": groups["Institution"],
	})
	if err != nil {
		return nil, err
	}
	out := make([]models.Node, 0, len(recs))
	for _, r := range recs {
		m := r.AsMap()
		p, _ := m["p"].(map[string]any)
		n := models.Node{ID: str(m["id"]), Type: str(m["type"]), Name: str(p["name"])}
		if n.Name == "" {
			n.Name = n.ID
		}
		n.Community = i64p(p["communityId"])
		n.Pagerank = f64p(p["pagerank"])
		n.Year = i64p(p["year"])
		n.CitedBy = i64p(p["cited_by"])
		n.Field = str(p["field"])
		n.Level = i64p(p["level"])
		n.VenueType = str(p["venue_type"])
		n.Country = str(p["country"])
		n.InstType = str(p["inst_type"])
		out = append(out, n)
	}
	return out, nil
}

// ── edges (induced among a set; optionally only those touching `touch`) ──────
func (s *GraphService) inducedEdges(ctx context.Context, ids, touch []string) ([]models.Edge, error) {
	touchClause := ""
	params := map[string]any{"ids": ids}
	if len(touch) > 0 {
		touchClause = " AND (x.id IN $touch OR y.id IN $touch)"
		params["touch"] = touch
	}
	// CITES/AUTHORED_BY/HAS_CONCEPT/PUBLISHED_IN/SIMILAR_TO source = Work;
	// AFFILIATED_WITH also has Author as source.
	body := func(label string) string {
		return fmt.Sprintf(
			"MATCH (x:%s) WHERE x.id IN $ids MATCH (x)-[r]->(y) WHERE y.id IN $ids%s "+
				"RETURN x.id AS src, y.id AS dst, type(r) AS rel, properties(r) AS props",
			label, touchClause)
	}
	cypher := body("Work") + "\nUNION\n" + body("Author")
	recs, err := s.run(ctx, cypher, params)
	if err != nil {
		return nil, err
	}
	out := make([]models.Edge, 0, len(recs))
	for _, r := range recs {
		m := r.AsMap()
		src, dst, relType := str(m["src"]), str(m["dst"]), str(m["rel"])
		meta, ok := rels[relType]
		if !ok {
			continue
		}
		props, _ := m["props"].(map[string]any)
		e := models.Edge{Source: src, Target: dst, Kind: meta.kind, Label: meta.label}
		if meta.kind == "semantic" {
			lo, hi := src, dst
			if hi < lo {
				lo, hi = hi, lo
			}
			e.ID = "SEM:" + lo + "~" + hi
			e.Rel = "semantic"
			if props != nil {
				if sc, ok := props["score"]; ok {
					e.Props = map[string]any{"similarity": sc}
				}
			}
		} else {
			e.ID = relType + ":" + src + "->" + dst
			e.Rel = strings.ToLower(relType)
			if len(props) > 0 {
				e.Props = props
			}
		}
		out = append(out, e)
	}
	return out, nil
}

// ── contract ────────────────────────────────────────────────────────────────
func (s *GraphService) Entry(ctx context.Context, req models.EntryRequest) (models.View, error) {
	max := req.MaxNodes
	if max <= 0 || max > 1000 {
		max = entryMaxNodes
	}
	anchor := req.ID
	if req.Mode == "search" {
		hits, err := s.Search(ctx, req.Query, req.Kind, 1)
		if err != nil {
			return models.View{}, err
		}
		if len(hits) == 0 {
			return models.View{}, fmt.Errorf("no match for %q", req.Query)
		}
		anchor = hits[0].ID
	}
	if anchor == "" {
		// No id/query → land on the most central work (a sensible default seed).
		recs, err := s.run(ctx, "MATCH (w:Work) RETURN w.id AS id ORDER BY coalesce(w.pagerank,0.0) DESC LIMIT 1", nil)
		if err != nil {
			return models.View{}, err
		}
		if len(recs) == 0 {
			return models.View{}, fmt.Errorf("graph is empty")
		}
		anchor = str(recs[0].AsMap()["id"])
	}

	// Per-node fan-out BFS: each node contributes only its top-`fanout`
	// neighbors (by PageRank), so the scene is multi-hop, not a star.
	selected := map[string]bool{anchor: true}
	frontier := []string{anchor}
	for hop := 0; hop < entryMaxHops && len(frontier) > 0 && len(selected) < max; hop++ {
		seen := make([]string, 0, len(selected))
		for id := range selected {
			seen = append(seen, id)
		}
		cand, err := s.topNeighbors(ctx, frontier, seen, entryFanout)
		if err != nil {
			return models.View{}, err
		}
		var next []string
		for _, id := range cand {
			if len(selected) >= max {
				break
			}
			if !selected[id] {
				selected[id] = true
				next = append(next, id)
			}
		}
		frontier = next
	}
	ids := make([]string, 0, len(selected))
	for id := range selected {
		ids = append(ids, id)
	}
	nodes, err := s.getNodes(ctx, ids)
	if err != nil {
		return models.View{}, err
	}
	edges, err := s.inducedEdges(ctx, ids, nil)
	if err != nil {
		return models.View{}, err
	}
	return models.View{Anchor: anchor, Nodes: nodes, Edges: edges}, nil
}

func (s *GraphService) Expand(ctx context.Context, req models.ExpandRequest) (models.View, error) {
	if req.ID == "" {
		return models.View{}, fmt.Errorf("expand needs an id")
	}
	limit := req.Limit
	if limit <= 0 || limit > 200 {
		limit = 12
	}
	have := map[string]bool{}
	for _, id := range req.Have {
		have[id] = true
	}
	relClause := ""
	params := map[string]any{"id": req.ID, "have": req.Have, "k": limit}
	if req.Rel != "" {
		relClause = " AND type(r) = $rel"
		params["rel"] = strings.ToUpper(req.Rel)
	}
	cypher := fmt.Sprintf(
		"MATCH (a:%s {id:$id})-[r]-(n) WHERE NOT n.id IN $have%s "+
			"RETURN DISTINCT n.id AS id ORDER BY coalesce(n.pagerank,0.0) DESC LIMIT $k",
		labelForID(req.ID), relClause)
	recs, err := s.run(ctx, cypher, params)
	if err != nil {
		return models.View{}, err
	}
	var newIDs []string
	for _, r := range recs {
		if id := str(r.AsMap()["id"]); id != "" {
			newIDs = append(newIDs, id)
		}
	}
	if len(newIDs) == 0 {
		return models.View{Nodes: []models.Node{}, Edges: []models.Edge{}}, nil
	}
	nodes, err := s.getNodes(ctx, newIDs)
	if err != nil {
		return models.View{}, err
	}
	// edges among (have ∪ new) that touch a new node
	union := append(append([]string{}, req.Have...), newIDs...)
	edges, err := s.inducedEdges(ctx, union, newIDs)
	if err != nil {
		return models.View{}, err
	}
	return models.View{Nodes: nodes, Edges: edges}, nil
}

func (s *GraphService) Search(ctx context.Context, q, kind string, limit int) ([]models.Candidate, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	if strings.TrimSpace(q) == "" {
		return []models.Candidate{}, nil
	}
	// Free-text semantic search needs a query-vector embedder (deferred); for
	// now text is a name CONTAINS over works. See Similar for node-based semantic.
	cypher := "MATCH (w:Work) WHERE toLower(w.name) CONTAINS toLower($q) " +
		"RETURN w.id AS id, w.name AS name, coalesce(w.pagerank,0.0) AS score " +
		"ORDER BY score DESC LIMIT $k"
	recs, err := s.run(ctx, cypher, map[string]any{"q": q, "k": limit})
	if err != nil {
		return nil, err
	}
	return candidates(recs), nil
}

// Similar — semantic neighbors of a work via the vector index (no query
// embedder needed: it queries by the node's own stored embedding).
func (s *GraphService) Similar(ctx context.Context, id string, limit int) ([]models.Candidate, error) {
	if limit <= 0 || limit > 100 {
		limit = 15
	}
	cypher := fmt.Sprintf(
		"MATCH (w:Work {id:$id}) "+
			"CALL db.index.vector.queryNodes($idx, $k, w.embedding) YIELD node, score "+
			"WHERE node.id <> $id "+
			"RETURN node.id AS id, node.name AS name, score AS score ORDER BY score DESC LIMIT %d", limit)
	recs, err := s.run(ctx, cypher, map[string]any{"id": id, "idx": s.vindex, "k": limit + 1})
	if err != nil {
		return nil, err
	}
	return candidates(recs), nil
}

func (s *GraphService) Neighbors(ctx context.Context, id, rel string, limit int) ([]models.Candidate, error) {
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	relClause := ""
	params := map[string]any{"id": id, "k": limit}
	if rel != "" {
		relClause = " WHERE type(r) = $rel"
		params["rel"] = strings.ToUpper(rel)
	}
	cypher := fmt.Sprintf(
		"MATCH (a:%s {id:$id})-[r]-(n)%s "+
			"RETURN DISTINCT n.id AS id, n.name AS name, coalesce(n.pagerank,0.0) AS score "+
			"ORDER BY score DESC LIMIT $k",
		labelForID(id), relClause)
	recs, err := s.run(ctx, cypher, params)
	if err != nil {
		return nil, err
	}
	return candidates(recs), nil
}

func candidates(recs []*neo4j.Record) []models.Candidate {
	out := make([]models.Candidate, 0, len(recs))
	for _, r := range recs {
		m := r.AsMap()
		c := models.Candidate{ID: str(m["id"]), Name: str(m["name"])}
		if f := f64p(m["score"]); f != nil {
			c.Score = *f
		}
		if c.Name == "" {
			c.Name = c.ID
		}
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}
