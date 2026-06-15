package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// Health holds the dependencies a readiness check needs.
type Health struct{ driver neo4j.DriverWithContext }

func NewHealth(driver neo4j.DriverWithContext) *Health { return &Health{driver: driver} }

// Livez — process is up. (k8s livenessProbe)
func (h *Health) Livez(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// Readyz — Neo4j is reachable. (k8s readinessProbe)
func (h *Health) Readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.driver.VerifyConnectivity(ctx); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "neo4j unreachable")
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ready"))
}
