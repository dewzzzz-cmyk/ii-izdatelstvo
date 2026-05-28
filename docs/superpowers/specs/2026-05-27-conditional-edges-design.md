# Conditional Edges — Design Spec
_2026-05-27_

## Goal
Allow pipeline branches: a node's output is only forwarded along an edge if a user-defined JS condition evaluates to `true`. Enables if/else routing without a framework.

## Data Model
Each edge gains an optional `condition` string field (default `""`).

```
state.edges[i] = { id, from, to, condition: "" }
```

## Evaluation
After `runNode(n)` completes, for each outgoing edge from `n`:
- If `condition` is empty → always active (current behaviour, no change)
- If `condition` is non-empty → evaluate `new Function('output', 'return (' + condition + ')')(n.output)`
  - On `true` → edge is active
  - On `false` or exception → edge is inactive; log a warning

## Effect on `runnableNodes()`
A node is "ready" when **all** its predecessor nodes are done/error AND **at least one** incoming edge is active (condition passed) **or** the node has no incoming edges.

If a node has incoming edges but none are active → set status `'skip'` and continue pipeline.

## UI Changes
1. **Edge click** → drawer titled "⚡ Условие ребра"
   - Textarea: `condition` expression (`output`, `output.length`, `JSON.parse(output)`, etc.)
   - Hint: "Переменная `output` — текст вывода агента"
   - "▶ Тест" button → evaluates condition against current source node output → shows ✅ true / ❌ false / ⚠ ошибка
   - "Сохранить" button
2. **Edge visual**: active edge = current style; conditional edge = `stroke-dasharray: 4 3` dashed when condition set; inactive (false) = grey dimmed

## Files to Change
- `app.js`:
  - `runnableNodes()` — check active edges
  - `runNode()` — after completion, evaluate outgoing conditions
  - Edge click handler — open condition drawer
  - `renderEdges()` — visual distinction for conditional edges
  - `defaultState()` — no change (condition defaults to `""`)
- `styles.css`:
  - `.edge.conditional` — dashed stroke
  - `.edge.inactive` — dimmed stroke

## Error Handling
- Bad JS expression → catch, log `logRow`, treat as inactive, show ⚠ badge on edge
- `output` undefined → treat as `""`, don't crash

## Testing
- Edge with `output.includes('X')` only activates when source output contains "X"
- Empty condition always activates (backward compatible)
- Exception in condition → edge inactive + warning in log
- Node with all edges inactive → status `'skip'`, pipeline continues
