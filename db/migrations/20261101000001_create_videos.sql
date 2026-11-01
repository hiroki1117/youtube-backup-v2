-- migrate:up

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

GRANT SELECT ON videos TO search_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON videos TO search_writer;

-- migrate:down

DROP TABLE videos;
DROP EXTENSION pg_trgm;
