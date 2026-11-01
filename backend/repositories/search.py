from functools import cached_property

from repositories.aws import AwsRepository

COLUMNS = (
    "video_id",
    "video_url",
    "platform",
    "title",
    "backupdate",
    "s3fullpath",
    "upload_status",
    "request_timestamp",
)
SELECTED = ", ".join(COLUMNS)


def like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class SearchRepository(AwsRepository):
    """Owns the Neon copy of the videos. No connection until a method is called."""

    def __init__(self, session=None, url=None):
        super().__init__(session)
        if url:
            self.url = url

    @cached_property
    def url(self) -> str:
        return self.secret("SSM_SEARCH_DATABASE_URL_PARAMETER")

    def connect(self):
        # Imported here so that the Lambdas without search do not load libpq on cold start.
        import psycopg
        from psycopg.rows import dict_row

        # The Neon pooler runs in transaction mode, which does not keep prepared statements.
        return psycopg.connect(
            self.url, connect_timeout=15, prepare_threshold=None, row_factory=dict_row
        )

    def search(
        self, terms: list[str], backup_from: str | None, backup_to: str | None, limit: int
    ) -> list[dict]:
        conditions, values = [], []
        for term in terms:
            conditions.append("(title ILIKE %s OR video_id ILIKE %s)")
            values += [like_pattern(term)] * 2
        # backupdate is always YYYY-MM-DD, so text order is date order.
        if backup_from:
            conditions.append("backupdate >= %s")
            values.append(backup_from)
        if backup_to:
            conditions.append("backupdate <= %s")
            values.append(backup_to)
        where = " AND ".join(conditions)
        with self.connect() as connection:
            return connection.execute(
                f"SELECT {SELECTED} FROM videos WHERE {where} "
                "ORDER BY backupdate DESC, video_id DESC LIMIT %s",
                [*values, limit],
            ).fetchall()

    def replace_all(self, videos: list[dict]) -> int:
        updates = ", ".join(f"{column} = EXCLUDED.{column}" for column in COLUMNS[1:])
        with self.connect() as connection:
            connection.execute("CREATE TEMP TABLE incoming (LIKE videos) ON COMMIT DROP")
            with connection.cursor().copy(f"COPY incoming ({SELECTED}) FROM STDIN") as copy:
                for video in videos:
                    copy.write_row([video.get(column) for column in COLUMNS])
            connection.execute(
                f"INSERT INTO videos ({SELECTED}) SELECT {SELECTED} FROM incoming "
                f"ON CONFLICT (video_id) DO UPDATE SET {updates} "
                "WHERE videos.* IS DISTINCT FROM EXCLUDED.*"
            )
            connection.execute(
                "DELETE FROM videos WHERE NOT EXISTS "
                "(SELECT FROM incoming WHERE incoming.video_id = videos.video_id)"
            )
        return len(videos)
