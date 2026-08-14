# Agentic Video Production

This context defines the language for turning source material into repeatable video productions while preserving user control over each creative stage.

## Language

**Channel**:
A publication identity with a target audience, brand conventions, and platform defaults. It owns one or more series.
_Avoid_: Series, account, workspace

**Series**:
A recurring format within a channel that shares subject conventions, editorial patterns, style, voices, and production preferences.
_Avoid_: Channel, project, template

**Episode**:
One video production within a series, including its source material, intermediate artifacts, generated assets, revisions, and deliverables.
_Avoid_: Job, project, run

**Content Pipeline**:
A specialized production path that transforms a kind of source material into an episode. Different content pipelines may share later production capabilities while retaining distinct intake, adaptation, and validation stages.
_Avoid_: Universal pipeline, workflow

**Production Stage**:
A named, independently reviewable step in a content pipeline that consumes artifacts and produces new artifacts. A stage can be executed, corrected, or re-executed without restarting the whole episode.
_Avoid_: Task, opaque step

**Production Core**:
The shared capabilities used by multiple content pipelines for scene planning, asset generation, narration, captioning, composition, and review. It does not decide how source material should be interpreted.
_Avoid_: Pipeline

**Pipeline Definition**:
The reusable description of a content pipeline, including its stages, artifact flow, approval points, and completion criteria. It is distinct from any one episode's execution of that pipeline.
_Avoid_: Workflow template, script

**Series Pipeline Override**:
A series-owned specialization that explicitly inherits and changes a pipeline definition by stable stage identity. It may replace, insert, disable, or reconfigure stages without modifying the inherited definition.
_Avoid_: Implicit merge, copied pipeline

**Pipeline Snapshot**:
The fully resolved, immutable pipeline definition attached to an episode. It preserves the production contract that governed that episode even if the source definitions later change.
_Avoid_: Current pipeline, override

**Pipeline Runtime**:
The deterministic keeper of pipeline state, artifact contracts, dependencies, approval gates, and execution history. It enables reliable execution without making editorial or creative decisions.
_Avoid_: Orchestrator, director, agent

**Executive Producer**:
The Pi agent role that interprets user intent and makes editorial, creative, and tool-selection decisions while operating within a pipeline definition.
_Avoid_: Pipeline runtime, workflow engine

**Workspace**:
The canonical, filesystem-based record of series and episode intent, artifacts, assets, feedback, execution history, and deliverables. Agent sessions and GUI indexes are views over this record, not substitutes for it.
_Avoid_: Database, session, cache

**Execution Journal**:
The append-only history of production events such as stage transitions, approvals, comments, attempts, and supersessions. It explains how the current workspace state came to exist.
_Avoid_: Log file, current state

**Editorial Artifact**:
A human-readable production document whose prose and metadata together form one canonical, revisioned input or output of a stage.
_Avoid_: Database record, generated report

**Asset Manifest**:
The machine-generated inventory connecting every media asset to its source artifact revision, generation attempt, provider provenance, cost, and production role.
_Avoid_: Assets folder, gallery

**Stale Derivative**:
An artifact or asset whose recorded source revision is older than the current source. It remains available for comparison but is not considered current production output.
_Avoid_: Deleted output, invalid file

**Approval Policy**:
The series- or episode-level agreement governing which checkpoints pause for a person. Autopilot records non-blocking checkpoints, guided mode pauses at declared creative gates, and manual mode pauses after every stage.
_Avoid_: Pipeline, permission

**Material Downgrade**:
A proposed change that breaks an approved delivery promise, such as substituting still illustrations for required motion or removing narration. It always requires explicit approval, regardless of approval policy.
_Avoid_: Fallback, retry

**Budget Envelope**:
The pre-approved spending boundary within which paid production actions may proceed autonomously. Exceeding it is a blocking condition rather than an invitation to silently reduce quality.
_Avoid_: Cost estimate, account balance

**Provider Adapter**:
A production integration that translates a stable capability request into a provider-specific job and normalizes its results, provenance, cost, and lifecycle into workspace artifacts.
_Avoid_: Pipeline, MCP tool, model

**Voice Profile**:
A reusable description of a narration voice, including its synthesis mode, speaker or reference material, language, performance defaults, and review history. It identifies a voice independently of any one generated audio file.
_Avoid_: Speaker name, audio asset, model

**Narration Segment**:
An independently synthesized and addressable portion of narration linked to a script revision and timing intent. Segments can be regenerated without replacing unaffected narration.
_Avoid_: Paragraph, complete narration

**TTS Worker**:
The long-lived local process that manages speech models and synthesis jobs while exposing backend-neutral lifecycle and generation operations.
_Avoid_: Pi extension, voice profile, pipeline

**Edit Timeline**:
The declarative, reviewable account of how selected visual and audio assets are arranged over time to form an episode. It is the editorial source from which executable composition commands are derived.
_Avoid_: FFmpeg command, render, scene plan

**Render Report**:
The machine-generated evidence describing how a deliverable was composed and validated, including the resolved command, media probes, quality checks, and source timeline revision.
_Avoid_: Edit timeline, video file

**Visual Bible**:
A series-owned definition of its recurring visual language, including palette, typography, composition rules, subjects, continuity anchors, and prohibited treatments.
_Avoid_: Scene prompt, mood board, style name

**Art Direction Pack**:
An episode-specific resolution of the Visual Bible into concrete mood, references, character or object sheets, diagram conventions, and continuity constraints.
_Avoid_: Visual Bible, asset manifest

**Asset Attempt**:
An immutable generation result together with the exact inputs, provider parameters, provenance, cost, and source revisions that produced it. One or more attempts may exist for the same production role.
_Avoid_: Asset revision, overwritten asset

**Selected Asset**:
The asset attempt currently chosen to fulfill a production role in the edit timeline. Selection may change without deleting or rewriting prior attempts.
_Avoid_: Latest asset, final asset

**Content Plan**:
A series-level editorial map that turns a broad source into an ordered set of episode briefs with shared audience, terminology, progression, and reusable source analysis.
_Avoid_: Episode, batch job, pipeline

**Review Thread**:
A persistent conversation anchored to a specific revision and location in an editorial artifact, scene, asset attempt, narration segment, or deliverable timecode.
_Avoid_: Prompt, transient chat message, edit

**Stage Attempt**:
One preserved execution of a production stage, including its inputs, outputs, status, and diagnostics. Re-execution creates another attempt rather than erasing the previous one.
_Avoid_: Stage, retry counter

**Current Deliverable**:
A render whose dependency revisions are current or whose stale dependencies were explicitly accepted. Other renders remain valid historical attempts but are not presented as current.
_Avoid_: Latest file, final forever

**Agent Gateway**:
The trusted service that owns episode-associated Pi RPC processes, translates review actions into contextual agent messages, and exposes one authenticated live stream to browser clients.
_Avoid_: Pi extension, pipeline runtime, web GUI

**Source Snapshot**:
A read-only, revision-pinned capture or reference to material from which a production is derived. It preserves provenance and prevents later source changes from silently altering an episode.
_Avoid_: Working copy, current repository

**Capability**:
A provider-neutral production operation required by a stage, such as speech synthesis, illustration generation, deterministic graphics rendering, or video composition.
_Avoid_: Tool name, provider, model endpoint
