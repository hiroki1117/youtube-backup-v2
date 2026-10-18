from wiring import get_service


def handler(event, context):
    return get_service().retry_failed()
