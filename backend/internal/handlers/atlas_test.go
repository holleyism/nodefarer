package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// loadAtlasBytes reads the canonical Atlas the binary embeds, so the test
// exercises the real shipped document.
func loadAtlasBytes(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile("../../cmd/api/atlas.json")
	if err != nil {
		t.Fatalf("read atlas.json: %v", err)
	}
	return b
}

func TestNewAtlasHandlerRejectsBadJSON(t *testing.T) {
	if _, err := NewAtlasHandler([]byte("not json")); err == nil {
		t.Fatal("expected error for malformed atlas")
	}
	if _, err := NewAtlasHandler([]byte(`{"name":"no id"}`)); err == nil {
		t.Fatal("expected error for atlas without id")
	}
}

func TestAtlasServesFullDocument(t *testing.T) {
	h, err := NewAtlasHandler(loadAtlasBytes(t))
	if err != nil {
		t.Fatalf("NewAtlasHandler: %v", err)
	}

	rec := httptest.NewRecorder()
	h.Atlas(rec, httptest.NewRequest(http.MethodGet, "/api/v1/atlas", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var atlas struct {
		ID     string `json:"id"`
		Source struct {
			Kind string `json:"kind"`
		} `json:"source"`
		Legend struct {
			Wormhole struct {
				Kind    string `json:"kind"`
				Enabled bool   `json:"enabled"`
			} `json:"wormhole"`
		} `json:"legend"`
		Anchors map[string]any `json:"anchors"`
		Tours   []any          `json:"tours"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &atlas); err != nil {
		t.Fatalf("decode atlas: %v", err)
	}
	if atlas.Source.Kind != "api" {
		t.Errorf("source.kind = %q, want api", atlas.Source.Kind)
	}
	if atlas.Legend.Wormhole.Kind != "semantic" || !atlas.Legend.Wormhole.Enabled {
		t.Errorf("wormhole lens = %+v, want enabled semantic", atlas.Legend.Wormhole)
	}
	if atlas.Anchors["origin"] != "W2128084896" {
		t.Errorf("anchors.origin = %v, want W2128084896", atlas.Anchors["origin"])
	}
	if len(atlas.Tours) == 0 {
		t.Error("expected at least one tour in the catalog")
	}
}

func TestAtlasesReturnsOneElementCatalog(t *testing.T) {
	h, err := NewAtlasHandler(loadAtlasBytes(t))
	if err != nil {
		t.Fatalf("NewAtlasHandler: %v", err)
	}

	rec := httptest.NewRecorder()
	h.Atlases(rec, httptest.NewRequest(http.MethodGet, "/api/v1/atlases", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var catalog []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &catalog); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if len(catalog) != 1 {
		t.Fatalf("catalog len = %d, want 1", len(catalog))
	}
	if catalog[0].ID == "" || catalog[0].Name == "" {
		t.Errorf("catalog entry missing id/name: %+v", catalog[0])
	}
}
