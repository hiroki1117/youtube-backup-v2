"""Hourly: replaces the Neon copy of the videos with the current DynamoDB items."""

from wiring import get_search_service


def handler(event, context):
    return get_search_service().sync()
