"""Manifest-driven narration mastering API over durable attempt artifacts."""

from __future__ import annotations

import json
from typing import Any

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
from qwen_tts_worker.workspace_contracts import canonical_narration_manifest


router = APIRouter(prefix="/narrations")


class MasterNarrationRequest(BaseModel):
    plan: AssemblyPlan
    profile: MasteringProfile | None = None


def _canonical_workspace_manifest(report: MasteringReport) -> dict[str, Any]:
    store = attempt_store()
    segments = []
    for entry in report.manifest.entries:
        jobs = [
            job for job in store.list_jobs()
            if job.attempt_id == entry.accepted_attempt_id and not job.cache_hit
        ]
        if len(jobs) != 1:
            raise MasteringError(
                f"accepted attempt {entry.accepted_attempt_id} does not map to one generating job"
            )
        segments.append(jobs[0].segment)
    return canonical_narration_manifest(report.manifest, tuple(segments))


@router.post("/master", response_model=MasteringReport)
def master_narration(request: MasterNarrationRequest) -> MasteringReport:
    store = attempt_store()
    try:
        report = NarrationMasterer(profile=request.profile).master(
            request.plan,
            store.root,
            store.root,
        )
        canonical = _canonical_workspace_manifest(report)
        path = store.root / "mastered" / report.assembly_id / "narration-manifest.json"
        path.write_text(json.dumps(canonical, indent=2) + "\n", encoding="utf-8")
        return report
    except MasteringError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{assembly_id}", response_model=MasteringReport)
def get_mastered_narration(assembly_id: str) -> MasteringReport:
    path = attempt_store().root / "mastered" / assembly_id / "mastering-report.json"
    try:
        return MasteringReport.model_validate_json(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"unknown mastered narration {assembly_id}") from exc


@router.get("/{assembly_id}/workspace-manifest", response_model=dict[str, Any])
def get_workspace_narration_manifest(assembly_id: str) -> dict[str, Any]:
    path = attempt_store().root / "mastered" / assembly_id / "narration-manifest.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"unknown canonical narration manifest {assembly_id}") from exc
