# Node Groups — Design Spec
_2026-05-27_

## Goal
Allow grouping agent nodes into named, collapsible groups for cleaner canvas layout with 8+ nodes.

## Data Model
```js
state.groups = []   // new top-level field

group = {
  id: uid(),
  name: "Редактура",
  color: "#6c63ff",   // accent color, user-choosable from 6 presets
  nodeIds: [],        // which nodes belong
  collapsed: false,
  x: 0, y: 0,        // position of group box (auto from nodes)
  w: 0, h: 0         // auto-computed from member nodes' positions
}
```

`_vec` is not needed. Groups stored in `state.groups[]`, included in export/import.

## Rendering
Groups rendered as SVG `<rect>` elements **behind** nodes (inserted before `.nodes` div).
- Non-collapsed: transparent fill with 20% opacity accent color border, label top-left
- Collapsed: solid pill replacing all member nodes, shows member count badge
- Group box auto-sizes to contain all member nodes + 20px padding

When a member node is dragged outside the group bounds → auto-remove from group.
When a node is dragged inside a group box → auto-add to group (snap-to-group).

## UI
1. **New topbar button** `⊞ Группа` → opens "Create Group" drawer:
   - Name field
   - Color picker (6 preset chips)
   - "Выберите узлы" → checkboxes for each node
   - "Создать" button
2. **Group label click** → opens edit drawer (rename, color, add/remove nodes, delete)
3. **Collapse button** (▾/▸ in label) → toggle `collapsed`
4. **Collapsed view**: single rounded rect with name + "(N агентов)" badge

## Collapsed Pipeline Behaviour
Collapsed groups do NOT affect execution. Pipeline runs all nodes normally regardless of group state. Groups are purely visual.

## Canvas Interactions
- Dragging group label → move entire group + all member nodes together
- Dragging individual node → moves node, group recomputes bounds

## Files to Change
- `app.js`:
  - `defaultState()` → add `groups: []`
  - `load()` → handle missing `groups` with `|| []`
  - `renderEdges()` / `renderNodes()` → render groups behind nodes
  - New `renderGroups()` function called from `render()`
  - Drag handler → group bounds recalculation
  - New `openGroupEditor(id)` / `openGroupCreator()` functions
  - `data-action="group"` handler
- `index.html`:
  - Add `<button class="btn ghost" data-action="group">⊞ Группа</button>` to topbar
- `styles.css`:
  - `.group-rect` — SVG rect style
  - `.group-label` — text label
  - `.group-collapsed` — collapsed pill style

## Testing
- Create group with 2 nodes → rect surrounds them ✅
- Drag node out of group → removed from group ✅
- Collapse group → nodes hidden, pill shown ✅
- Pipeline runs regardless of group collapse state ✅
- Export/import preserves groups ✅
