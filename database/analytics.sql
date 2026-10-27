-- Apply once to the Solar Prisma Postgres database using its direct connection.
CREATE TABLE IF NOT EXISTS solar_presence (
  session_id uuid PRIMARY KEY,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solar_presence_last_seen_idx
  ON solar_presence (last_seen_at);

CREATE TABLE IF NOT EXISTS solar_visits (
  visit_id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solar_visits_visited_at_idx
  ON solar_visits (visited_at);
