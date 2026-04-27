/* ==============================
 * Snapping Composable
 * 绘制时吸附到已有顶点及边中点
 *
 * 核心优化：
 *   1. 世界距离粗筛（300m）+ 屏幕距离精筛（12px），大幅减少 cartesianToCanvasCoordinates 开销
 *   2. 边中点吸附，通过 collectTargets 预生成中点源
 *   3. 吸附辅助线（虚线），增强用户对吸附关系的感知
 *   4. Shift 键临时禁用吸附
 *   5. excludeSet 使用坐标值比较，修复引用失效问题
 *   6. 目标标记只在 setup 时创建一次，invalidateCache 不再刷新标记
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { Cartesian3, Cartesian2, Color, HeightReference, PolylineDashMaterialProperty } from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer } from './common';

/* ==============================
 *  类型定义
 * ============================== */

export interface SnapSource {
  position: Cartesian3;
  sourceType: 'path' | 'polygon';
  /** 是否为边中点（非原始顶点） */
  isMidpoint?: boolean;
}

export interface SnapTarget {
  position: Cartesian3;
  sourceVertex: Cartesian3;
  sourceType: 'path' | 'polygon';
  /** 是否吸附到边中点 */
  isMidpoint: boolean;
  /** 屏幕像素距离 */
  distance: number;
}

export interface UseSnappingOptions {
  /** Cesium Viewer 的 computed ref */
  viewer: ComputedRef<Viewer | null>;
  /** 是否启用吸附（可选） */
  enabled?: Ref<boolean>;
  /** 屏幕距离精筛阈值（默认 12px） */
  pixelThreshold?: number;
  /** 世界距离粗筛阈值（默认 300m） */
  worldThreshold?: number;
  /** 收集所有潜在吸附目标，每次 setup() 时调用 */
  collectTargets: () => SnapSource[];
}

/* ==============================
 *  工具函数
 * ============================== */

/** 判断两个 Cartesian3 是否近似相等（解决 clone 后引用不等的问题） */
function cartesianApproxEquals(a: Cartesian3, b: Cartesian3, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon && Math.abs(a.z - b.z) < epsilon;
}

/* ==============================
 *  useSnapping
 * ============================== */

export function useSnapping(options: UseSnappingOptions) {
  const { viewer, enabled, pixelThreshold = 12, worldThreshold = 300, collectTargets } = options;

  const isSnapping = ref(false);
  const currentTarget = ref<SnapTarget | null>(null);

  // 缓存的目标列表
  let cachedTargets: SnapSource[] = [];
  let cacheValid = false;

  // 指示器 entity（常驻，通过 show 切换）
  let indicatorEntity: any = null;
  // 中点指示器（边中点吸附时用不同样式）
  let midpointIndicatorEntity: any = null;
  // 吸附辅助线 entity（虚线）
  let snapLineEntity: any = null;

  // 目标顶点标记 entity 列表
  let targetMarkerEntities: any[] = [];

  // 复用 scratch 变量
  const _scratchToVertex = new Cartesian3();

  /** 获取 viewer 实例 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
  }

  /** 重建目标缓存 */
  function rebuildCache() {
    cachedTargets = collectTargets();
    cacheValid = true;
  }

  /* ==============================
   *  Entity 管理
   * ============================== */

  /** 创建吸附指示器 entity（首次 setup 时创建，常驻） */
  function ensureIndicator(v: Viewer) {
    if (indicatorEntity) return;
    indicatorEntity = v.entities.add({
      show: false,
      position: Cartesian3.ZERO,
      point: {
        pixelSize: 14,
        color: Color.fromCssColorString('#FFD700').withAlpha(0.9),
        outlineColor: Color.fromCssColorString('#FFA500'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  /** 创建边中点指示器（青色，区别于顶点） */
  function ensureMidpointIndicator(v: Viewer) {
    if (midpointIndicatorEntity) return;
    midpointIndicatorEntity = v.entities.add({
      show: false,
      position: Cartesian3.ZERO,
      point: {
        pixelSize: 12,
        color: Color.fromCssColorString('#00E5FF').withAlpha(0.9),
        outlineColor: Color.fromCssColorString('#00838F'),
        outlineWidth: 3,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: HeightReference.CLAMP_TO_GROUND,
      },
    });
  }

  /** 创建吸附辅助线（虚线） */
  function ensureSnapLine(v: Viewer) {
    if (snapLineEntity) return;
    // 用有效地表坐标初始化，避免 Cartesian3.ZERO（地球中心）触发 GroundPolylineGeometry 错误
    const dummy = Cartesian3.fromDegrees(0, 0);
    snapLineEntity = v.entities.add({
      show: false,
      polyline: {
        positions: [dummy, dummy],
        width: 2,
        material: new PolylineDashMaterialProperty({
          color: Color.YELLOW.withAlpha(0.8),
          dashLength: 12,
        }),
        clampToGround: true,
      },
    });
  }

  /** 显示顶点吸附指示器 */
  function showVertexIndicator(pos: Cartesian3) {
    if (!indicatorEntity) return;
    (indicatorEntity as any).position = pos;
    (indicatorEntity as any).show = true;
    if (midpointIndicatorEntity) (midpointIndicatorEntity as any).show = false;
  }

  /** 显示边中点吸附指示器 */
  function showMidpointIndicator(pos: Cartesian3) {
    if (!midpointIndicatorEntity) return;
    (midpointIndicatorEntity as any).position = pos;
    (midpointIndicatorEntity as any).show = true;
    if (indicatorEntity) (indicatorEntity as any).show = false;
  }

  /** 隐藏所有指示器 */
  function hideIndicators() {
    if (indicatorEntity) (indicatorEntity as any).show = false;
    if (midpointIndicatorEntity) (midpointIndicatorEntity as any).show = false;
  }

  /** 显示吸附辅助线 */
  function showSnapLine(from: Cartesian3, to: Cartesian3) {
    if (!snapLineEntity) return;
    (snapLineEntity as any).polyline.positions = [from, to];
    (snapLineEntity as any).show = true;
  }

  /** 隐藏吸附辅助线 */
  function hideSnapLine() {
    if (snapLineEntity) (snapLineEntity as any).show = false;
  }

  /**
   * 显示所有目标顶点的标记点
   * 顶点用高亮金色，中点用高亮青色，均带深色描边以增强对比度
   */
  function showSnapTargets() {
    const v = getViewer();
    if (!v) return;
    hideSnapTargets();

    // 限制显示数量，避免过多标记拖慢渲染
    const maxMarkers = 200;
    const displayTargets = cachedTargets.slice(0, maxMarkers);

    for (let i = 0; i < displayTargets.length; i++) {
      const src = displayTargets[i];
      const isMid = src.isMidpoint ?? false;
      targetMarkerEntities.push(
        v.entities.add({
          position: src.position,
          point: {
            pixelSize: isMid ? 8 : 10,
            color: isMid ? new Color(0.0, 0.9, 1.0, 0.9) : new Color(1.0, 0.84, 0.0, 0.95),
            outlineColor: isMid ? new Color(0.0, 0.3, 0.35, 1.0) : new Color(0.6, 0.3, 0.0, 1.0),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            heightReference: HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    }
  }

  /** 隐藏所有目标顶点标记 */
  function hideSnapTargets() {
    const v = getViewer();
    if (v) {
      for (let i = 0; i < targetMarkerEntities.length; i++) {
        v.entities.remove(targetMarkerEntities[i]);
      }
    }
    targetMarkerEntities = [];
  }

  /* ==============================
   *  核心查找逻辑
   * ============================== */

  /**
   * 查找屏幕坐标附近是否存在可吸附的顶点或边中点
   *
   * 优化策略：
   *   1. 先用世界距离粗筛（默认 300m），快速排除远端目标
   *   2. 对剩余目标做屏幕投影，用像素距离精筛
   *   3. 背面剔除 + 排除自身顶点
   *
   * @param screenPos - 屏幕坐标（鼠标位置）
   * @param worldPos - 地形拾取的世界坐标（用于粗筛）
   * @param excludePositions - 需要排除的顶点（当前绘制图形的顶点），
   *                           索引 0（首点）会被保留以支持闭合吸附
   * @param disableSnap - 临时禁用（如 Shift 键按下）
   * @returns 找到的吸附目标，或 null
   */
  function findSnapTarget(
    screenPos: Cartesian2,
    worldPos: Cartesian3,
    excludePositions?: Cartesian3[],
    disableSnap?: boolean,
  ): SnapTarget | null {
    // 全局禁用或临时禁用
    if (enabled?.value === false || disableSnap) {
      isSnapping.value = false;
      currentTarget.value = null;
      hideIndicators();
      hideSnapLine();
      return null;
    }

    const v = getViewer();
    if (!v) {
      isSnapping.value = false;
      currentTarget.value = null;
      hideIndicators();
      hideSnapLine();
      return null;
    }

    if (!cacheValid) {
      rebuildCache();
    }

    if (cachedTargets.length === 0) {
      isSnapping.value = false;
      currentTarget.value = null;
      hideIndicators();
      hideSnapLine();
      return null;
    }

    // 构建排除集合（保留首顶点索引 0，用于闭合吸附）
    const excludeList = excludePositions && excludePositions.length > 0 ? excludePositions.slice(1) : [];

    const thresholdSq = pixelThreshold * pixelThreshold;
    const camera = v.camera;
    const cameraPos = camera.positionWC;
    const cameraDir = camera.directionWC;

    let bestTarget: SnapTarget | null = null;
    let bestDistSq = thresholdSq;

    for (let i = 0; i < cachedTargets.length; i++) {
      const src = cachedTargets[i];

      // 排除自身顶点（坐标值比较，修复引用失效问题）
      let isExcluded = false;
      for (let j = 0; j < excludeList.length; j++) {
        if (cartesianApproxEquals(src.position, excludeList[j])) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) continue;

      // 粗筛：世界距离（避免远距离目标做昂贵的屏幕投影）
      const worldDist = Cartesian3.distance(worldPos, src.position);
      if (worldDist > worldThreshold) continue;

      // 背面剔除：顶点在相机后方则跳过
      Cartesian3.subtract(src.position, cameraPos, _scratchToVertex);
      if (Cartesian3.dot(_scratchToVertex, cameraDir) < 0) continue;

      // 精筛：屏幕坐标距离
      const screenCoord = v.scene.cartesianToCanvasCoordinates(src.position);
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
      }
    }

    if (bestTarget) {
      isSnapping.value = true;
      currentTarget.value = bestTarget;
      if (bestTarget.isMidpoint) {
        showMidpointIndicator(bestTarget.position);
      } else {
        showVertexIndicator(bestTarget.position);
      }
      showSnapLine(worldPos, bestTarget.position);
      return bestTarget;
    }

    isSnapping.value = false;
    currentTarget.value = null;
    hideIndicators();
    hideSnapLine();
    return null;
  }

  /* ==============================
   *  生命周期
   * ============================== */

  /**
   * 开始绘制时调用：
   *   1. 重建目标缓存
   *   2. 创建/保持指示器 entity
   *   3. 显示目标标记点
   */
  function setup() {
    cacheValid = false;
    rebuildCache();

    const v = getViewer();
    if (v) {
      ensureIndicator(v);
      ensureMidpointIndicator(v);
      ensureSnapLine(v);
    }

    showSnapTargets();
  }

  /**
   * 结束绘制时调用：
   *   1. 清除指示器和辅助线
   *   2. 清除目标标记点
   *   3. 重置状态和缓存
   */
  function teardown() {
    hideIndicators();
    hideSnapLine();
    hideSnapTargets();
    isSnapping.value = false;
    currentTarget.value = null;
    cachedTargets = [];
    cacheValid = false;
  }

  /** 强制刷新缓存（顶点添加/撤销后调用） */
  function invalidateCache() {
    rebuildCache();
    // 标记实体不再刷新，避免频繁 add/remove entity 的开销
    // 若需要刷新标记，可取消下行注释：
    // showSnapTargets();
  }

  /** 清理所有 entity（viewer 销毁前调用） */
  function destroy() {
    const v = getViewer();
    if (!v) return;

    hideSnapTargets();
    if (indicatorEntity) {
      v.entities.remove(indicatorEntity);
      indicatorEntity = null;
    }
    if (midpointIndicatorEntity) {
      v.entities.remove(midpointIndicatorEntity);
      midpointIndicatorEntity = null;
    }
    if (snapLineEntity) {
      v.entities.remove(snapLineEntity);
      snapLineEntity = null;
    }
  }

  return {
    findSnapTarget,
    setup,
    teardown,
    invalidateCache,
    destroy,
    isSnapping,
    currentTarget,
  };
}
