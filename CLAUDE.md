# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the App

```bash
node server.js
# or on Windows:
start-windows.bat
```

Serves on `http://localhost:8787` (override with `PORT` env var). No build step, no npm install — zero dependencies.

Optional env vars:
- `PROXY_TOKEN` — if set, clients must send matching `proxyToken` in request body

## Architecture

**ИИ-Издательство** is a single-page visual pipeline editor for orchestrating multi-agent AI book publishing workflows.

### Client-Server Split

- `server.js` — raw Node.js HTTP server (no Express). Serves static files and exposes one endpoint: `POST /api/generate`, which proxies requests to any OpenAI-compatible LLM and streams back raw text.
- `app.js` — entire frontend (~1000 lines, no framework). Manages all state, canvas rendering, pipeline execution, and UI.
- `index.html` / `styles.css` — minimal shell; all logic is in `app.js`.

### State Model

All application state lives in a single `state` object persisted to `localStorage`. Key top-level fields:

| Field | Description |
|---|---|
| `nodes[]` | Agent instances on the canvas |
| `edges[]` | Directional connections between nodes |
| `project` | Title, genre, audience, brief, source text, mode (`write`/`edit`) |
| `bible[]` | Knowledge base entries (`keys \| fact`) for continuity injection |
| `log[]` | Execution event history (capped at 200) |
| `global` | Global API URL, model, temperature, key, budget cap, retry count |
| `groups[]` | Visual node groups (name, color, nodeIds, collapsed) — purely layout, no effect on execution |

### Pipeline Execution Flow

1. `runPipeline()` — calls `runnableNodes()` repeatedly; each wave contains all nodes whose predecessors are done. Waves run as `Promise.all()` (parallel).
2. `runNode(node)` — builds a message array: bible matches → project context → upstream outputs (smart-truncated) → user task. Hashes the full message+config to detect unchanged cache hits.
3. Streams to `/api/generate`; tokens and cost accumulate per node. Partial output is saved every ~200 chars to survive network drops.
4. Nodes with `requireApproval = true` pause until the user clicks "Approve" (optional timeout via `approvalTimeoutMin`).
5. Errors do not stop the pipeline — the node gets `status='error'` and downstream nodes continue with `[АГЕНТ ПРОВАЛИЛСЯ]` as their input.
6. On HTTP 502/503, the proxy retries the request on `state.global.fallbackURL` if set.

### Bible / Canon System

The bible is a knowledge base used for continuity. Each entry has `keys` (comma-separated) and `text` (the canon fact). Before each `runNode`, `bibleFor(context)` uses **TF-IDF + cosine similarity** (pure JS, no CDN) for semantic lookup. Falls back to keyword/stem matching when corpus is small. `rebuildBibleVecs()` recomputes `_vec` TF-IDF vectors after any Bible edit; `_vec` is not serialized to JSON exports. The auto-build flow uses a hidden "архивариус" agent.

### Conditional Edges

Each edge has an optional `condition` string (default `""`). After a node completes, outgoing edges are evaluated via `evalCondition(cond, output)` using `new Function('output', ...)`. Empty condition = always active. In `runnableNodes()`, a node with all incoming conditions evaluating to false gets `status='skip'` and pipeline continues. Edges with conditions render with dashed purple stroke.

### Node Groups

`state.groups[]` stores visual-only groupings (id, name, color, nodeIds[], collapsed). Rendered as SVG `<rect>` elements in `edgesEl` (behind nodes). Non-collapsed: dashed border + draggable label; clicking `▾` collapses. Collapsed: solid pill showing member count; clicking opens edit drawer. Groups have no effect on pipeline execution. Dragging a group's label moves all member nodes together. Auto-membership: when a node is dropped, `updateGroupMembership()` checks if it entered/exited any group's bounding box.

### Agent Templates

11 built-in agent roles are defined as constants at the top of `app.js` (Scout, Structural Editor, Writer, Line Editor, Proofreader, Continuity Agent, Fact Checker, Art Director, Layout Designer, Metadata Specialist, Marketer). Each node can override the global API config (URL, model, temperature, key) individually.

### API Proxy (`/api/generate`)

Accepts `{ baseURL, apiKey, model, temperature, messages, proxyToken }`. Forwards to upstream LLM, streams `choices[0].delta.content` back as `text/plain`. Retries on 429/5xx with exponential backoff. Returns 502 on upstream failure with the upstream error body.

### Canvas Rendering

The canvas is a scrollable `<div>`. Nodes are absolutely-positioned `<div>` elements; edges are bezier paths in an `<svg>` overlay. Nodes are draggable; connections are created by dragging from output ports. No external graphics library.

### Export Formats

`openExport()` drawer offers four outputs:
| Button | Function | Notes |
|---|---|---|
| 📕 Скачать книгу (.md) | `exportBook()` | Markdown, all agent outputs with KDP checklist |
| 📄 Скачать Word (.doc) | `exportDocx()` | HTML-in-DOC trick, opens in Word/LibreOffice |
| 📗 Скачать EPUB | `exportEpub()` | True EPUB 3 ZIP, no external deps |
| ⬇ Экспорт проекта (.json) | inline | Full state including prompts and outputs |

EPUB is built by `ZipBuilder` (pure JS, STORE method, CRC-32 implemented inline). Structure: `mimetype` → `META-INF/container.xml` → `OEBPS/content.opf`, `nav.xhtml`, `toc.ncx`, `style.css`, `chapters/ch*.xhtml`. Text is processed by `typo()` then `md2xhtml()` (XHTML variant with self-closing `<hr/>` and `<br/>`).

**`typo()` note:** uses `[^\S\r\n]{2,}` to collapse double spaces — NOT `\s{2,}` — so newlines in Markdown source are preserved.

## Key Patterns

- **No framework, no bundler.** All DOM manipulation is manual. State mutations call `save()` then `render()`.
- **Caching:** Node outputs are cached by hashing messages + config. Re-running an unchanged node returns the cached result instantly.
- **Cost tracking:** Cyrillic text is estimated at `length/2` tokens (vs `length/4` for Latin). Per-model pricing constants in `PRICES`.
- **Parallel waves:** `runnableNodes()` detects ready nodes each iteration; independent nodes run via `Promise.all`.
- **Prompt history:** Each node keeps the last 20 versions of its prompt in `promptHistory[]` for revert.
- **ROLE_TEMPS:** Per-role default temperatures (`proof=0.2`, `writer=1.0`, etc.) set on node creation.
- **smartTrunc:** Keeps first/last 45% of long context; removes middle to avoid "lost-in-the-middle" attention loss.
- **Vector Bible:** `STOP_RU` stopwords + `tokensOf()` tokenizer + `tfvec()` TF-IDF + `cosine()` similarity. Falls back to keyword matching when < 2 Bible entries or no vectors.
- **Groups:** purely visual (`state.groups[]`). `renderGroups()` returns SVG prepended to `edgesEl.innerHTML`. Collapsed group nodes are filtered from `renderNodes()` and collapsed edges from `renderEdges()`.
