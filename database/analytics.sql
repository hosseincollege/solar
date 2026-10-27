-- Apply to the Solar Prisma Postgres database using its direct connection.
-- Store keyed IP hashes only; raw client IP addresses are never persisted.
CREATE TABLE IF NOT EXISTS solar_unique_presence (
  visitor_hash text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solar_unique_presence_last_seen_idx
  ON solar_unique_presence (last_seen_at);

CREATE TABLE IF NOT EXISTS solar_unique_visits (
  visitor_hash text NOT NULL,
  visited_day date NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (visitor_hash, visited_day)
);

CREATE INDEX IF NOT EXISTS solar_unique_visits_visited_at_idx
  ON solar_unique_visits (visited_at);
