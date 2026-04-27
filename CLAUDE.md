# CesiumGeojson

## Tech Stack
- Vue 3 + TypeScript (Composition API, `<script setup>`)
- Vite 8 (build), vue-tsc 3 (type-check)
- Pinia 3 (state management)
- Ant Design Vue 4 + @ant-design/icons-vue 7 (UI)
- Cesium 1.140 (3D globe, via vite-plugin-cesium-build)
- Vue Router 5 (hash-free history)

## Commands
- `pnpm dev` — start dev server
- `pnpm build` — type-check + production build
- `pnpm preview` — preview production build
- `pnpm lint` — ESLint check (src/)
- `pnpm lint:fix` — ESLint auto-fix
- `pnpm format` — Prettier check (src/)
- `pnpm format:fix` — Prettier auto-format
- `pnpm stylelint` — Stylelint check (CSS/Vue)
- `pnpm stylelint:fix` — Stylelint auto-fix

## VS Code Setup
- **Extensions**: ESLint, Prettier, Stylelint
- Auto-fix on save configured in `.vscode/settings.json`

## Project Structure
```
src/
├── components/Cesium/         # Map-related components
│   ├── index.vue              # Cesium container (creates Viewer)
│   ├── Toolbox.vue            # Floating toolbar (GeoJSON / clip / point / geoPath / geoPolygon)
│   ├── CesiumNavigation.vue   # Theme toggle / zoom / home / compass
│   ├── Compass.vue            # Draggable compass widget
│   ├── panels/                # Side panel tools
│   │   ├── SidePanel.vue      # Shared slide-in panel (glassmorphism)
│   │   ├── GeoJson.vue        # GeoJSON upload & layer management
│   │   ├── TerrainClip.vue    # Terrain clipping panel
│   │   ├── PointCreator.vue   # Observation point creator
│   │   ├── GeoPath.vue        # Geological path planning & measurement
│   │   └── GeoPolygon.vue     # Polygon geological survey (area & perimeter, slope, clipping)
│   └── shared/                # Reusable sub-components
│       ├── ElevationProfile.vue # Path elevation profile chart
│       ├── VertexTable.vue     # Generic vertex coordinate table
│       ├── SlopeAnalysis.vue   # Slope analysis (stats, distribution, legend)
│       └── EditToolbar.vue     # Shared editor toolbar (finish/undo/redo)
├── stores/                    # Pinia stores
│   ├── cesiumStore.ts         # Viewer singleton
│   ├── geojsonStore.ts        # GeoJSON layer CRUD
│   ├── terrainClipStore.ts    # Terrain clipping coordinator (composes 4 sub-modules)
│   ├── geoPathStore.ts        # Geological path CRUD, drawing, measurement
│   ├── geoPolygonStore.ts     # Multi-polygon CRUD, drawing, area/perimeter, slope analysis, terrain clipping, GeoJSON export
│   ├── themeStore.ts          # Light/dark theme (localStorage persisted)
│   └── appStore.ts            # Global loading state
├── types/
│   ├── geoPath.ts             # GeoPath, ElevationProfile, GeoPathType types
│   └── geoPolygon.ts          # GeoPolygon, GeoPolygonMeasureResult types
├── utils/
│   ├── cesium/
│   │   ├── index.ts           # Viewer factory (Ion token, terrain, loading state)
│   │   ├── clipCommon.ts      # Terrain clip shared types & helpers
│   │   ├── useClipHistory.ts  # Terrain clip undo/redo stack
│   │   ├── useClipPersistence.ts # Terrain clip localStorage persistence
│   │   ├── useClipDrawing.ts  # Terrain clip polygon drawing mode
│   │   ├── useClipEditing.ts  # Terrain clip vertex editing mode
│   │   ├── useKeyboardShortcuts.ts # Declarative keyboard shortcuts (cross-platform Ctrl/Cmd)
│   │   ├── usePathDrawing.ts  # Polyline drawing (left-click add, right-click finish)
│   │   ├── usePathEditing.ts  # Polyline vertex editing (drag/add/delete, open polyline)
│   │   ├── usePathMeasure.ts  # Geodesic distance calculation
│   │   ├── usePathProfile.ts  # Terrain elevation profile sampling & stats
│   │   ├── usePolygonDrawing.ts # Polygon drawing & area/perimeter measurement
│   │   ├── usePolygonEditing.ts # Polygon vertex editing (drag/add/delete, closed polygon)
│   │   └── usePolygonSlope.ts   # Terrain slope analysis (Horn algorithm, grid sampling)
│   └── geojson/index.ts       # GeoJSON coordinate inspection
├── views/Home.vue
├── layouts/index.vue
├── router/index.ts            # / → /cesium
├── App.vue                    # ConfigProvider wrapper
├── main.ts                    # App bootstrap
└── style.css                  # Theme CSS variables (light + dark)
```

## Key Conventions

### Vue Components
- Use `<script setup lang="ts">` + `defineOptions({ name: '...' })`
- Props typed with `defineProps<{ ... }>()`, emits with `defineEmits<{ ... }>()`
- Side panels use `<SidePanel :visible title @update:visible>` with v-model-compatible emit
- All tool panels follow the same pattern: wrapped in SidePanel with Space vertical layout
- Scoped styles only; use CSS custom properties (`var(--xxx)`) for theming
- Icon imports: `import { XxxOutlined } from '@ant-design/icons-vue'`

### Pinia Stores
- Composition API style: `defineStore('name', () => { ... })`
- Viewer accessed via `useCesiumStore().viewer` (computed ref)
- **Mandatory `toRaw(viewer.value)`**: Vue ref wraps Cesium class instances in a Proxy.
  Cesium relies on `instanceof` and `===` identity checks internally — a Proxy breaks both.
  Whenever extracting `Viewer` from a ref/computed to call Cesium APIs, always unwrap
  with `toRaw()`. Never call Cesium methods directly on `viewer.value` without `toRaw`.
- Check validity before use: `v && !v.isDestroyed()` (extract to `isValidViewer(v)` helper for frequent use)
- Cross-store access: call `useXxxStore()` inside store functions
- Return an object of refs/computed/functions at the end

### Cesium Patterns
- Viewer created once in `index.vue` via `createViewer()`, stored in cesiumStore
- **`toRaw(viewer.value)` rule**: `Viewer` obtained via `computed(() => cesiumStore.viewer)`
  is safe for read-only property access (e.g. `viewer.value.camera`). For method calls passed
  to Cesium APIs (`flyTo`, `dataSources.add/remove`, `scene.globe.pick`, etc.), always unwrap
  first: `toRaw(viewer.value).xxx()`.
- Entity management: `viewer.entities.add({ ... })` / `viewer.entities.remove(entity)`
- Type cast Cesium API objects as `any` when accessing custom properties or complex types
- Use `Cartesian3`, `Cartographic`, `Color` directly; avoid the `Cesium.xxx` namespace
- Screen-space interaction: `ScreenSpaceEventHandler` with typed `movement: any`
- For terrain picking: `scene.globe.pick(ray, scene)` with fallback to `camera.pickEllipsoid()`
- Height reference: `CLAMP_TO_GROUND` for terrain-clamped entities; `NONE` otherwise
- Clipping: `ClippingPolygon` → `ClippingPolygonCollection` set on `scene.globe.clippingPolygons`

### Theme System
- `data-theme="light|dark"` on `<html>` controls CSS variable sets
- Ant Design theme syncs via `ConfigProvider` with `theme.darkAlgorithm` / `theme.defaultAlgorithm`
- Theme choice persisted in localStorage key `cesium-theme`
- **Slope classification colors** defined as CSS custom properties in `src/style.css`: `--slope-gentle` (#52c41a), `--slope-moderate` (#faad14), `--slope-steep` (#ff4d4f). Reference via `var(--slope-*)` in scoped CSS; JS rendering contexts (SVG, Cesium Color) still use hardcoded string literals

### Terrain Clip Architecture

Terrain clipping uses a **coordinator pattern**: `terrainClipStore` is a thin coordinator that composes 4 independent composables, plus a shared keyboard shortcuts composable:

```
terrainClipStore (coordinator: region CRUD, globe sync, lifecycle)
├── useClipDrawing      — Drawing mode: left-click add vertex, double-click undo, right-click finish
│   └── useKeyboardShortcuts  — Escape/Backspace/Enter
├── useClipEditing      — Vertex editing: drag, midpoint add, right-click delete
│   └── useKeyboardShortcuts  — Escape/Enter/Delete/Backspace, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo
├── useClipHistory      — Undo/redo stack (30 snapshots of Cartesian3[])
└── useClipPersistence  — localStorage save/load (Cartesian3 serialized as [x,y,z])
```

Key details:
- **Data flow**: `positions` ref shares reference with `regions[i].positions`, so mutations propagate automatically.
- **startDraw**: The store wraps this in a `startDraw()` function that creates a new `ClipRegion`, pushes it to `regions`, links `positions` to the new region's array, THEN delegates to `useClipDrawing.startDraw()`. This ensures the region exists before any vertices are added.
- **cancelDraw**: The store's `onCancel` callback removes the incomplete region from `regions` (happens when < 3 vertices or user cancels).
- **Undo/redo** after editing: store calls `editing.redraw()` to refresh edit graphics after history restore.

### Keyboard Shortcuts (`useKeyboardShortcuts`)

A standalone composable for declarative keyboard shortcuts:

```typescript
interface ShortcutDef {
  key: string;     // e.key value, e.g. 'z', 'Escape', 'Delete'
  meta?: boolean;  // Ctrl on Win/Linux, Cmd on Mac (platform-detected)
  shift?: boolean; // Require Shift
  handler: (e: KeyboardEvent) => void;
}

const kb = useKeyboardShortcuts(shortcutDefs);
kb.setup();    // Activate (typically on mode enter)
kb.teardown(); // Deactivate (typically on mode exit)
```

Rules:
- `meta: true` checks `metaKey` on Mac, `ctrlKey` on Win/Linux
- Non-meta shortcuts are blocked when any modifier key is pressed (prevents browser conflicts)
- `e.preventDefault()` is called automatically on matched shortcuts
- Used by `useClipEditing` and `useClipDrawing` for their keyboard interactions

### GeoPath Architecture

Geological path planning uses the same **coordinator pattern** as terrain clipping:

```
geoPathStore (coordinator: multi-path CRUD, drawing, editing, Cesium entity management)
├── usePathDrawing       — Polyline drawing: left-click add, right-click finish, Backspace undo
│   └── useKeyboardShortcuts  — Escape/Backspace/Enter
├── usePathEditing       — Polyline vertex editing: drag, midpoint add, right-click delete
│   └── useKeyboardShortcuts  — Escape/Enter, Delete/Backspace, Ctrl/Cmd+Z/Y
├── useClipHistory       — Undo/redo stack (30 snapshots of Cartesian3[])
├── usePathMeasure       — Geodesic distance calculation (segments + total)
└── usePathProfile       — Terrain elevation profile sampling via sampleTerrain
```

Key details:
- **Shared-ref pattern**: `positions` ref in store = `path.positions` (same array reference). During drawing, mutations to `positions` propagate directly to the path.
- **startDraw(type)**: Creates a new `GeoPath` with auto-color, pushes to `paths`, links `positions`, then delegates to `usePathDrawing.startDraw()`.
- **finishDraw()**: Async — calculates distances via `calcPathDistances`, creates Cesium polyline entity, samples terrain profile via `samplePathProfile`. After editing, elevation profile is cleared (`null`) and can be re-sampled via `resampleProfile()`.
- **Editing**: Enter/Escape to exit edit mode, Delete/Backspace to remove vertex (min 2 vertices), Ctrl+Z/Y for undo/redo. Camera locks during editing.
- **Elevation profile**: Samples terrain at 10m intervals along the path, computes min/max/avg/climb/descent/gradient, rendered as inline SVG chart. Re-sample button shown when profile is stale.
- **GeoJSON import/export**: Cartesian3 → [lng, lat, height] conversion, FeatureCollection blob download. Import supports `.geojson` / `.json` files via file picker.
- **Path colors**: 8-color cycle (`#FF4D4F`, `#52C41A`, `#1890FF`, `#FAAD14`, `#722ED1`, `#13C2C2`, `#EB2F96`, `#FA541C`). Drawing preview color matches assigned path color.

### GeoPolygon Architecture

Polygon geological survey uses a coordinator store with drawing, editing, slope analysis, and terrain clipping:

```
geoPolygonStore (coordinator: multi-polygon CRUD, drawing, editing, entity management, slope analysis, terrain clipping)
├── usePolygonDrawing    — Polygon drawing: left-click add, right-click finish, Backspace undo
│   └── useKeyboardShortcuts  — Escape/Backspace/Enter
├── usePolygonEditing    — Polygon vertex editing: drag, midpoint add, right-click delete
│   └── useKeyboardShortcuts  — Escape/Enter, Delete/Backspace, Ctrl/Cmd+Z/Y
├── useClipHistory       — Undo/redo stack (30 snapshots of Cartesian3[])
├── usePolygonSlope      — Terrain slope analysis with Horn algorithm (standalone async function)
├── syncPolygonClipping  — Built-in per-polygon terrain clipping via ClippingPolygonCollection
└── toggleClippingInverse — Inverse clipping mode (show outside polygon)
```

Key details:
- **Shared-ref pattern**: `positions` ref in store = `polygon.positions` (same array reference).
- **startDraw()**: Creates a new `GeoPolygon` with auto-color, pushes to `polygons`, links `positions`, then delegates to `usePolygonDrawing.startDraw()`.
- **finishDraw()**: Saves measurement result, creates Cesium polygon entity (semi-transparent fill + outline + map label). Samples terrain elevation at each vertex via `sampleVertexElevation()`.
- **Editing**: Enter/Escape to exit edit mode, Delete/Backspace to remove vertex (min 3 vertices), Ctrl+Z/Y for undo/redo. Camera locks during editing. Vertex elevations are cleared during edits and re-sampled on exit.
- **Area calculation**: Spherical polygon formula with authalic sphere (R = 6371000m): `R² × |sum(dLon × sin(avgLat))| / 2`.
- **Perimeter**: Geodesic distance via `EllipsoidGeodesic.surfaceDistance` for each edge (includes closing edge).
- **Smart units**: Area < 10,000 m² → m², < 1,000,000 m² → ha (hectares), ≥ 1,000,000 m² → km². Perimeter < 1000m → m, ≥ 1000m → km.
- **Map labels**: Each polygon entity has a `label` at its centroid showing name + area. Toggleable via `toggleLabels()`.
- **Vertex data**: Expanded detail shows vertex table with lng/lat/height/elevation. Supports copy to clipboard and CSV export.
- **Vertex elevation**: Terrain elevation sampled at each vertex via Cesium `sampleTerrain()` on finishDraw and after editing.
- **Colors**: 8-color cycle (same as geoPath).
- **GeoJSON import/export**: FeatureCollection with closed-ring Polygon geometry. Clipping state persisted in properties. Import supports `.geojson` / `.json` files via file picker.

#### Slope Analysis (`usePolygonSlope.ts`)

Standalone async analysis using the **Horn (1981) algorithm**:

1. Generate a regular grid inside the polygon bounding box (up to 300×300, ~20000 sample points)
2. Sample terrain heights via `sampleTerrain(provider, level=13, cartos)`
3. Compute slope with 3×3 Horn window: `slope = sqrt(dx² + dy²)` where dx/dy are weighted elevation gradients
4. Report both **percent slope** and **angle (°)**: `angle = atan(slopeVal) × 180/π`
5. Classification thresholds: `< 5°` gentle (green), `5-15°` moderate (yellow), `≥ 15°` steep (red)
6. Returns per-point `SlopeGridPoint[]` with lon/lat/height/slope/angle/category for map coloring

**Important**: Cartographic lon/lat is in **radians** — when computing bounding box dimensions in meters, multiply by `180/π` to convert degrees to meters. See `usePolygonSlope.ts` for details.

#### Terrain Clipping

Per-polygon terrain clipping toggleable from the detail panel:
- `poly.clipping` — boolean field on GeoPolygon, persisted in GeoJSON export/import
- `toggleClipping(id)` — enable/disable clipping for a polygon (min 3 vertices required)
- `syncPolygonClipping()` — collects all clipping-enabled polygons, creates `ClippingPolygonCollection` on `scene.globe.clippingPolygons`
- `clippingInverse` — global toggle to show terrain **outside** the polygon instead of inside (red highlight when active)
- Inverse button disabled when no polygon has clipping enabled
- Only one `ClippingPolygonCollection` can be active on the globe — conflicts with `terrainClipStore` if both used simultaneously

### Coding Style
- Files start with `/* ===== Header ===== */` describing file responsibility (in Chinese for domain code, English for infra)
- Vue components include `<!-- header comment -->` at the top of `<template>` explaining purpose
- Functions get a one-line comment describing what they do and why, focusing on non-obvious logic
- Section separators in longer files: `/* ===== Section ===== */`
- Comments in Chinese for project-domain code (stores, components, terrain clip utils), English for generic/CLI code
- Prefer primitive array methods (`push`, `splice`, `forEach`, `filter`) over lodash
- Error handling: `try/catch` with `console.error` + `message.error()` from ant-design-vue
- Use `message.warning()` for validation feedback, `message.success()` for confirmations
- File names: PascalCase for `.vue`, camelCase for `.ts`

### Code Formatting (ESLint + Prettier)
- Config: `eslint.config.mjs` (flat config), `.prettierrc`
- Single quotes, semicolons, trailing commas, 120 print width
- Before committing: run `pnpm format:fix && pnpm lint:fix` to auto-fix all issues
- ESLint: TS strict rules + Vue recommended rules; `any` allowed with warning; unused vars error except `_`-prefixed args

### CSS Style Constraints (Stylelint)
- Config: `.stylelintrc.json` with `stylelint-config-standard` + `stylelint-order`
- **Property order**: positioning → display/box → margin/padding → border/background → typography → visual → animation (enforced by `stylelint-order`)
- **Naming**: kebab-case selectors (BEM-like: `.block__element--modifier`); kebab-case custom properties (`--custom-property`)
- **Best practices**: use shorthand properties where possible, prefer modern color notation (`rgb(1 2 3 / 0.5)`), use number for alpha values
- Scoped styles only (no global style leakage from components)
