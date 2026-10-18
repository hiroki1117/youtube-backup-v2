"""Fail-closed entrypoint gate for isolated Lambda deployment verification.

This gate is an additional safeguard. The first deployment's execution role must
also deny data access and Batch submission; caller-controlled inputs cannot enable
application mode. Only Lambda configuration managed by infra can do that.
"""

import os
from functools import wraps

CHECK_EVENT = {"operation": "deployment_check"}


def deployment_entrypoint(function: str):
    def decorate(handler):
        @wraps(handler)
        def invoke(event, context):
            mode = os.environ.get("BACKEND_EXECUTION_MODE", "validation")
            if mode not in {"validation", "application"}:
                raise RuntimeError("Invalid BACKEND_EXECUTION_MODE")
            if event == CHECK_EVENT:
                return {
                    "status": "ok",
                    "function": function,
                    "execution_mode": mode,
                    "aws_access": False,
                }
            if mode != "application":
                raise RuntimeError("Application invocation is disabled in validation mode")
            return handler(event, context)

        return invoke

    return decorate
