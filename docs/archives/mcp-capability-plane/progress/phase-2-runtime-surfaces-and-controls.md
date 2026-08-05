# Phase 2: Runtime Surfaces and Controls

**Goal**: Apply one projection/handle contract to manual chat, inline agent, Side Panel and automation, then close compatibility evidence.

## Tasks

- [x] **CP.3**: Manual chat and inline-agent integration
  - Priority: P0
  - Effort: L
  - Test expectation: request augmentation, authorization handler and inline-agent regressions
  - Acceptance: capability helper results trigger the existing continuation safely; inline agent does not re-inject the full MCP catalog.
- [x] **CP.4**: Side Panel, automation and settings UI
  - Priority: P1
  - Effort: L
  - Test expectation: Side Panel chat, automation runner and MCP controller/UI tests
  - Acceptance: users can select visibility mode independently from execution allowlists; both background surfaces use the same projection.
- [x] **CP.5**: Contract closure and validation
  - Priority: P0
  - Effort: L
  - Test expectation: targeted suites, compile, prompt freeze, MCP smoke/mock, browser build and final diff review
  - Acceptance: legacy default prompt remains stable; configured on-demand/adaptive behavior is bounded and target identity checks reject tampering.

## Phase Completion Checklist

- [x] All tasks complete with telemetry
- [x] MASTER.md counts updated
- [x] Local closure evidence recorded; archive after merge/release closure

## Validation Evidence

- Targeted capability, authorization, controller and provider tests passed.
- `npm test` passed: 169 files / 1219 tests.
- `npm run ci:quality` passed, including prompt freeze, MCP smoke/mock, automation, persistence, cross-browser builds, package checks and offline Pyodide smoke.
