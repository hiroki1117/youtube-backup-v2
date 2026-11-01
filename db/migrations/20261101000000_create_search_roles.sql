-- migrate:up

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

-- migrate:down

DROP ROLE search_reader;
DROP ROLE search_writer;
