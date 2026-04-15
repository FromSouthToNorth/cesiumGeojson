export function getFirstCoordinate(geojson: any): number[] | null {
  if (Array.isArray(geojson)) {
    if (geojson.length > 0 && typeof geojson[0] === 'number') {
      return geojson
    }
    for (const item of geojson) {
      const coord = getFirstCoordinate(item)
      if (coord) return coord
    }
  } else if (geojson && typeof geojson === 'object') {
    if (geojson.coordinates) {
      return getFirstCoordinate(geojson.coordinates)
    }
    for (const key of ['geometry', 'features', 'geometries']) {
      if (geojson[key]) {
        const coord = getFirstCoordinate(geojson[key])
        if (coord) return coord
      }
    }
  }
  return null
}

export function hasZCoordinate(geojson: any): boolean {
  const coord = getFirstCoordinate(geojson)
  return !!coord && coord.length >= 3
}
