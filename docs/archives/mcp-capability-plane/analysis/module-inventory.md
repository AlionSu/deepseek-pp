# MCP Capability Plane — Module Inventory

This is a bounded inventory for the active transformation. The repository-wide baseline remains in the archived PC runtime hardening run.

| Module | Responsibility | Dependencies | Complexity | S.U.P.E.R Score |
|:--|:--|:--|:--|:--|
| `core/mcp/discovery.ts` | Cache/discover MCP descriptors and execute a real MCP target | store, client, transports, authorization | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `core/mcp/store.ts` / codec | Server/cache persistence | `chrome.storage.local` | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `core/tool/authorization.ts` | Background-owned grants and call reservations | storage, descriptor contracts | Critical | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `core/tool/runtime.ts` | Authorize, hydrate, route, persist tool calls | authorization, providers, history | Critical | S🟡 U🟢 P🟡 E🟡 R🟡 |
| `core/tool/provider-registry.ts` | Provider aggregation and provider-first routing | typed providers | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `core/prompt/augmentation.ts` | Prompt/tool Schema rendering | tool descriptors, i18n, memory | High | S🟡 U🟢 P🟡 E🟢 R🟡 |
| Background composition/handlers | Wire providers and receiver-owned runtime authority | browser messaging, core services | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Content manual/inline runtime | Prompt interception, authorization and continuation UI | MAIN bridge, background messages | Critical | S🔴 U🟡 P🟡 E🔴 R🟡 |
| Side Panel/automation chat loops | Prompt construction and trusted execution | background service, DeepSeek clients | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| MCP settings UI | Server configuration and tool visibility | typed runtime client | High | S🟡 U🟢 P🟡 E🟡 R🟡 |

## Transformation Notes

- The capability feature must not make `entrypoints/content.ts` another policy owner. It only requests a projection and displays returned descriptors.
- `ToolProviderRegistry` should not learn MCP-specific policy. A narrow, injected capability resolver can return an exact authorized target without importing concrete providers.
- Catalog entries are derived references over the existing cache, never an independently persisted full descriptor set.
- Direct and handle invocation must converge before provider execution and history persistence.
