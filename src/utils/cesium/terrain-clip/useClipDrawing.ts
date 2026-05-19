import { Cartesian3 } from 'cesium';
import type { Viewer } from 'cesium';
import type { ComputedRef, Ref } from 'vue';
import { useBaseDrawing } from '../shared/useBaseDrawing';
import type { UseBaseDrawingReturn } from '../shared/useBaseDrawing';

/**
 * 裁切区域绘制 composable（薄包装器）
 *
 * 委托给 useBaseDrawing，仅配置专属于裁切绘制的选项：
 * - 最少 3 个顶点
 * - 黄色、闭合折线、无预览线、无填充
 * - 自定义双击：距末点 < 5m 闭合完成，否则撤销顶点
 */
export function useClipDrawing(options: {
  viewer: ComputedRef<Viewer | null>;
  positions: Ref<Cartesian3[]>;
  onFinish?: () => void;
  onCancel?: () => void;
}): UseBaseDrawingReturn {
  const { viewer, positions, onFinish, onCancel } = options;

  return useBaseDrawing({
    viewer,
    positions,
    minVertices: 3,
    color: 'yellow',
    closePolyline: true,
    enablePreviewLine: false,
    enableClosurePreview: false,
    enableFill: false,
    onFinish,
    onCancel,
    onDoubleClick: (pos: Cartesian3, last: Cartesian3) => {
      return Cartesian3.distance(pos, last) < 5 ? 'finish' : 'undo';
    },
  });
}
