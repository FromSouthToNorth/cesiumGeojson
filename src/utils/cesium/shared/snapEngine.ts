/* ==============================
 * Snap Engine — 纯算法吸附引擎
 *
 * 职责：
 *   - 空间索引（3D Hash Grid）加速近邻查询
 *   - 屏幕投影缓存（相机未移动时复用）
 *   - 早期退出优化
 *   - DPI 自适应阈值
 *
 * 无 Vue/Cesium 响应式依赖（除 Cartesian3/Cartesian2/Viewer 类型外）
 * ============================== */

import { Cartesian2, Cartesian3 } from 'cesium';
import type { Viewer } from 'cesium';

/* ==============================
 *  类型定义
 * ============================== */

export interface SnapSource {
  position: Cartesian3;
  sourceType: 'path' | 'polygon' | 'point';
  layerId?: string;
  isMidpoint?: boolean;
}

export interface SnapTarget {
  position: Cartesian3;
  sourceVertex: Cartesian3;
  sourceType: 'path' | 'polygon' | 'point';
  isMidpoint: boolean;
  distance: number;
}

export interface SnapEngineOptions {
  /** 屏幕距离精筛阈值（默认 12px） */
  pixelThreshold?: number;
  /** 世界距离粗筛阈值（默认 300m） */
  worldThreshold?: number;
}

/* ==============================
 *  工具函数
 * ============================== */

/** 判断两个 Cartesian3 是否近似相等 */
function cartesianApproxEquals(a: Cartesian3, b: Cartesian3, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon;
}

/** 生成 Cartesian3 的缓存 key（0.01m 精度） */
function cartesianCacheKey(c: Cartesian3): string {
  return `${Math.round(c.x * 100)},${Math.round(c.y * 100)},${Math.round(c.z * 100)}`;
}

/** 生成 Hash Grid cell key */
function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/* ==============================
 *  Hash Grid 空间索引
 * ============================== */

class HashGrid {
  private cellSize: number;
  private cells = new Map<string, SnapSource[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear() {
    this.cells.clear();
  }

  insert(target: SnapSource) {
    const { x, y, z } = target.position;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const key = cellKey(cx, cy, cz);
    const list = this.cells.get(key);
    if (list) {
      list.push(target);
    } else {
      this.cells.set(key, [target]);
    }
  }

  /** 获取 worldPos 周围 3×3×3 邻域内的所有目标 */
  queryNearby(worldPos: Cartesian3, out: SnapSource[]): SnapSource[] {
    out.length = 0;
    const { x, y, z } = worldPos;
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = cellKey(cx + dx, cy + dy, cz + dz);
          const list = this.cells.get(key);
          if (list) {
            for (let i = 0; i < list.length; i++) {
              out.push(list[i]);
            }
          }
        }
      }
    }
    return out;
  }
}

/* ==============================
 *  SnapEngine
 * ============================== */

export class SnapEngine {
  private pixelThreshold: number;
  private worldThreshold: number;
  private basePixelThreshold: number;

  // 目标管理
  private allTargets: SnapSource[] = [];
  private layerMap = new Map<string, SnapSource[]>();
  private grid: HashGrid;

  // 屏幕投影缓存
  private screenCache = new Map<string, Cartesian2 | null>();
  private lastCameraPos = new Cartesian3();
  private cameraCacheValid = false;

  // 复用缓冲区（避免每次查找时分配数组）
  private _queryBuffer: SnapSource[] = [];
  private _scratchToVertex = new Cartesian3();
  private _scratchScreen = new Cartesian2();

  constructor(options: SnapEngineOptions = {}) {
    this.basePixelThreshold = options.pixelThreshold ?? 12;
    this.pixelThreshold = this.basePixelThreshold * (window.devicePixelRatio || 1);
    this.worldThreshold = options.worldThreshold ?? 300;
    this.grid = new HashGrid(this.worldThreshold);
  }

  /* ==============================
   *  目标管理
   * ============================== */

  /** 全量设置目标（重建空间索引） */
  setTargets(targets: SnapSource[]): void {
    this.allTargets = targets.slice();
    this.layerMap.clear();
    this.rebuildGrid();
    this.invalidateScreenCache();
  }

  /** 增量更新：替换指定图层的所有目标 */
  updateLayer(layerId: string, targets: SnapSource[]): void {
    this.layerMap.set(layerId, targets);
    this.rebuildAllFromLayers();
  }

  /** 移除指定图层 */
  removeLayer(layerId: string): void {
    this.layerMap.delete(layerId);
    this.rebuildAllFromLayers();
  }

  private rebuildAllFromLayers() {
    const merged: SnapSource[] = [];
    this.layerMap.forEach((list) => {
      for (let i = 0; i < list.length; i++) {
        merged.push(list[i]);
      }
    });
    this.allTargets = merged;
    this.rebuildGrid();
    this.invalidateScreenCache();
  }

  private rebuildGrid() {
    this.grid.clear();
    const targets = this.allTargets;
    for (let i = 0; i < targets.length; i++) {
      this.grid.insert(targets[i]);
    }
  }

  /* ==============================
   *  屏幕投影缓存
   * ============================== */

  /** 清空屏幕投影缓存 */
  invalidateScreenCache(): void {
    this.screenCache.clear();
    this.cameraCacheValid = false;
  }

  private checkCameraMoved(viewer: Viewer): boolean {
    const cameraPos = viewer.camera.positionWC;
    if (!this.cameraCacheValid) {
      Cartesian3.clone(cameraPos, this.lastCameraPos);
      this.cameraCacheValid = true;
      return true;
    }
    const dist = Cartesian3.distance(cameraPos, this.lastCameraPos);
    if (dist > 1.0) {
      Cartesian3.clone(cameraPos, this.lastCameraPos);
      return true;
    }
    return false;
  }

  private getScreenCoord(viewer: Viewer, pos: Cartesian3): Cartesian2 | null {
    const key = cartesianCacheKey(pos);
    const cached = this.screenCache.get(key);
    if (cached !== undefined) return cached;

    const coord = viewer.scene.cartesianToCanvasCoordinates(pos, this._scratchScreen);
    const result = coord ? Cartesian2.clone(coord, new Cartesian2()) : null;
    this.screenCache.set(key, result);
    return result;
  }

  /* ==============================
   *  核心查找
   * ============================== */

  /**
   * 查找屏幕坐标附近是否存在可吸附的顶点或边中点
   *
   * 优化策略：
   *   1. Hash Grid 空间索引：只检查 worldPos 周围 27 个 cell
   *   2. 早期退出：找到 distSq < thresholdSq / 4 时立即返回
   *   3. 屏幕投影缓存：相机未移动时复用
   *   4. 背面剔除 + 排除自身顶点
   */
  findSnapTarget(
    viewer: Viewer,
    screenPos: Cartesian2,
    worldPos: Cartesian3,
    excludePositions?: Cartesian3[],
    disableSnap?: boolean,
  ): SnapTarget | null {
    if (disableSnap) return null;

    const targetCount = this.allTargets.length;
    if (targetCount === 0) return null;

    // 检查相机是否移动，若移动则清空屏幕缓存
    if (this.checkCameraMoved(viewer)) {
      this.screenCache.clear();
    }

    // 构建排除集合（保留首顶点索引 0，用于闭合吸附）
    const excludeList = excludePositions && excludePositions.length > 0 ? excludePositions.slice(1) : [];

    const thresholdSq = this.pixelThreshold * this.pixelThreshold;
    const earlyExitThresholdSq = thresholdSq * 0.25; // threshold/2 的平方
    const camera = viewer.camera;
    const cameraPos = camera.positionWC;
    const cameraDir = camera.directionWC;

    let bestTarget: SnapTarget | null = null;
    let bestDistSq = thresholdSq;

    // 通过 Hash Grid 获取近邻目标
    const candidates = this.grid.queryNearby(worldPos, this._queryBuffer);

    for (let i = 0; i < candidates.length; i++) {
      const src = candidates[i];

      // 排除自身顶点
      let isExcluded = false;
      for (let j = 0; j < excludeList.length; j++) {
        if (cartesianApproxEquals(src.position, excludeList[j])) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) continue;

      // 粗筛：世界距离（网格已做初步过滤，但 cell 边界处可能包含远端目标）
      const worldDist = Cartesian3.distance(worldPos, src.position);
      if (worldDist > this.worldThreshold) continue;

      // 背面剔除
      Cartesian3.subtract(src.position, cameraPos, this._scratchToVertex);
      if (Cartesian3.dot(this._scratchToVertex, cameraDir) < 0) continue;

      // 精筛：屏幕坐标距离（使用缓存）
      const screenCoord = this.getScreenCoord(viewer, src.position);
      if (!screenCoord) continue;

      const dx = screenCoord.x - screenPos.x;
      const dy = screenCoord.y - screenPos.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestTarget = {
          position: src.position,
          sourceVertex: src.position,
          sourceType: src.sourceType,
          isMidpoint: src.isMidpoint ?? false,
          distance: Math.sqrt(distSq),
        };

        // 早期退出：已找到非常近的目标，无需继续遍历
        if (distSq < earlyExitThresholdSq) break;
      }
    }

    return bestTarget;
  }

  /* ==============================
   *  状态查询
   * ============================== */

  getTargetCount(): number {
    return this.allTargets.length;
  }

  /** 获取当前所有目标（只读引用，用于可视化） */
  getTargets(): readonly SnapSource[] {
    return this.allTargets;
  }
}
