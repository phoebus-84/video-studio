"""Manifest-driven narration mastering API over durable attempt artifacts."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from qwen_tts_worker.narration_mastering import (
    AssemblyPlan,
    MasteringError,
    MasteringProfile,
    MasteringReport,
    NarrationMasterer,
)
from qwen_tts_worker.routes.attempts import attempt_store


router = APIRouter(prefix="/narrations")


class MasterNarrationRequest(BaseModel):
    plan: AssemblyPlan
    profile: MasteringProfile | None = None


@router.post("/master", response_model=MasteringReport)
def master_narration(request: MasterNarrationRequest) -> MasteringReport:
    store = attempt_store()
    try:
        return NarrationMasterer(profile=request.profile).master(
            request.plan,
            store.root,
            store.root,
        )
    except MasteringError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{assembly_id}", response_model=MasteringReport)
def get_mastered_narration(assembly_id: str) -> MasteringReport:
    path = attempt_store().root / "mastered" / assembly_id / "mastering-report.json"
    try:
        return MasteringReport.model_validate_json(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"unknown mastered narration {assembly_id}") from exc
