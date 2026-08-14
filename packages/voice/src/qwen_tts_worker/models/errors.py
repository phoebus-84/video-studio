"""Structured error envelope with redaction guarantees.

Every error response follows the same envelope shape so consumers can
parse diagnostics reliably. Stack traces and internal details are
never leaked to responses, even when the server runs in debug mode.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    """A single validation or processing error detail."""

    loc: list[str] = Field(
        default_factory=list,
        description="Path to the field or element that caused the error.",
    )
    msg: str = Field(..., description="Human-readable error message.")
    type: str = Field(
        default="value_error",
        description="Machine-readable error code.",
    )


class ErrorEnvelope(BaseModel):
    """Standard error response envelope.

    Every non-2xx response body conforms to this shape. The ``detail``
    list is always present, even when empty. Internal tracebacks and
    sensitive data are **never** included.
    """

    error: str = Field(
        ...,
        description="Top-level error description — safe for end-user display.",
    )
    detail: list[ErrorDetail] = Field(
        default_factory=list,
        description="Per-field or per-constraint error details, if applicable.",
    )
    request_id: str | None = Field(
        default=None,
        description="Server-side request identifier for log correlation.",
    )

    @classmethod
    def from_exception(cls, exc: Exception, request_id: str | None = None) -> ErrorEnvelope:
        """Build a redacted envelope from an unhandled exception.

        Args:
            exc: The caught exception. Its message is included only
                when it is safe to expose to callers.
            request_id: Optional log-correlation identifier.

        Returns:
            An ``ErrorEnvelope`` with a safe top-level message.
        """
        return cls(
            error=_safe_message(exc),
            request_id=request_id,
        )


def _safe_message(exc: BaseException) -> str:
    """Return a safe, user-visible message for the given exception.

    Never returns stack traces, internal paths, or sensitive data.
    """
    # FastAPI / Starlette HTTP exceptions carry a safe detail string.
    if hasattr(exc, "status_code") and hasattr(exc, "detail"):
        detail: Any = getattr(exc, "detail")
        if isinstance(detail, str):
            return detail
        if isinstance(detail, list):
            return "; ".join(
                d.get("msg", str(d)) if isinstance(d, dict) else str(d) for d in detail
            )
        return str(detail)

    # For unknown exceptions, return a generic message only.
    cls_name = type(exc).__name__
    return f"Internal server error ({cls_name})"
