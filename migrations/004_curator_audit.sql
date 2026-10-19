CREATE TABLE curator_role_audit (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 previous_enabled boolean NOT NULL,
 enabled boolean NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
 database_actor text NOT NULL DEFAULT current_user,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX curator_role_audit_account ON curator_role_audit(account_id, changed_at DESC);
