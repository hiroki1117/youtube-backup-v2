# Attributes a video needs in the search copy. A few old items lack them, and Video requires them.
REQUIRED = ("video_url", "platform", "title", "backupdate", "s3fullpath")


class SearchService:
    def __init__(self, index, videos):
        self.index = index
        self.videos = videos

    def find(self, query: str, backup_from: str | None, backup_to: str | None, limit: int):
        terms = query.split()
        if not (terms or backup_from or backup_to):
            return []
        return self.index.search(terms, backup_from, backup_to, limit)

    def sync(self) -> dict:
        items = [item for item in self.videos.all() if "deletion_token" not in item]
        if not items:
            # An empty catalog is far likelier a broken read than reality; keep the copy.
            raise RuntimeError("No videos read from DynamoDB; refusing to empty the search copy")
        videos = [item for item in items if all(item.get(name) for name in REQUIRED)]
        return {"synced": self.index.replace_all(videos), "skipped": len(items) - len(videos)}
