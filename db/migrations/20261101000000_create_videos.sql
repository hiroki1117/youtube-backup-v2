-- pg_trgm lets ILIKE '%term%' use an index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A copy of the DynamoDB video items for search. DynamoDB stays the source of truth, so values
-- keep their DynamoDB text form. entrypoints/search_sync.py replaces the contents every hour.
CREATE TABLE videos (
    video_id text PRIMARY KEY,
    video_url text NOT NULL,
    platform text NOT NULL,
    title text NOT NULL,
    backupdate text NOT NULL,
    s3fullpath text NOT NULL,
    upload_status text NOT NULL,
    request_timestamp text
);

CREATE INDEX videos_title_trgm_idx ON videos USING gin (title gin_trgm_ops);
CREATE INDEX videos_video_id_trgm_idx ON videos USING gin (video_id gin_trgm_ops);
CREATE INDEX videos_backupdate_idx ON videos (backupdate);

-- Roles start without login. Their passwords are set by hand (db/README.md) so none enters git.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'search_reader') THEN
        CREATE ROLE search_reader NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'search_writer') THEN
        CREATE ROLE search_writer NOLOGIN;
    END IF;
END
$$;

GRANT SELECT ON videos TO search_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON videos TO search_writer;
