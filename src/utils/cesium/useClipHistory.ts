import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import { Cartesian3 } from 'cesium';

/**
 * 历史栈（撤销 / 重做）
 *
 * 职责：管理裁切多边形顶点编辑的 undo/redo，
 *       通过 `positions` ref 的快照实现。
 *
 * 工作原理：
 *   - 每次 `pushHistory` 将当前 `positions` 的深拷贝存入栈中。
 *   - `undo` / `redo` 在栈中前后移动，并用快照替换 `positions` 内容
 *     （通过 `splice` 替换数组元素，保持数组引用不变）。
 *   - 栈容量限制为 HISTORY_MAX，超出时丢弃最旧的快照。
 */

const HISTORY_MAX = 30;

export function useClipHistory(positions: Ref<Cartesian3[]>) {
  /* ── 历史数据 ── */
  // history 数组存储历史快照，每个快照是 Cartesian3[] 的深拷贝
  const history = ref<Cartesian3[][]>([]);
  // historyIndex 指向当前状态在 history 中的位置
  const historyIndex = ref(-1);

  /* ── 可撤销 / 重做状态（供 UI 按钮 disabled 绑定） ── */
  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(() => historyIndex.value < history.value.length - 1);

  /**
   * 将当前 positions 的快照推入历史栈。
   * 如果当前不在栈顶（即做过撤销后又修改），会丢弃当前位置之后的红o 历史。
   */
  function pushHistory() {
    const snap = positions.value.map((p) => Cartesian3.clone(p));
    history.value = history.value.slice(0, historyIndex.value + 1);
    history.value.push(snap);
    historyIndex.value = history.value.length - 1;
    // 超出容量时丢弃最旧的快照
    if (history.value.length > HISTORY_MAX) {
      history.value.shift();
      historyIndex.value--;
    }
  }

  /**
   * 用快照替换 positions 的内容
   * 通过清空数组再逐个 push 的方式，保持 positions 的数组引用不变，
   * 这样所有对原数组的引用（如 regions[i].positions）也同步更新。
   */
  function applyHistory(snap: Cartesian3[]) {
    positions.value.length = 0;
    snap.forEach((p) => positions.value.push(Cartesian3.clone(p)));
  }

  /** 撤销一步，返回是否真正执行了撤销 */
  function undo() {
    if (historyIndex.value <= 0) return;
    historyIndex.value--;
    applyHistory(history.value[historyIndex.value]);
    return true;
  }

  /** 重做一步，返回是否真正执行了重做 */
  function redo() {
    if (historyIndex.value >= history.value.length - 1) return;
    historyIndex.value++;
    applyHistory(history.value[historyIndex.value]);
    return true;
  }

  /** 重置历史栈 */
  function reset() {
    history.value = [];
    historyIndex.value = -1;
  }

  return {
    canUndo,
    canRedo,
    pushHistory,
    undo,
    redo,
    applyHistory,
    reset,
  };
}
