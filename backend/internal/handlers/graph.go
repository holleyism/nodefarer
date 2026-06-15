// Package handlers wires HTTP routes to the graph service. Handlers stay thin:
// decode, call the service, encode.
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/holleyism/nodefarer/backend/internal/models"
	"github.com/holleyism/nodefarer/backend/internal/services"
)

type GraphHandler struct{ svc *services.GraphService }

func NewGraphHandler(svc *services.GraphService) *GraphHandler { return &GraphHandler{svc: svc} }

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (h *GraphHandler) Entry(w http.ResponseWriter, r *http.Request) {
	var req models.EntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	if req.Mode == "" {
		req.Mode = "node"
	}
	view, err := h.svc.Entry(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (h *GraphHandler) Expand(w http.ResponseWriter, r *http.Request) {
	var req models.ExpandRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad request body")
		return
	}
	view, err := h.svc.Expand(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (h *GraphHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	hits, err := h.svc.Search(r.Context(), q.Get("q"), q.Get("kind"), atoi(q.Get("limit")))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

func (h *GraphHandler) Similar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id := q.Get("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	hits, err := h.svc.Similar(r.Context(), id, atoi(q.Get("limit")))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

func (h *GraphHandler) Neighbors(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id := q.Get("id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	hits, err := h.svc.Neighbors(r.Context(), id, q.Get("rel"), atoi(q.Get("limit")))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, hits)
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
