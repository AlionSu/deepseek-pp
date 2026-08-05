# Phase 1: Core Capability Contracts

**Goal**: Add a derived catalog, explicit visibility settings and owner-bound capability lease execution without a generic authorization bypass.

## Tasks

- [x] **CP.1**: Capability settings, catalog projection and deterministic adaptive selection
  - Priority: P0
  - Effort: L
  - Test expectation: codec/settings, projection, visibility-policy and budget tests
  - Memory impact: record durable authorization/prompt invariant if implementation changes it
  - Acceptance: default direct behavior is stable; only policy-eligible descriptors may be selected; projection is deterministic and bounded.
- [x] **CP.2**: Capability lease and unified resolved-target execution
  - Priority: P0
  - Effort: XL
  - Test expectation: lease owner/digest/expiry/replay tests and runtime invocation integration
  - Memory impact: record capability-handle invariant if accepted
  - Acceptance: helper invocation cannot execute an arbitrary name; exact resolved target is authorized and persisted in history.

## Phase Notes

- `call(name,args)` is not accepted as authority. The only generic data-plane input is an opaque handle minted by background after descriptor policy filtering.
- The existing MCP cache stays the full descriptor truth source.
- Adaptive selection uses deterministic ranking plus a conservative rendered-prompt byte bound; Direct remains the default and excludes catalog controls.
- A consumed invoke handle maps to one live MCP descriptor only after snapshot/policy validation, then execution and history use the resolved target identity.

## Phase Completion Checklist

- [x] Both tasks complete with telemetry
- [x] MASTER.md counts updated
- [x] Phase 2 completed
