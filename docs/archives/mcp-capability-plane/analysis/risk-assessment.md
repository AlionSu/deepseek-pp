# MCP Capability Plane — Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key finding | Priority |
|:--|:--|:--|:--|
| S | 🟢 | Projection, lease and local helper contracts are isolated in focused MCP core modules. | Low |
| U | 🟢 | All four surfaces share one projection and resolved-target path. | Low |
| P | 🟢 | Scope/handle contracts are serializable, background-owned and one-use. | Low |
| E | 🟢 | Browser storage/runtime assumptions remain explicit; no mobile surface was added. | Low |
| R | 🟢 | Existing MCP transports remain replaceable behind a narrow projection/runtime integration. | Low |

**Overall Health**: 5/5 green for the delivered capability-plane boundary. Descriptor snapshot authorization remains the foundation; the implementation deliberately rejects a generic `call(name, args)` proxy.

## Risk Matrix

| Risk | Impact | Likelihood | Mitigation |
|:--|:--|:--|:--|
| Generic invoke bypasses per-tool policy | Critical | Low | Opaque lease binds the exact descriptor/digest/owner; central resolver returns the real target before provider I/O |
| Tool Schema bloat merely moves into results | High | Low | Discover cards, describe fields and result sizes are bounded; full schema is never silently copied |
| Surface-specific descriptor snapshots drift | High | Low | One projection service is used by content grant, Side Panel, automation and inline agent |
| Stale cache executes changed tool | Critical | Low | Reservation and real MCP execution require current descriptor security equivalence |
| Storage change silently changes legacy prompt bytes | High | Low | Independent settings default to direct legacy behavior; prompt freeze passed |
| Handle replay across tabs/runs | Critical | Low | Background-owned owner, generation, digest, expiry and one-use reservation checks |
| Standard MCP discovery remains costly | Medium | High | Intentional residual: this fixes prompt bloat; catalog-aware transport discovery is a separate future concern |

## Compatibility Concerns

- Existing servers default to direct/full exposure, preserving legal prompt output until a user opts into adaptive/on-demand mode.
- Existing tool XML tags, MCP transports, server/cache schema and actual tool calls remain compatible.
- New runtime message fields are decoded at the receiving boundary and cannot carry tool authority.
- A stale/corrupt/future lease/settings record fails visibly without replacing it.
- `mcp_invoke` accepts only a capability handle, never an arbitrary remote tool name and argument pair.
