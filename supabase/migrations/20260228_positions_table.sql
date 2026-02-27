-- positions table: rebalance-date holdings snapshot for all strategy runs
-- Stores the held symbols and their weights at each rebalance date.
-- For baseline strategies (equal_weight, momentum_12_1) the worker writes here.
-- For ML strategies, the holdings tab derives from model_predictions.

CREATE TABLE IF NOT EXISTS positions (
  run_id  UUID    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  date    DATE    NOT NULL,
  symbol  TEXT    NOT NULL,
  weight  NUMERIC NOT NULL CHECK (weight >= 0),
  PRIMARY KEY (run_id, date, symbol)
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON positions FOR SELECT USING (true);
