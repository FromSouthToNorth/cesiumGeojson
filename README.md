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
│   │   ├── terrainClipStore.ts        # 地形裁剪绘制
│   │   └── themeStore.ts              # 主题切换（亮/暗）
│   ├── utils/
│   │   ├── cesium/index.ts            # Viewer 创建与初始化
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
- **地形裁剪** — 鼠标绘制多边形进行地形裁剪，支持反选模式
- **观测点** — 输入经纬度创建标记点，支持自动环绕旋转

所有工具面板使用统一的 SidePanel 组件（玻璃态模糊背景 + 滑入动画）。

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
