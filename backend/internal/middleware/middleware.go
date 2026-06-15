// Package middleware provides telemetry and an optional auth gate. Telemetry is
// always on (per stack convention); auth is a simple static-bearer gate that
// Firebase token validation can replace later without touching call sites.
package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	reqTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "nodefarer_http_requests_total",
		Help: "HTTP requests by route and status.",
	}, []string{"method", "route", "status"})

	reqDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "nodefarer_http_request_duration_seconds",
		Help:    "HTTP request latency by route.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "route"})
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Metrics records count + latency per chi route pattern.
func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unknown"
		}
		reqTotal.WithLabelValues(r.Method, route, http.StatusText(rec.status)).Inc()
		reqDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())
	})
}

// Auth returns a middleware enforcing a static bearer token. If token is empty
// the gate is disabled (LAN demo). Swap the body for Firebase validation later.
func Auth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}
			h := r.Header.Get("Authorization")
			if strings.TrimPrefix(h, "Bearer ") != token {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
