-- Up Migration

CREATE TABLE recurring_streams (
  stream_id NUMERIC(20, 0) PRIMARY KEY,
  recipient TEXT NOT NULL,
  amount_per_interval NUMERIC(39, 0) NOT NULL,
  interval_ledgers INTEGER NOT NULL,
  created_ledger BIGINT NOT NULL,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE,
  total_streamed NUMERIC(39, 0) NOT NULL DEFAULT 0,
  last_executed_ledger BIGINT,
  execution_count BIGINT NOT NULL DEFAULT 0,
  updated_ledger BIGINT NOT NULL
);

CREATE INDEX idx_recurring_streams_recipient
  ON recurring_streams(recipient, stream_id);

CREATE TABLE recurring_stream_executions (
  event_id TEXT PRIMARY KEY,
  stream_id NUMERIC(20, 0) NOT NULL
    REFERENCES recurring_streams(stream_id) ON DELETE CASCADE,
  amount NUMERIC(39, 0) NOT NULL,
  executed_at_ledger BIGINT NOT NULL,
  ledger BIGINT NOT NULL,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_stream_executions_stream
  ON recurring_stream_executions(stream_id, executed_at_ledger DESC, event_id DESC);

-- Down Migration

DROP TABLE IF EXISTS recurring_stream_executions;
DROP TABLE IF EXISTS recurring_streams;
