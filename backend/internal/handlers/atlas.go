package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// AtlasHandler serves the backend's Atlas (Plan G3) — the top-order object that
// makes this dataset self-describing (legend, anchors, tours). The full document
// is served verbatim at GET /atlas; GET /atlases returns a one-element catalog
// (id/name/description) so a future picker can enumerate worlds. One canonical
// Atlas per backend; the raw JSON is loaded once at startup.
type AtlasHandler struct {
	raw     []byte
	summary atlasSummary
}

type atlasSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// NewAtlasHandler validates that raw is a well-formed Atlas (at least its
// identity fields) and keeps the bytes for verbatim serving.
func NewAtlasHandler(raw []byte) (*AtlasHandler, error) {
	var s atlasSummary
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("parse atlas: %w", err)
	}
	if s.ID == "" {
		return nil, fmt.Errorf("atlas has no id")
	}
	return &AtlasHandler{raw: raw, summary: s}, nil
}

// Summary is safe to log (no secrets).
func (h *AtlasHandler) Summary() string {
	return fmt.Sprintf("%s (%s)", h.summary.ID, h.summary.Name)
}

// Atlas serves the full Atlas document verbatim.
func (h *AtlasHandler) Atlas(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(h.raw)
}

// Atlases returns the catalog — one canonical Atlas per backend for now.
func (h *AtlasHandler) Atlases(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, []atlasSummary{h.summary})
}
