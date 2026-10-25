"""Temporary: backs up the comments of videos stored before comment backups existed.

Each hourly run starts up to LIMIT videos; a manual invoke may pass {"limit": N} instead. Once no
video is left, the function disables its own schedule, so one pass over the catalog runs and then
stops.
"""

import logging
import os

import boto3

from wiring import get_comment_service

logger = logging.getLogger(__name__)

# Videos started per hourly run. Tune it here: the schedule passes no limit of its own.
LIMIT = 10


def backfill(service, event, disable_schedule):
    result = service.backfill(int(event.get("limit", LIMIT)))
    if not result["remaining"]:
        disable_schedule()
        logger.info("Comment backfill finished; schedule disabled")
    return result


def disable_schedule():
    boto3.client("events").disable_rule(Name=os.environ["COMMENTS_BACKFILL_RULE_NAME"])


def handler(event, context):
    return backfill(get_comment_service(), event, disable_schedule)
