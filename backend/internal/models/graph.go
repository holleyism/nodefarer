// Package models holds the wire shapes. They mirror the JSON ingest/
// export_bundle.py emits, so the web client's StaticBundleSource and the live
// ApiSource share one render mapping.
package models

// Node — a bundle-shaped node. Optional numerics are pointers so absent fields
// omit cleanly (an author has no year/pagerank).
type Node struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"` // work|author|concept|venue|institution
	Name      string   `json:"name"`
	Community *int64   `json:"community,omitempty"`
	Pagerank  *float64 `json:"pagerank,omitempty"`
	Year      *int64   `json:"year,omitempty"`
	CitedBy   *int64   `json:"cited_by,omitempty"`
	Field     string   `json:"field,omitempty"`
	Level     *int64   `json:"level,omitempty"`
	VenueType string   `json:"venue_type,omitempty"`
	Country   string   `json:"country,omitempty"`
	InstType  string   `json:"inst_type,omitempty"`
}

type Edge struct {
	ID     string         `json:"id"`
	Source string         `json:"source"`
	Target string         `json:"target"`
	Kind   string         `json:"kind"` // structural|semantic
	Rel    string         `json:"rel"`
	Label  string         `json:"label"`
	Props  map[string]any `json:"props,omitempty"`
}

// View is a bounded slice (entry) or a delta (expand). The client merges deltas
// into the in-hand view; collapse/filter stay client-side.
type View struct {
	Anchor string `json:"anchor,omitempty"`
	Nodes  []Node `json:"nodes"`
	Edges  []Edge `json:"edges"`
}

type Candidate struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type EntryRequest struct {
	Mode     string `json:"mode"` // node|search (overview not server-side yet)
	ID       string `json:"id,omitempty"`
	Query    string `json:"query,omitempty"`
	Kind     string `json:"kind,omitempty"` // text|semantic (search)
	MaxNodes int    `json:"maxNodes,omitempty"`
}

type ExpandRequest struct {
	ID    string   `json:"id"`
	Have  []string `json:"have,omitempty"` // ids already in the client's view
	Rel   string   `json:"rel,omitempty"`  // restrict to a relationship type
	Limit int      `json:"limit,omitempty"`
}
