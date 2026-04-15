# CesiumGeojson 项目文档

基于 Vue 3 + TypeScript + Vite + Cesium 的 GeoJSON 可视化与地形裁切工具。

## 项目概述

CesiumGeojson 是一个基于 WebGL 的三维地球可视化应用，支持加载 GeoJSON 地理数据并进行图层管理，同时提供地形裁切功能。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Vue | 3.5.32 |
| 类型系统 | TypeScript | ~6.0.2 |
| 构建工具 | Vite | 8.0.4 |
| 状态管理 | Pinia | 3.0.4 |
| 路由 | Vue Router | 5.0.4 |
| UI 组件库 | Ant Design Vue | 4.2.6 |
| 三维地图 | Cesium | 1.140.0 |
| Cesium 构建插件 | vite-plugin-cesium-build | 0.7.4 |

## 目录结构

```
cesiumGeojson/
├── public/
│   ├── favicon.svg          # 网站图标
│   └── icons.svg            # 图标资源
├── src/
│   ├── assets/             # 静态资源（图片/SVG）
│   ├── components/
│   │   └── Cesium/
│   │       ├── index.vue           # Cesium 地图容器主组件
│   │       ├── GeoJsonDrawer.vue   # GeoJSON 管理抽屉
│   │       ├── TerrainClipDrawer.vue # 地形裁切抽屉
│   │       ├── CesiumNavigation.vue  # 导航控制（缩放/定位/罗盘）
│   │       └── Compass.vue          # 可拖拽罗盘控件
│   ├── layouts/
│   │   └── index.vue       # 根布局组件（包含 Spin 加载状态）
│   ├── router/
│   │   └── index.ts        # 路由配置
│   ├── stores/
│   │   ├── appStore.ts     # 全局状态（主题/加载状态）
│   │   ├── cesiumStore.ts  # Cesium Viewer 实例管理
│   │   ├── geojsonStore.ts # GeoJSON 图层与要素管理
│   │   └── terrainClipStore.ts # 地形裁切状态与绘制逻辑
│   ├── utils/
│   │   ├── cesium/
│   │   │   └── index.ts    # Viewer 创建与初始化
│   │   └── geojson/
│   │       └── index.ts    # GeoJSON 坐标解析工具函数
│   ├── views/
│   │   └── Home.vue        # 首页视图
│   ├── App.vue             # 根组件
│   ├── main.ts             # 应用入口
│   └── style.css           # 全局样式
├── .env                    # 环境变量（包含 Cesium Ion Token）
├── .env.example            # 环境变量示例
├── index.html              # HTML 入口
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
└── README.md
```

## 核心功能

### 1. GeoJSON 可视化管理

**功能说明：**
- 上传本地 `.geojson` 或 `.json` 文件
- 自动解析 GeoJSON 要素并按类型着色（点/线/面）
- 图层列表管理：搜索、显示/隐藏、删除、定位
- 要素属性查看
- 自动飞行至加载的数据区域

**支持的几何类型：**
- Point（点）
- LineString / MultiLineString（线）
- Polygon / MultiPolygon（面）
- GeometryCollection
- FeatureCollection

**存储结构：**

```typescript
interface GeoJsonFeature {
  id: string
  name: string
  entity: any
  properties: Record<string, any>
}

interface GeoJsonLayer {
  id: string
  name: string
  color: string       // 图层颜色（自动分配）
  show: boolean       // 可见性状态
  dataSource: GeoJsonDataSource
  features: GeoJsonFeature[]
}
```

**内置颜色池：**

```typescript
const COLORS = [
  '#FF4D4F', '#52C41A', '#1890FF', '#FAAD14',
  '#722ED1', '#13C2C2', '#EB2F96', '#FA541C'
]
```

### 2. 地形裁切

**功能说明：**
- 在地图上通过鼠标绘制多边形区域
- 左键点击添加顶点，双击左键撤销上一个顶点，右键点击完成绘制
- 支持反选模式（Inverse），裁切区域内外互换
- 一键清除裁切

**交互说明：**

| 操作 | 功能 |
|------|------|
| 左键点击 | 添加顶点 |
| 双击左键 | 撤销上一个顶点 |
| 右键点击 | 完成绘制并应用裁切 |

### 3. 导航控制

- **飞行至中国视野**：定位到中国全境（经度 73.5°~135.0°，纬度 18.0°~53.5°）
- **缩放**：放大/缩小视图
- **罗盘**：可拖拽旋转视角，双击重置北向

## 状态管理（Pinia Stores）

### appStore

管理全局应用状态。

```typescript
const state = reactive({
  theme: 'light',       // 主题（light/dark）
  loading: false,      // 全局加载状态
  loadingText: '加载中...'
})

function setLoading(val: boolean, text = '加载中...')
```

### cesiumStore

管理 Cesium Viewer 实例。

```typescript
const viewer = ref<Viewer | null>(null)
const hasViewer = computed(() => !!viewer.value && !viewer.value.isDestroyed())

function setViewer(v: Viewer)
function clearViewer()
```

### geojsonStore

管理 GeoJSON 图层与要素。

```typescript
const layers = ref<GeoJsonLayer[]>([])

function addLayer(name, dataSource, color, features)
function removeLayer(id: string)
function flyToLayer(id: string)
function toggleLayerVisibility(id: string)
function flyToFeature(entity: any)
async function loadGeoJson(file: File)
```

### terrainClipStore

管理地形裁切绘制与状态。

```typescript
const enabled = ref(false)        // 裁切是否启用
const inverse = ref(false)        // 是否反选
const positions = ref<Cartesian3[]>([])  // 绘制的顶点
const isDrawing = ref(false)       // 是否正在绘制

function startDraw()               // 开始绘制
function undoLastVertex()         // 撤销上一个顶点
function finishDraw()              // 完成绘制
function clearClip()               // 清除裁切
function destroy()                  // 销毁裁切
```

## 路由配置

```
/ (Layout)
└── /cesium (Home)
```

根路径 `/` 重定向至 `/cesium`，使用 Vue Router 的 `createWebHistory` 模式。

## 环境变量

`.env` 文件中包含 Cesium Ion 认证 Token：

```env
VITE_CESIUM_ION_TOKEN=your_token_here
```

> 首次使用需替换为有效的 Cesium Ion Token，可在 [cesium.com/ion](https://cesium.com/ion) 注册获取。

## 工具函数

### geojson/index.ts

```typescript
// 递归查找 GeoJSON 中第一个坐标点
function getFirstCoordinate(geojson: any): number[] | null

// 判断 GeoJSON 是否包含三维坐标
function hasZCoordinate(geojson: any): boolean
```

### cesium/index.ts

```typescript
// 创建 Cesium Viewer 实例
function createViewer(container: HTMLElement): Viewer

// 地形加载完成后的处理：关闭加载状态、飞行至中国视野、拦截 Home 按钮
function terrainEventHandler(viewer: Viewer, terrain: Terrain)
```

## 组件说明

| 组件 | 路径 | 说明 |
|------|------|------|
| `Cesium` | `components/Cesium/index.vue` | 地图容器主组件 |
| `GeoJsonDrawer` | `components/Cesium/GeoJsonDrawer.vue` | GeoJSON 管理抽屉组件 |
| `TerrainClipDrawer` | `components/Cesium/TerrainClipDrawer.vue` | 地形裁切抽屉组件 |
| `CesiumNavigation` | `components/Cesium/CesiumNavigation.vue` | 导航工具栏（缩放/定位/罗盘） |
| `Compass` | `components/Cesium/Compass.vue` | 可拖拽罗盘控件 |
| `Layout` | `layouts/index.vue` | 根布局（包含加载状态） |
| `Home` | `views/Home.vue` | 首页视图（渲染 Cesium 组件） |

## 安装与运行

```bash
# 安装依赖
pnpm install

# 开发模式启动
pnpm dev

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview
```

## 构建配置

`vite.config.ts` 主要配置：

```typescript
export default defineConfig({
  plugins: [vue(), cesium()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
```

- `@` 指向 `src/` 目录
- `cesium()` 插件处理 Cesium 资源构建

## 类型参考

### Viewer Constructor Options

```typescript
{
  terrain: Terrain.fromWorldTerrain(),  // 使用 Cesium World Terrain
  animation: false,                     // 隐藏动画控件
  timeline: false,                       // 隐藏时间轴控件
  navigationHelpButton: false           // 隐藏导航帮助按钮
}
```
