/* ==============================
 * useListSearch —— 列表搜索过滤 Composable
 * 统一处理防抖 + 名称关键字过滤
 * ============================== */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';

export interface UseListSearchOptions {
  /** 防抖延迟（默认 300ms） */
  debounceMs?: number;
}

/**
 * 列表搜索过滤
 * @param items - 列表数据（Ref 或 ComputedRef）
 * @param options - 配置项
 * @returns searchQuery 输入值、filteredItems 过滤后结果
 */
export function useListSearch<T extends { name: string }>(
  items: Ref<T[]> | ComputedRef<T[]>,
  options: UseListSearchOptions = {},
) {
  const { debounceMs = 300 } = options;

  const searchQuery = ref('');
  const debouncedQuery = ref('');

  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(searchQuery, (val) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      debouncedQuery.value = val.trim().toLowerCase();
    }, debounceMs);
  });

  const filteredItems = computed(() => {
    const query = debouncedQuery.value;
    if (!query) return items.value;
    return items.value.filter((item) => item.name.toLowerCase().includes(query));
  });

  return {
    searchQuery,
    filteredItems,
  };
}
