from wiring import get_youtube_comment_ingest


def handler(event, context):
    return get_youtube_comment_ingest().ingest_records(event)
