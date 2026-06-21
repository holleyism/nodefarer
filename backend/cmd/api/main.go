// Command api is the Nodefarer live graph backend (ApiSource): Chi over Neo4j,
// co-located with the database on the GPU box. Bounded, PageRank-ranked
// queries; bundle-shaped JSON so the web client reuses one render mapping.
package main

import (
	"context"
	_ "embed"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/holleyism/nodefarer/backend/internal/config"
	"github.com/holleyism/nodefarer/backend/internal/handlers"
	mw "github.com/holleyism/nodefarer/backend/internal/middleware"
	"github.com/holleyism/nodefarer/backend/internal/services"
)

// The canonical Atlas for this backend, compiled in so the server is always
// self-describing. An ATLAS_PATH env var can point at an external file to
// override it (e.g. a second Atlas over the same data) without a rebuild.
//
//go:embed atlas.json
var embeddedAtlas []byte

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
	driver, err := neo4j.NewDriverWithContext(cfg.Neo4jURI, neo4j.BasicAuth(cfg.Neo4jUser, cfg.Neo4jPassword, ""))
	if err != nil {
		log.Fatalf("neo4j driver: %v", err)
	}
	defer driver.Close(ctx)
	verifyCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := driver.VerifyConnectivity(verifyCtx); err != nil {
		log.Fatalf("neo4j unreachable at %s: %v", cfg.Neo4jURI, err)
	}
	log.Printf("connected: %s", cfg.Describe())

	svc := services.NewGraphService(driver, cfg.Neo4jDatabase, cfg.VectorIndex)
	gh := handlers.NewGraphHandler(svc)
	health := handlers.NewHealth(driver)

	atlasJSON := embeddedAtlas
	if cfg.AtlasPath != "" {
		if b, readErr := os.ReadFile(cfg.AtlasPath); readErr == nil {
			atlasJSON = b
			log.Printf("atlas: loaded from %s", cfg.AtlasPath)
		} else {
			log.Printf("atlas: ATLAS_PATH=%s unreadable (%v); using embedded atlas", cfg.AtlasPath, readErr)
		}
	}
	ah, err := handlers.NewAtlasHandler(atlasJSON)
	if err != nil {
		log.Fatalf("atlas: %v", err)
	}
	log.Printf("atlas: serving %s", ah.Summary())

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(mw.Metrics)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.CORSOrigins,
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Accept", "Content-Type", "Authorization"},
		MaxAge:         300,
	}))

	// Ops endpoints (no auth, no rate limit).
	r.Get("/healthz", health.Livez)
	r.Get("/readyz", health.Readyz)
	r.Handle("/metrics", promhttp.Handler())

	// Graph API: rate-limited + optional auth gate.
	r.Route("/api/v1", func(api chi.Router) {
		api.Use(httprate.LimitByIP(cfg.RateRPS, time.Minute))
		api.Use(mw.Auth(cfg.AuthToken))
		api.Get("/atlas", ah.Atlas)
		api.Get("/atlases", ah.Atlases)
		api.Post("/entry", gh.Entry)
		api.Post("/expand", gh.Expand)
		api.Post("/path", gh.Path)
		api.Get("/search", gh.Search)
		api.Get("/similar", gh.Similar)
		api.Get("/neighbors", gh.Neighbors)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down…")
	shutCtx, shutCancel := context.WithTimeout(ctx, 10*time.Second)
	defer shutCancel()
	_ = srv.Shutdown(shutCtx)
}
