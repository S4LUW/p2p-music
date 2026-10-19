ALTER TABLE catalog_artists ADD COLUMN illustration_url text CHECK (illustration_url IS NULL OR length(illustration_url) <= 2048);
ALTER TABLE catalog_albums ADD COLUMN illustration_url text CHECK (illustration_url IS NULL OR length(illustration_url) <= 2048);
