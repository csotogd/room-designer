"""Primitivas compartidas para retries acotados y límites por instancia."""

import asyncio
import math
import time
from collections import OrderedDict, deque
from collections.abc import Awaitable, Callable

import httpx


def is_transient_error(error: BaseException) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in {408, 425, 429} or error.response.status_code >= 500
    return isinstance(error, (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError, OSError))


async def retry_async(
    operation: Callable[[], Awaitable],
    *,
    attempts: int = 3,
    base_delay: float = 0.25,
    max_delay: float = 4,
    retryable: Callable[[BaseException], bool] = is_transient_error,
    sleep: Callable[[float], Awaitable] = asyncio.sleep,
):
    if attempts < 1:
        raise ValueError("attempts debe ser positivo")
    if base_delay < 0 or max_delay < base_delay:
        raise ValueError("Los límites de backoff no son válidos")
    for attempt in range(attempts):
        try:
            return await operation()
        except Exception as error:
            if attempt == attempts - 1 or not retryable(error):
                raise
            await sleep(min(max_delay, base_delay * 2**attempt))
    raise AssertionError("retry_async terminó sin resultado")


class RateLimiter:
    """Ventana fija deslizante, local a una instancia del proceso."""

    def __init__(self, max_requests: int = 120, window_seconds: float = 60, max_clients: int = 10_000):
        if max_requests < 1 or window_seconds <= 0 or max_clients < 1:
            raise ValueError("La configuración del límite no es válida")
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_clients = max_clients
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()

    def retry_after(self, client_key: str, now: float | None = None) -> int | None:
        current = time.monotonic() if now is None else now
        timestamps = self._requests.get(client_key)
        if timestamps is None:
            if len(self._requests) >= self.max_clients:
                self._requests.popitem(last=False)
            timestamps = deque()
            self._requests[client_key] = timestamps
        else:
            self._requests.move_to_end(client_key)
        while timestamps and current - timestamps[0] >= self.window_seconds:
            timestamps.popleft()
        if len(timestamps) >= self.max_requests:
            return max(1, math.ceil(self.window_seconds - (current - timestamps[0])))
        timestamps.append(current)
        return None
