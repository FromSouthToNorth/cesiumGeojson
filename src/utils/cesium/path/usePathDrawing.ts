/* ==============================
 * Path Drawing Composable
 * 基于 useBaseDrawing 的路径绘制包装器，保留距离测量与实时预览
 *
 * 交互：
 *   左键单击添加顶点，鼠标移动预览下一段
 *   右键 / Enter 完成，Backspace 撤销末点，Escape 取消
 * ============================== */

import type { ComputedRef, Ref } from 'vue';
import { Cartesian3 } from 'cesium';
import type { Viewer } from 'cesium';
import { useBaseDrawing } from '../shared/useBaseDrawing';
import type { SnappingAPI } from '../shared/useBaseDrawing';
import { calcPathDistances } from './usePathMeasure';
import type { PathMeasureResult } from './usePathMeasure';

export function usePathDrawing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  /** 绘制预览线颜色 getter，每次绘制时调用 */
  color?: () => string;
  /** 绘制完成回调（顶点 >= 2） */
  onFinish?: (result: PathMeasureResult) => void;
  /** 绘制取消回调 */
  onCancel?: () => void;
  /** 距离更新回调（用于面板实时显示） */
  onLiveUpdate?: (segments: number[], total: number) => void;
  /** 吸附功能 */
  snapping?: SnappingAPI;
}) {
  const { viewer, positions, color: colorGetter, onFinish, onCancel, onLiveUpdate, snapping } = options;

  /** 触发实时距离更新 */
  function handleLiveUpdate(pos: Cartesian3[], previewPos: Cartesian3 | null) {
    if (!onLiveUpdate) return;
    const n = pos.length;
    if (n < 2) {
      onLiveUpdate([], 0);
      return;
    }

    const result = calcPathDistances(pos);
    if (!previewPos || n < 1) {
      onLiveUpdate(result.segments, result.total);
      return;
    }

    // 包含预览段的距离
    const previewDist = Cartesian3.distance(pos[n - 1], previewPos);
    onLiveUpdate([...result.segments, previewDist], result.total + previewDist);
  }

  const base = useBaseDrawing({
    viewer,
    positions,
    minVertices: 2,
    color: colorGetter ?? (() => '#1890FF'),
    snapping,
    enablePreviewLine: true,
    closePolyline: false,
    onFinish: () => onFinish?.(calcPathDistances(positions.value)),
    onCancel,
    onLiveUpdate: handleLiveUpdate,
  });

  return base;
}
