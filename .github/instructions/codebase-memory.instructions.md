---
description: "Use when searching, exploring, refactoring, or doing impact analysis on this cherycode codebase. Triggers: codebase-memory, search_graph, trace_path, get_architecture, query_graph, get_code_snippet, find callers, dead code, architecture, dependencies, who calls, refactor candidates, impact analysis."
applyTo: "**"
---

# Codebase Memory — Always Use for Code Exploration

This project (`cherycode/`) is indexed in **codebase-memory** as project
`F-Code-cherycode` with **1,133 nodes / 1,949 edges**. Treat it as the
first-stop source for any code-understanding task.

## When to use it

| Task | Tool to start with |
|------|--------------------|
| Find where a function/class/route is defined | `search_graph` |
| Find who calls / is called by a function | `trace_path` |
| Understand module boundaries / clustering | `get_architecture(aspects=['clusters'])` |
| Check dependencies / fan-out / fan-in | `get_architecture(aspects=['hotspots','dependencies'])` |
| Read the actual source of a node | `get_code_snippet(qualified_name=...)` |
| Run a custom Cypher query (multi-hop, complexity stats) | `query_graph` |
| Detect what changed / impact of recent commits | `detect_changes` |

## When NOT to use it (fall back to grep / read_file)

- You only need a literal text match in a single file → use `grep_search`
- You already know the exact path and just want contents → use `read_file`
- The file is outside indexed dirs (e.g. `node_modules`, `dist`, `data/`, `uploads/`) → grep/read directly

## Standard workflow

1. **Identify the symbol** with `search_graph` (use BM25 natural-language query or `name_pattern` for regex).
2. **Read the source** with `get_code_snippet` if you need the body.
3. **Understand context** with `trace_path(direction='inbound' or 'outbound', depth=3)`.
4. **For deep analysis** (complexity, fan-out, dead code) drop into `query_graph` with Cypher.

## Important constraints

- The project name in this workspace is **`F-Code-cherycode`** (not `cherycode`) — always pass `project="F-Code-cherycode"` to every tool call.
- Auto-excluded dirs (won't be in the graph): `node_modules`, `dist`, `data`, `uploads`, `.git`.
- If a tool returns 0 results, the project may be stale — re-run `index_repository` before assuming the code doesn't exist.
- For very large / cross-cutting questions, combine graph queries with `get_architecture(aspects=['clusters'])` to see the Leiden-detected module boundaries first.

## Don't waste context

- Prefer `trace_path` over recursively grepping for callers — it deduplicates and ranks by structural importance.
- Prefer `get_architecture` over manually mapping directory structure — Leiden clustering reveals the *real* seams.
- Prefer `query_graph` for aggregations (e.g. "all functions with cyclomatic > 10") — single round-trip vs N file reads.