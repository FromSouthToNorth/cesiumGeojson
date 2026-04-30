/* ==============================
 * Snapping Composable
 * 绘制/编辑时吸附到已有顶点及边中点
 *
 * 架构：
 *   - 纯算法层委托给 SnapEngine（空间索引 + 缓存 + 早期退出）
 *   - 本层仅保留 Vue 响应式状态 + Cesium 可视化（指示器、辅助线）
 * ============================== */

import { ref, toRaw } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  PointPrimitiveCollection,
  PolylineDashMaterialProperty,
} from 'cesium';
import type { Viewer } from 'cesium';
import { isValidViewer } from './common';
import { SnapEngine } from './snapEngine';
import type { SnapSource, SnapTarget } from './snapEngine';

// 向后兼容：从 snapEngine 重新导出类型
export type { SnapSource, SnapTarget } from './snapEngine';

export interface UseSnappingOptions {
  /** Cesium Viewer 的 computed ref */
  viewer: ComputedRef<Viewer | null>;
  /** 是否启用吸附（可选） */
  enabled?: Ref<boolean>;
  /** 屏幕距离精筛阈值（默认 12px） */
  pixelThreshold?: number;
  /** 世界距离粗筛阈值（默认 300m） */
  worldThreshold?: number;
  /** 收集所有潜在吸附目标，每次 setup() / invalidateCache() 时调用 */
  collectTargets: () => SnapSource[];
  /** 在显示目标标记时排除该 layerId（用于编辑/绘制模式下不显示当前图层自身的标记） */
  excludeLayerId?: Ref<string | null>;
}

/* ==============================
 *  useSnapping
 * ============================== */

export function useSnapping(options: UseSnappingOptions) {
  const { viewer, enabled, pixelThreshold = 12, worldThreshold = 300, collectTargets, excludeLayerId } = options;

  const isSnapping = ref(false);
  const currentTarget = ref<SnapTarget | null>(null);

  // 纯算法引擎
  const engine = new SnapEngine({ pixelThreshold, worldThreshold });

  // 指示器 entity（常驻，通过 show 切换）
  let indicatorEntity: any = null;
  // 中点指示器（边中点吸附时用不同样式）
  let midpointIndicatorEntity: any = null;
  // 吸附辅助线 entity（虚线）
  let snapLineEntity: any = null;
  // 目标顶点标记 PointPrimitiveCollection（批量渲染优化）
  let snapTargetCollection: PointPrimitiveCollection | null = null;

  /** 获取 viewer 实例 */
  function getViewer(): Viewer | null {
    const v = toRaw(viewer.value);
    return isValidViewer(v) ? v : null;
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
   * 使用 PointPrimitiveCollection 批量渲染替代逐个 Entity 创建
   * 顶点用高亮金色，中点用高亮青色，均带深色描边以增强对比度
   */
  function showSnapTargets() {
    const v = getViewer();
    if (!v) return;
    hideSnapTargets();

    const targets = engine.getTargets();
    const excluded = excludeLayerId?.value;
    // 过滤掉当前正在编辑/绘制的图层目标，避免与编辑模式自身标记重叠
    const filtered = excluded
      ? targets.filter((t) => t.layerId !== excluded)
      : targets;
    // 限制显示数量，避免过多标记拖慢渲染
    const maxMarkers = 200;
    const displayTargets = filtered.slice(0, maxMarkers);
    if (displayTargets.length === 0) return;

    // 使用 PointPrimitiveCollection 批量渲染（单次绘制调用替代 200 个独立 Entity）
    const col = v.scene.primitives.add(new PointPrimitiveCollection());
    if (!col) return;
    snapTargetCollection = col;

    for (let i = 0; i < displayTargets.length; i++) {
      const src = displayTargets[i];
      const isMid = src.isMidpoint ?? false;
      col.add({
        position: src.position,
        pixelSize: isMid ? 8 : 10,
        color: isMid ? new Color(0.0, 0.9, 1.0, 0.9) : new Color(1.0, 0.84, 0.0, 0.95),
        outlineColor: isMid ? new Color(0.0, 0.3, 0.35, 1.0) : new Color(0.6, 0.3, 0.0, 1.0),
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      });
    }
  }

  /** 隐藏所有目标顶点标记 */
  function hideSnapTargets() {
    const v = getViewer();
    if (snapTargetCollection) {
      if (v && !v.isDestroyed()) {
        v.scene.primitives.remove(snapTargetCollection);
      }
      snapTargetCollection = null;
    }
  }

  /* ==============================
   *  核心查找逻辑（委托给 SnapEngine）
   * ============================== */

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

    const bestTarget = engine.findSnapTarget(v, screenPos, worldPos, excludePositions);

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
   * 开始绘制/编辑时调用：
   *   1. 重建目标缓存
   *   2. 创建/保持指示器 entity
   */
  function setup() {
    engine.setTargets(collectTargets());

    const v = getViewer();
    if (v) {
      ensureIndicator(v);
      ensureMidpointIndicator(v);
      ensureSnapLine(v);
    }

    showSnapTargets();
  }

  /**
   * 结束绘制/编辑时调用：
   *   1. 清除指示器和辅助线
   *   2. 重置状态
   */
  function teardown() {
    hideIndicators();
    hideSnapLine();
    hideSnapTargets();
    isSnapping.value = false;
    currentTarget.value = null;
  }

  /** 强制刷新缓存（顶点添加/撤销后调用） */
  function invalidateCache() {
    engine.setTargets(collectTargets());
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
