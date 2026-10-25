import hmac
import os
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from usecases.models import DomainError
from wiring import get_comment_service, get_playlist_service, get_service

__all__ = ["get_comment_service", "get_playlist_service", "get_service", "require_auth"]

bearer = HTTPBearer(auto_error=False)


def require_auth(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    event = request.scope.get("aws.event")
    if event is not None:
        # Gateway authorizer is the trust boundary. Headers alone never authorize Lambda requests.
        authorizer = event.get("requestContext", {}).get("authorizer", {})
        claims = authorizer.get("jwt", {}).get("claims") or authorizer.get("claims") or {}
        if not claims.get("sub"):
            raise DomainError(401, "gateway_authorization_required")
        return
    token = os.environ.get("BACKEND_LOCAL_TOKEN", "")
    if not token or not credentials or not hmac.compare_digest(credentials.credentials, token):
        raise DomainError(401, "authentication_required")
