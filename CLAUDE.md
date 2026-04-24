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
│   ├── terrainClipStore.ts    # Terrain clipping (multi-region, vertex edit, undo, persistence)
│   ├── themeStore.ts          # Light/dark theme (localStorage persisted)
│   └── appStore.ts            # Global loading state
├── utils/
│   ├── cesium/index.ts        # Viewer factory (Ion token, terrain, loading state)
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

### Coding Style
- No JSDoc for obvious code; one-line comments for non-obvious WHY
- Section separators in longer files: `/* ===== Section ===== */`
- Prefer primitive array methods (`push`, `splice`, `forEach`, `filter`) over lodash
- Error handling: `try/catch` with `console.error` + `message.error()` from ant-design-vue
- Use `message.warning()` for validation feedback, `message.success()` for confirmations
- File names: PascalCase for `.vue`, camelCase for `.ts`
