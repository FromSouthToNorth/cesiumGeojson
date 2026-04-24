# CesiumGeojson

基于 Vue 3 + TypeScript + Vite + Cesium 的三维地球可视化工具，支持 GeoJSON 数据加载、地形裁剪、标记点管理。

## 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | Vue 3 + TypeScript |
| 构建工具 | Vite |
| 状态管理 | Pinia |
| UI 组件库 | Ant Design Vue 4 |
| 三维地图 | Cesium 1.140 |
| Cesium 构建插件 | vite-plugin-cesium-build |

## 项目结构

```
cesiumGeojson/
├── src/
│   ├── components/
│   │   └── Cesium/
│   │       ├── index.vue              # Cesium 地图容器
│   │       ├── Toolbox.vue            # 工具箱（GeoJSON/裁剪/标记点入口）
│   │       ├── SidePanel.vue          # 统一侧边面板（玻璃态效果）
│   │       ├── GeoJsonDrawer.vue      # GeoJSON 管理面板
│   │       ├── TerrainClipDrawer.vue  # 地形裁剪面板
│   │       ├── PointCreator.vue       # 观测点创建面板
│   │       ├── CesiumNavigation.vue   # 导航控制（缩放/定位/主题切换）
│   │       └── Compass.vue            # 可拖拽罗盘
│   ├── layouts/
│   │   └── index.vue
│   ├── stores/
│   │   ├── appStore.ts
│   │   ├── cesiumStore.ts             # Viewer 实例管理
│   │   ├── geojsonStore.ts            # GeoJSON 图层管理
│   │   ├── terrainClipStore.ts        # 地形裁剪（协调器模式，组合 4 个 composable）
│   │   └── themeStore.ts              # 主题切换（亮/暗）
│   ├── utils/
│   │   ├── cesium/
│   │   │   ├── index.ts               # Viewer 创建与初始化
│   │   │   ├── clipCommon.ts          # 地形裁剪：共享类型与工具函数
│   │   │   ├── useClipHistory.ts      # 地形裁剪：撤销/重做历史栈
│   │   │   ├── useClipPersistence.ts  # 地形裁剪：localStorage 持久化
│   │   │   ├── useClipDrawing.ts      # 地形裁剪：绘制模式交互
│   │   │   └── useClipEditing.ts      # 地形裁剪：顶点编辑交互
│   │   └── geojson/index.ts           # 坐标解析工具
│   ├── views/
│   │   └── Home.vue
│   ├── App.vue
│   ├── main.ts
│   └── style.css                      # 全局主题变量（亮/暗）
├── public/
├── .env / .env.example
└── index.html
```

## 功能

### 工具箱（Toolbox）

左侧悬浮工具栏，包含三个入口，每个按钮均有 Tooltip 提示：

- **GeoJSON 管理** — 上传 `.geojson` / `.json` 文件，自动解析并着色渲染，支持图层列表搜索、显隐、删除、要素属性查看
- **地形裁剪** — 支持多裁切区域管理、顶点编辑、撤销/重做、反选模式、持久化
- **观测点** — 输入经纬度创建标记点，支持自动环绕旋转

所有工具面板使用统一的 SidePanel 组件（玻璃态模糊背景 + 滑入动画）。

### 地形裁剪详情

- **多区域裁切** — 支持同时绘制多个独立裁切区域，每个区域独立管理
- **区域定位** — 区域列表中点击「定位」按钮，相机自动飞行至该区域范围
- **顶点编辑** — 编辑模式下可拖拽顶点调整形状、点击线段中点添加顶点、右键删除顶点
- **撤销/重做** — Ctrl+Z / Ctrl+Shift+Z 或面板按钮，最多保留 30 步历史
- **反选模式** — 切换 Inverse 开关实时反转裁切区域内外
- **键盘快捷键** — Delete 删除选中顶点、Esc 退出编辑、Ctrl+Z 撤销
- **持久化** — 裁切数据自动保存至 localStorage，页面刷新后自动恢复
- **相机锁定** — 编辑期间自动锁定相机，避免拖拽冲突

地形裁剪采用 **协调器架构**：`terrainClipStore` 作为轻量协调层，将绘制、编辑、历史栈、持久化拆分为 4 个独立 composable（`src/utils/cesium/useClip*.ts`），职责单一，可单独测试。

核心数据流：`positions` ref 与 `regions[i].positions` 共享数组引用，绘制/编辑时对 `positions` 的增删改自动反映到对应区域上，通过 `syncGlobeClipping()` 同步到 Cesium globe。

### 导航控制

- 主题切换（亮/暗），自动持久化到 localStorage
- 飞行至中国视野
- 缩放控制
- 可拖拽罗盘（双击重置北向）

### 主题系统

CSS 自定义属性 + Ant Design ConfigProvider 双重主题切换：

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

## 路由

```
/ → /cesium  (Home.vue)
```

## 代码注释约定

- 每个文件顶部标注作用域说明（`/* ===== 标题 ===== */`）
- Vue 组件的 `<template>` 顶部用 HTML 注释说明组件用途
- 非直观逻辑处添加单行注释，说明**为什么**这样做
- 项目领域代码（stores / components / 地形裁切工具）使用中文注释
- 工具函数和基础设施代码使用英文注释
