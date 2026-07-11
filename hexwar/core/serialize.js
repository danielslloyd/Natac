// hexwar/core/serialize.js
// Plain-JSON round trip for a TileMap, used by the level editor (export /
// import / "play this map") and by rulesets' buildMap to accept a
// hand-edited map in place of procedural generation.

import { TileMap } from './map.js';

export function serializeMap(map) {
  return {
    kind: map.kind,
    meta: map.meta,
    tiles: map.tiles.map(t => ({
      id: t.id, center: t.center, polygon: t.polygon, neighbors: t.neighbors,
      props: t.props, axial: t.axial
    })),
    edgeProps: [...map.edgeProps.entries()]
  };
}

export function deserializeMap(json) {
  const tiles = json.tiles.map(t => ({ ...t, props: { ...t.props } }));
  const map = new TileMap(tiles, json.kind, json.meta || {});
  for (const [key, val] of json.edgeProps || []) map.edgeProps.set(key, val);
  return map;
}
