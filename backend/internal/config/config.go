// Package config loads runtime settings from the environment (same Neo4j
// contract as the Python ingest: NEO4J_URI/USER/PASSWORD/DATABASE). The
// password is read at runtime and never logged.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port string

	Neo4jURI      string
	Neo4jUser     string
	Neo4jPassword string
	Neo4jDatabase string

	VectorIndex string   // Work.embedding vector index name
	CORSOrigins []string // allowed web origins
	RateRPS     int      // per-IP request budget / minute
	AuthToken   string   // optional static bearer gate (Firebase swaps in later)
	AtlasPath   string   // optional external Atlas JSON; empty = use the embedded one
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func Load() (Config, error) {
	c := Config{
		Port:          env("PORT", "8080"),
		Neo4jURI:      env("NEO4J_URI", "bolt://localhost:7687"),
		Neo4jUser:     env("NEO4J_USER", "neo4j"),
		Neo4jPassword: os.Getenv("NEO4J_PASSWORD"),
		Neo4jDatabase: env("NEO4J_DATABASE", "neo4j"),
		VectorIndex:   env("VECTOR_INDEX", "work_embedding"),
		AuthToken:     os.Getenv("AUTH_TOKEN"),
		AtlasPath:     os.Getenv("ATLAS_PATH"),
	}
	c.CORSOrigins = strings.Split(env("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174"), ",")
	rps, err := strconv.Atoi(env("RATE_RPS", "120"))
	if err != nil {
		return c, fmt.Errorf("RATE_RPS: %w", err)
	}
	c.RateRPS = rps
	if c.Neo4jPassword == "" {
		return c, fmt.Errorf("NEO4J_PASSWORD is not set (put it in the environment / backend .env)")
	}
	return c, nil
}

// Describe is safe to log — never includes the password.
func (c Config) Describe() string {
	return fmt.Sprintf("%s@%s db=%s vectorIndex=%s", c.Neo4jUser, c.Neo4jURI, c.Neo4jDatabase, c.VectorIndex)
}
