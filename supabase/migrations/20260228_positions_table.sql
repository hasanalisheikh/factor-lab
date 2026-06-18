-- positions table: rebalance-date holdings snapshot for all strategy runs
-- Stores the held symbols and their weights at each rebalance date.
-- Worker writes here for baseline and ML strategies.

CREATE TABLE IF NOT EXISTS positions (
  run_id  UUID    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  date    DATE    NOT NULL,
  symbol  TEXT    NOT NULL,
  weight  NUMERIC NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (run_id, date, symbol)
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON positions;
CREATE POLICY "public read" ON positions FOR SELECT USING (true);
