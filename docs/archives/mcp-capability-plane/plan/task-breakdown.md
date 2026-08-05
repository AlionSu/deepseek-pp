# MCP Capability Plane — Task Breakdown

## Overview

- **Total phases**: 2
- **Total tasks**: 5
- **Delivery batches**: 1 coherent implementation batch
- **Tracking mode**: LOCAL_ONLY
- **Scope reference**: GitHub Issue #407; no new public planning Issues are created in this run

## Global Design Constraints

- One authoritative MCP descriptor cache and one target authorization resolver.
- Direct descriptors and capability handles are only Prompt projections; neither creates another provider execution path.
- Every target execution verifies an exact descriptor security snapshot before provider payload rehydration/I/O.
- Capability visibility never widens existing server enablement, allowlist or execution policy.
- New persistent data is explicit, versioned, deterministic and fail-closed.
- Full Schema is never silently copied or silently truncated; any compact result identifies its limits.

## Phase 1: Core Capability Contracts

| ID | Task | Priority / effort | Depends on | Delivery batch | S.U.P.E.R | Test expectation | Acceptance |
|:--|:--|:--|:--|:--|:--|:--|:--|
| CP.1 | Implement capability settings, catalog projection and deterministic adaptive selection | P0 / L | — | CP-B1 | S,P,R | Unit tests for decode, policy, ranking and budget | Default remains direct; on-demand/adaptive projection only contains eligible true descriptors/helpers |
| CP.2 | Implement background-owned capability leases and a single resolved-target execution path | P0 / XL | CP.1 | CP-B1 | P,U,R | Lease/security/replay tests plus tool runtime integration | A handle maps to exactly one current descriptor, cannot cross owner/revision/expiry, and records actual tool execution |

## Phase 2: Runtime Surfaces and Product Controls

| ID | Task | Priority / effort | Depends on | Delivery batch | S.U.P.E.R | Test expectation | Acceptance |
|:--|:--|:--|:--|:--|:--|:--|:--|
| CP.3 | Route manual chat and inline-agent prompts through the shared projection | P0 / L | CP.1, CP.2 | CP-B1 | U,P,R | Request/authorization/inline-agent regressions | User request intent selects direct tools; capability control calls continue correctly |
| CP.4 | Route Side Panel chat and automation through the same projection; expose MCP visibility settings | P1 / L | CP.1, CP.2 | CP-B1 | S,U,P | Chat/automation/controller tests | All four surfaces agree on capability mode; users can configure it without altering execution allowlists |
| CP.5 | Contract closure, performance evidence and compatibility review | P0 / L | CP.1–CP.4 | CP-B1 | P,R | Targeted tests, compile, prompt freeze, MCP smoke/mock, all-browser build | No raw proxy bypass, default prompt fixture preserved, configured large catalogs stay bounded |

## Delivery Batch

| Batch | Tasks | Goal | Branch | Validation |
|:--|:--|:--|:--|:--|
| CP-B1 | CP.1–CP.5 | One architecture and rollback unit because all tasks share descriptor, authorization and continuation contracts | `codex/mcp-capability-plane` | targeted suites, compile, prompt freeze, MCP smoke/mock, build:all, final diff review |

## Delivery Status

CP-B1 is complete on the local branch. The full `npm run ci:quality` gate passed after the final contract, i18n and runtime-inventory updates.

## Adaptive Control

Phase 1 has 2 tasks: annotate=1, replan=1, rescope=2. Phase 2 has 3 tasks: annotate=1, replan=2, rescope=2. Any material unplanned dependency is recorded before the next task; threshold action is applied before continuing.
