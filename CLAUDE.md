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
│   ├── Toolbox.vue            # Floating toolbar (GeoJSON / clip / point)
│   ├── SidePanel.vue          # Shared slide-in panel (glassmorphism)
│   ├── GeoJsonDrawer.vue      # GeoJSON upload & layer management
│   ├── TerrainClipDrawer.vue  # Terrain clipping panel
│   ├── PointCreator.vue       # Observation point creator
│   ├── CesiumNavigation.vue   # Theme toggle / zoom / home / compass
│   └── Compass.vue            # Draggable compass widget
├── stores/                    # Pinia stores
│   ├── cesiumStore.ts         # Viewer singleton
│   ├── geojsonStore.ts        # GeoJSON layer CRUD
│   ├── terrainClipStore.ts    # Terrain clipping coordinator (composes 4 sub-modules)
│   ├── themeStore.ts          # Light/dark theme (localStorage persisted)
│   └── appStore.ts            # Global loading state
├── utils/
│   ├── cesium/
│   │   ├── index.ts           # Viewer factory (Ion token, terrain, loading state)
│   │   ├── clipCommon.ts      # Terrain clip shared types & helpers
│   │   ├── useClipHistory.ts  # Terrain clip undo/redo stack
│   │   ├── useClipPersistence.ts # Terrain clip localStorage persistence
│   │   ├── useClipDrawing.ts  # Terrain clip polygon drawing mode
│   │   └── useClipEditing.ts  # Terrain clip vertex editing mode
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
- Always unwrap with `toRaw(viewer.value)` before Cesium API calls
- Check validity before use: `v && !v.isDestroyed()` (extract to `isValidViewer(v)` helper for frequent use)
- Cross-store access: call `useXxxStore()` inside store functions
- Return an object of refs/computed/functions at the end

### Cesium Patterns
- Viewer created once in `index.vue` via `createViewer()`, stored in cesiumStore
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

### Terrain Clip Architecture

Terrain clipping uses a **coordinator pattern**: `terrainClipStore` is a thin coordinator that composes 4 independent composables:

```
terrainClipStore (coordinator: region CRUD, globe sync, lifecycle)
├── useClipDrawing      — Drawing mode: left-click add vertex, double-click undo, right-click finish
├── useClipEditing      — Vertex editing: drag, midpoint add, right-click delete, keyboard shortcuts
├── useClipHistory      — Undo/redo stack (30 snapshots of Cartesian3[])
└── useClipPersistence  — localStorage save/load (Cartesian3 serialized as [x,y,z])
```

Key details:
- **Data flow**: `positions` ref shares reference with `regions[i].positions`, so mutations propagate automatically.
- **startDraw**: The store wraps this in a `startDraw()` function that creates a new `ClipRegion`, pushes it to `regions`, links `positions` to the new region's array, THEN delegates to `useClipDrawing.startDraw()`. This ensures the region exists before any vertices are added.
- **cancelDraw**: The store's `onCancel` callback removes the incomplete region from `regions` (happens when < 3 vertices or user cancels).
- **Undo/redo** after editing: store calls `editing.redraw()` to refresh edit graphics after history restore.

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
