# CesiumGeojson

基于 Vue 3 + TypeScript + Vite + Cesium 的三维地球可视化工具，支持 GeoJSON 数据加载、地形裁剪、地质路径规划、多边形勘测（面积/坡度/裁切）。

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript (Composition API, `<script setup>`) |
| 构建工具 | Vite 8 |
| 状态管理 | Pinia 3 |
| UI 组件库 | Ant Design Vue 4 |
| 三维地图 | Cesium 1.140 |
| Cesium 构建插件 | vite-plugin-cesium-build |

## 项目结构

```
cesiumGeojson/
├── src/
│   ├── components/
│   │   └── Cesium/
│   │       ├── index.vue                # Cesium 地图容器
│   │       ├── Toolbox.vue              # 工具栏（GeoJSON/裁剪/路径/多边形/标记点）
│   │       ├── CesiumNavigation.vue     # 导航控制（缩放/主题/罗盘）
│   │       ├── Compass.vue              # 可拖拽罗盘
│   │       ├── panels/                  # 侧边工具面板
│   │       │   ├── SidePanel.vue        # 统一侧边面板（玻璃态）
│   │       │   ├── GeoJson.vue          # GeoJSON 上传与图层管理
│   │       │   ├── TerrainClip.vue      # 地形裁剪面板
│   │       │   ├── PointCreator.vue     # 观测点创建面板
│   │       │   ├── GeoPath.vue          # 地质路径规划与剖面分析
│   │       │   └── GeoPolygon.vue       # 多边形勘测（面积/坡度/裁切）
│   │       └── shared/                  # 可复用子组件
│   │           ├── ElevationProfile.vue # 高程剖面 SVG 图表
│   │           ├── VertexTable.vue      # 顶点坐标表格
│   │           ├── SlopeAnalysis.vue    # 坡度分析统计
│   │           ├── EditToolbar.vue      # 编辑器工具栏（完成/撤销/重做）
│   │           └── ListToolbar.vue      # 列表工具栏（计数/显隐/删除/搜索）
│   ├── layouts/index.vue
│   ├── views/Home.vue
│   ├── stores/
│   │   ├── cesiumStore.ts               # Viewer 实例
│   │   ├── appStore.ts                  # 全局加载状态
│   │   ├── themeStore.ts                # 主题切换（亮/暗，localStorage 持久化）
│   │   ├── geojsonStore.ts              # GeoJSON 图层管理
│   │   ├── terrainClipStore.ts          # 地形裁剪（协调器模式）
│   │   ├── geoPathStore.ts              # 地质路径（绘制/编辑/测量/剖面/播放）
│   │   └── geoPolygonStore.ts           # 多边形勘测（CRUD/坡度/裁切）
│   ├── types/
│   │   ├── geoPath.ts                   # 路径/剖面类型定义
│   │   └── geoPolygon.ts                # 多边形/坡度分析类型定义
│   ├── utils/
│   │   ├── cesium/
│   │   │   ├── viewer.ts                # Viewer 创建与初始化
│   │   │   ├── shared/                  # 公共工具
│   │   │   │   ├── common.ts            # 共享类型与辅助函数
│   │   │   │   ├── useKeyboardShortcuts.ts # 键盘快捷键（跨平台 Ctrl/Cmd）
│   │   │   │   └── useSnapping.ts       # 绘制顶点吸附（世界+屏幕距离过滤）
│   │   │   ├── terrain-clip/            # 地形裁剪
│   │   │   │   ├── useClipDrawing.ts    # 绘制模式
│   │   │   │   ├── useClipEditing.ts    # 顶点编辑
│   │   │   │   ├── useClipHistory.ts    # 撤销/重做
│   │   │   │   └── useClipPersistence.ts # localStorage 持久化
│   │   │   ├── path/                    # 地质路径
│   │   │   │   ├── usePathDrawing.ts    # 折线绘制
│   │   │   │   ├── usePathEditing.ts    # 顶点编辑
│   │   │   │   ├── usePathMeasure.ts    # geodesic 测距
│   │   │   │   ├── usePathPlayback.ts   # 轨迹播放动画
│   │   │   │   └── usePathProfile.ts    # 地形剖面采样
│   │   │   └── polygon/                 # 多边形勘测
│   │   │       ├── usePolygonDrawing.ts # 多边形绘制与面积/周长测量
│   │   │       ├── usePolygonEditing.ts # 顶点编辑
│   │   │       └── usePolygonSlope.ts   # 地形坡度分析（Horn 算法）
│   │   ├── geojson/index.ts             # GeoJSON 坐标解析
│   │   └── useListSearch.ts             # 列表搜索过滤（防抖）
│   ├── router/index.ts                  # 路由（/ → /cesium）
│   ├── App.vue
│   ├── main.ts
│   └── style.css                        # 主题 CSS 变量（亮/暗）
├── public/
├── .env / .env.example
└── index.html
```

## 功能

### 工具箱（Toolbox）

左侧悬浮工具栏，包含以下功能入口（每个按钮均有 Tooltip 提示）：

- **GeoJSON 管理** — 上传 `.geojson` / `.json` 文件，自动解析并着色渲染，支持图层列表搜索、批量显隐、删除全部、要素属性查看
- **地形裁剪** — 多裁切区域管理、顶点编辑、撤销/重做、反选模式、持久化
- **地质路径** — 折线绘制与 geodesic 测距、顶点吸附、顶点编辑、地形剖面分析（采样 + SVG 图表）、轨迹播放
- **多边形勘测** — 多边形绘制与面积/周长测量、顶点吸附、地形坡度分析、逐多边形裁切
- **观测点** — 输入经纬度创建标记点，支持自动环绕旋转

所有工具面板使用统一的 SidePanel 组件（玻璃态模糊背景 + 滑入动画）。

### 地形裁剪

- **多区域管理** — 同时绘制多个独立裁切区域，列表中选择/定位/删除
- **顶点编辑** — 拖拽调整、中点添加、右键删除、键盘快捷键
- **撤销/重做** — Ctrl+Z / Ctrl+Shift+Z 或面板按钮，最多 30 步历史
- **反选模式** — 切换按钮实时反转裁切内外（全局）
- **持久化** — 自动保存至 localStorage，刷新后恢复（含反选状态）
- **架构** — 协调器模式：`terrainClipStore` 组合 4 个独立 composable（绘制/编辑/历史/持久化），`positions` 与 `regions[i].positions` 共享引用

### 地质路径（GeoPath）

- **折线绘制** — 左键加点，右键完成，Backspace 撤销上一点
- **顶点吸附** — 自动吸附已有顶点或边中点（300m 粗筛 + 12px 精筛），按住 Shift 临时禁用
- **geodesic 测距** — 各分段距离 + 总距离实时显示
- **顶点编辑** — 拖拽/中点添加/右键删除，Esc 退出，Ctrl+Z/Y 撤销/重做
- **地形剖面** — 沿路径采样地形高程（10m 间距），计算 min/max/avg/爬升/下降/梯度，SVG 图表展示
- **轨迹播放** — 沿路径模拟运动动画，支持暂停/继续/拖拽进度/速度倍率（0.5x~4x）/相机跟随
- **多路径管理** — 8 色循环，列表搜索过滤，批量显隐，删除全部，GeoJSON 导入/导出

### 多边形勘测（GeoPolygon）

- **多边形绘制** — 左键加点，右键完成，Backspace 撤销上一点
- **顶点吸附** — 自动吸附已有顶点或边中点（同路径吸附逻辑），按住 Shift 临时禁用
- **面积/周长测量** — 球面多边形面积公式（authalic sphere），geodesic 边长求和
- **智能单位** — 面积自动切换 m² / ha / km²，距离自动切换 m / km
- **顶点编辑** — 拖拽/中点添加/右键删除，Esc 退出，Ctrl+Z/Y 撤销/重做
- **地图标注** — 多边形中心显示名称 + 面积，可批量显隐
- **顶点数据** — 表格展示 lng/lat/高度/海拔，支持复制和 CSV 导出
- **顶点高程** — 通过 Cesium `sampleTerrain` 采样各顶点海拔
- **多边形管理** — 列表搜索过滤，批量显隐，删除全部
- **GeoJSON 导入/导出** — 携带裁切状态，支持闭合环

#### 地形坡度分析

使用 **Horn (1981) 算法** 对多边形区域进行逐点坡度计算：

1. 在包围盒内生成规则网格（最多 300×300 ≈ 20000 采样点）
2. `sampleTerrain` 批量采样地形高程（LOD 13）
3. 3×3 窗口 Horn 公式计算坡度：
   - `slopePercent = sqrt(dx² + dy²) × 100`（百分比）
   - `slopeAngle = atan(sqrt(dx² + dy²)) × 180/π`（角度 °）
4. 分类：`< 5°` 平缓（绿）、`5-15°` 中等（黄）、`≥ 15°` 陡峭（红）
5. 统计：百分比/角度的 min/max/avg/中位数/标准差 + 分布占比
6. 地图可视化为带颜色的网格点（按分类着色）

#### 多边形地形裁切

每个勘测多边形可独立启用地形裁切：

- 启用后以多边形形状裁剪地形显示（保留内部）
- 反选模式：显示多边形 **外部** 地形
- 裁切状态随 GeoJSON 导入/导出持久化
- 注：与独立「地形裁剪」功能共用同一个 `scene.globe.clippingPolygons`，同时使用会冲突

### 导航控制

- 主题切换（亮/暗），自动持久化到 localStorage
- 飞行至中国视野
- 缩放控制
- 可拖拽罗盘（双击重置北向）

### 主题系统

CSS 自定义属性 + Ant Design ConfigProvider 双重切换：

- `:root` — 亮色主题
- `[data-theme="dark"]` — 暗色主题

## 快速开始

```bash
pnpm install
pnpm dev       # 开发模式
pnpm build     # 生产构建
pnpm preview   # 预览生产构建
```

需要将 `.env` 中的 `VITE_CESIUM_ION_TOKEN` 替换为有效的 [Cesium Ion Token](https://cesium.com/ion)。

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm preview` | 预览生产构建 |
| `pnpm lint` | ESLint 检查（src/）|
| `pnpm lint:fix` | ESLint 自动修复 |
| `pnpm format` | Prettier 格式化检查 |
| `pnpm format:fix` | Prettier 自动格式化 |
| `pnpm stylelint` | Stylelint 检查 |
| `pnpm stylelint:fix` | Stylelint 自动修复 |

## 路由

```
/ → /cesium  (Home.vue)
```

## 共享组件与 Composables

### ListToolbar — 通用列表工具栏

`components/Cesium/shared/ListToolbar.vue`

供 GeoJSON / GeoPath / GeoPolygon 三个面板复用，提供统一的列表操作入口：

- 左侧显示项目计数（slot 可自定义）
- 右侧操作区：全部显示/隐藏（icon-only）、删除全部（Popconfirm 确认）、搜索框（140px，防抖过滤）
- 窄屏自动换行，无横向滚动

### useListSearch — 列表搜索过滤

`utils/useListSearch.ts`

通用搜索过滤 Composable，支持传入 `Ref<T[]>` 或 `ComputedRef<T[]>`：

- 默认 300ms 防抖
- 按 `item.name` 关键字过滤（不区分大小写）
- 返回 `searchQuery`（原始输入）和 `filteredItems`（过滤结果）

### useKeyboardShortcuts — 声明式键盘快捷键

`utils/cesium/shared/useKeyboardShortcuts.ts`

跨平台快捷键封装（Mac 用 Cmd，Win/Linux 用 Ctrl）：

- 自动匹配 `metaKey` / `ctrlKey`
- 非 meta 快捷键在有修饰键时自动屏蔽，避免浏览器冲突
- 匹配后自动 `preventDefault()`
- 用于地形裁剪、路径、多边形的绘制/编辑模式

### useSnapping — 绘制顶点吸附

`utils/cesium/shared/useSnapping.ts`

GeoPath 与 GeoPolygon 共享的吸附逻辑：

- 世界距离粗筛（300m）+ 屏幕距离精筛（12px）
- 支持顶点和边中点吸附，带视觉指示器（金色圆点 + 虚线引导线）
- 按住 **Shift** 临时禁用吸附

## 代码约定

- 文件顶部标注作用域说明（`/* ===== 标题 ===== */`）
- Vue `<template>` 顶部用 HTML 注释说明组件用途
- 非直观逻辑处添加单行注释说明**为什么**这样做
- 项目领域代码（stores / components / 工具）使用中文注释
- 通用基础代码使用英文注释
- 文件名：`.vue` 文件 PascalCase，`.ts` 文件 camelCase
