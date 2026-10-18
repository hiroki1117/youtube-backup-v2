from api.dependencies import get_service
from api.deployment import deployment_entrypoint
from repositories.scrapbox import ScrapboxRepository


@deployment_entrypoint("s3_complete")
def s3_complete(event, context):
    return get_service().complete_records(event)


@deployment_entrypoint("retry")
def retry(event, context):
    return get_service().retry_failed()


def scan_scrapbox(service, source):
    started = existing = 0
    for url in source.video_urls():
        _, created = service.register(url)
        started += int(created)
        existing += int(not created)
    return {"started": started, "existing": existing}


@deployment_entrypoint("scrapbox_scan")
def scrapbox_scan(event, context):
    return scan_scrapbox(get_service(), ScrapboxRepository())
