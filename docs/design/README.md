# Design Documents

Historical design docs for features that were planned and implemented in this repo. They are kept for reference — the implementation may have evolved beyond what these documents describe.

- [2026-02-25-thompson-chain-implementation.md](2026-02-25-thompson-chain-implementation.md) — Task-by-task plan for adding Thompson Chain Reference study mode to the rob-agent (5th study session type, chain tool sequence, chain study journal).
- [2026-02-25-thompson-chain-study-mode-design.md](2026-02-25-thompson-chain-study-mode-design.md) — Design for Chain Study mode: Socratic enrichment of physical Thompson Bible chains using Logos MCP tools (lexicons first, commentaries last).
- [2026-02-25-response-cleanup-design.md](2026-02-25-response-cleanup-design.md) — Design for cleaning noisy MCP tool responses: strip XAML markup, drop debug metadata and useless fields from 5 tools.
- [2026-02-25-response-cleanup-plan.md](2026-02-25-response-cleanup-plan.md) — TDD implementation plan for the response cleanup: shared `stripXml`/`stripRichText` utilities, service-layer cleanup, handler simplification.
- [2026-10-15-logos54-fixes-and-study-data-design.md](2026-10-15-logos54-fixes-and-study-data-design.md) — Design for Logos 54 compatibility fixes (book numbers, verse anchors, link formats, Factbook IDs), study-data tools (reading plans, progress, history, passage lists, JSON output), and a passage commentary finder, delivered as three PRs.

*Previously located in `docs/plans/` and `logos-mcp-server/docs/plans/`; consolidated here on 2026-08-03.*
