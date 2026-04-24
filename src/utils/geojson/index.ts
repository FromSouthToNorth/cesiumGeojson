/* ==============================
 * GeoJSON 坐标工具
 * ============================== */

/**
 * 递归查找 GeoJSON 结构中第一个有效坐标
 * 用于判断数据是否包含 Z 值（高度信息），
 * 从而决定加载时是否启用 clampToGround。
 */
export function getFirstCoordinate(geojson: any): number[] | null {
  if (Array.isArray(geojson)) {
    // 顶层即为坐标数组（形如 [lng, lat]）
    if (geojson.length > 0 && typeof geojson[0] === 'number') {
      return geojson
    }
    // 递归遍历子数组
    for (const item of geojson) {
      const coord = getFirstCoordinate(item)
      if (coord) return coord
    }
  } else if (geojson && typeof geojson === 'object') {
    if (geojson.coordinates) {
      return getFirstCoordinate(geojson.coordinates)
    }
    // GeoJSON 标准结构的递归入口
    for (const key of ['geometry', 'features', 'geometries']) {
      if (geojson[key]) {
        const coord = getFirstCoordinate(geojson[key])
        if (coord) return coord
      }
    }
  }
  return null
}

/** 判断 GeoJSON 是否包含 Z 坐标 */
export function hasZCoordinate(geojson: any): boolean {
  const coord = getFirstCoordinate(geojson)
  return !!coord && coord.length >= 3
}
