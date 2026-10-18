from repositories.scrapbox import ScrapboxRepository
from wiring import get_service


def scan_scrapbox(service, source):
    started = existing = 0
    for url in source.video_urls():
        _, created = service.register(url)
        started += int(created)
        existing += int(not created)
    return {"started": started, "existing": existing}


def handler(event, context):
    return scan_scrapbox(get_service(), ScrapboxRepository())
