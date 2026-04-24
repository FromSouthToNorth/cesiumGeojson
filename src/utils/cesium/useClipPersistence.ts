import { Cartesian3 } from 'cesium'
import type { Ref } from 'vue'
import type { ClipRegion, PersistedData } from './clipCommon'

/**
 * 持久化 —— localStorage 读写
 *
 * 职责：将裁切区域（regions）和反选状态（inverse）序列化到 localStorage，
 *       在页面刷新后恢复上一次的裁切配置。
 *
 * 序列化方式：
 *   Cartesian3 无法直接 JSON.stringify，转存为 [x, y, z] 数字数组。
 *   反序列化时再重建 Cartesian3 对象。
 *
 * 重要设计原则：
 *   save() 从外部 ref 读取，load() 返回数据而非直接写入 ref，
 *   由调用方（store）控制赋值顺序，避免 Vue reactivity 时序竞态。
 */

const STORAGE_KEY = 'cesium-terrain-clip'

export function useClipPersistence(regions: Ref<ClipRegion[]>, inverse: Ref<boolean>) {
  /**
   * 保存当前状态到 localStorage
   * 注意：无法确保 quota 足够，try/catch 静默处理 QuotaExceededError
   */
  function save() {
    const data: PersistedData = {
      regions: regions.value.map((r) => ({
        id: r.id,
        name: r.name,
        positions: r.positions.map((p) => [p.x, p.y, p.z]),
      })),
      inverse: inverse.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* 存储空间不足时静默忽略 */
    }
  }

  /**
   * 从 localStorage 加载已保存的区域数据与 inverse 状态
   * 返回 { regions, inverse } 或 null，由调用方（store）负责赋值，
   * 避免在此处直接写入 inverse ref 导致 watcher 时序问题。
   */
  function load(): { regions: ClipRegion[]; inverse: boolean } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const data: PersistedData = JSON.parse(raw)
      if (!data.regions?.length) return null

      return {
        inverse: data.inverse ?? false,
        regions: data.regions.map((r) => ({
          id: r.id,
          name: r.name ?? '区域',
          positions: r.positions.map(([x, y, z]) => new Cartesian3(x, y, z)),
        })),
      }
    } catch {
      /* 数据损坏时静默忽略 */
      return null
    }
  }

  /** 清除本地存储中的裁切数据 */
  function clear() {
    localStorage.removeItem(STORAGE_KEY)
  }

  return { save, load, clear }
}
