import hashlib
from dataclasses import dataclass

from .jwt_helper import JwtHelper
from ..types.token import Token
from api.config import settings


@dataclass
class RefreshResult:
    token: str
    expires_at: int


class AuthService:
    def __init__(self, helper: JwtHelper) -> None:
        self._helper = helper

    async def refresh(self, token: str) -> Token:
        return await self._helper.rotate(token)

    @property
    def issuer(self) -> str:
        return settings.issuer


def rotate_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
