-- Run once as the database/schema owner, AFTER running all migrations.
-- The role intentionally has no password/login until the operator configures it.
BEGIN;
CREATE ROLE p2p_music_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO p2p_music_runtime;
GRANT SELECT ON schema_migrations TO p2p_music_runtime;
GRANT SELECT ON accounts TO p2p_music_runtime;
GRANT INSERT (id,email,password_hash) ON accounts TO p2p_music_runtime;
GRANT UPDATE (sync_revision) ON accounts TO p2p_music_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON sessions,playlists,operation_receipts TO p2p_music_runtime;
GRANT SELECT,INSERT,UPDATE ON catalog_artists,catalog_albums,catalog_tracks TO p2p_music_runtime;
-- No access to curator_role_audit; no UPDATE/INSERT grant on is_curator.
-- Prevent creating objects in public through an inherited PUBLIC grant.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
COMMIT;
