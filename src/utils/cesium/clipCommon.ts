import { Cartesian3, Cartesian2 } from 'cesium'
import type { Viewer } from 'cesium'

/* ==============================
 * 共享类型定义
 * ============================== */

/**
 * 裁切区域 —— 对应一个 ClippingPolygon
 * positions 数组会被外层 store 的 `positions` ref 直接引用（共享引用），
 * 因此对 positions 的增删改会同步反映到 region 本身。
 */
export interface ClipRegion {
  id: string
  name: string
  /** 顶点坐标数组，按顺序构成一个闭合多边形 */
  positions: Cartesian3[]
}

/**
 * localStorage 持久化数据格式
 * Cartesian3 序列化为 [x, y, z] 数字数组
 */
export interface PersistedData {
  regions: { id: string; name: string; positions: number[][] }[]
  inverse: boolean
}

/* ==============================
 * 通用工具函数
 * ============================== */

/** 生成短唯一 ID（基于时间戳 + 随机数） */
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * 检查 Cesium Viewer 是否有效
 * 类型守卫 (`v is Viewer`) 让 TS 在通过检查后自动收窄类型，消除 null 判断
 */
export function isValidViewer(v: any): v is Viewer {
  return v && !v.isDestroyed()
}

/**
 * 从屏幕坐标拾取地球表面坐标
 * 优先使用 terrain pick（获取地形表面精确点），
 * 失败时回退到 ellipsoid pick（获取椭球面交点）。
 */
export function pickGlobe(v: Viewer, pos: Cartesian2): Cartesian3 | null {
  const ray = v.camera.getPickRay(pos)
  const cartesian = ray ? v.scene.globe.pick(ray, v.scene) : undefined
  return cartesian ?? v.camera.pickEllipsoid(pos, v.scene.globe.ellipsoid) ?? null
}
