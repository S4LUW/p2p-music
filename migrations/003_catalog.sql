ALTER TABLE accounts ADD COLUMN is_curator boolean NOT NULL DEFAULT false;
CREATE TABLE catalog_artists (
 id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 biography text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL REFERENCES accounts(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_artists_name ON catalog_artists(lower(name),id);
CREATE TABLE catalog_albums (
 id uuid PRIMARY KEY, artist_id uuid NOT NULL REFERENCES catalog_artists(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), release_year integer CHECK(release_year BETWEEN 1000 AND 2200),
 genre text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 updated_by uuid NOT NULL REFERENCES accounts(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_albums_artist ON catalog_albums(artist_id,release_year DESC,id);
CREATE TABLE catalog_tracks (
 id uuid PRIMARY KEY, album_id uuid NOT NULL REFERENCES catalog_albums(id),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), disc_number integer NOT NULL CHECK(disc_number BETWEEN 1 AND 99),
 track_number integer NOT NULL CHECK(track_number BETWEEN 1 AND 999),
 duration_seconds integer CHECK(duration_seconds BETWEEN 1 AND 86400),
 file_hash text NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'), file_name text NOT NULL, file_size bigint NOT NULL CHECK(file_size BETWEEN 1 AND 104857600),
 version integer NOT NULL DEFAULT 1, updated_by uuid NOT NULL REFERENCES accounts(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(album_id,disc_number,track_number)
);
CREATE INDEX catalog_tracks_hash ON catalog_tracks(file_hash);
