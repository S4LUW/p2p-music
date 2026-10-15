CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  sync_revision bigint NOT NULL DEFAULT 0 CHECK (sync_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE playlists (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  entries jsonb NOT NULL DEFAULT '[]',
  version integer NOT NULL CHECK (version > 0),
  revision bigint NOT NULL,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,id),
  CHECK (jsonb_typeof(entries) = 'array')
);
CREATE INDEX playlists_sync ON playlists(account_id,revision);
CREATE TABLE operation_receipts (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,operation_id)
);
