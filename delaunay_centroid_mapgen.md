# Irregular Polygon Map Generation Using Delaunay Centroids

This document describes a **complete, implementation-ready specification** for generating semi-random polygonal maps using the **Delaunay Centroid Method**, inspired by Red Blob Games' article:

> "Voronoi Alternative via Delaunay Triangle Centroids"

The purpose of this algorithm is to generate organic-looking, mostly 5–7‑sided polygons suitable for a board game map (e.g., Catan-like tile maps) while maintaining good topological structure.

The method is deterministic (supports a seed) and modular, allowing tuning of irregularity, density, smoothing, and cleanup.

---

# Table of Contents

1. Overview
2. Algorithm Summary
3. Step‑by‑Step Algorithm
4. Data Structures
5. Post‑Processing & Cleanup
6. Validation Requirements
7. Tunable Parameters
8. Example Pseudocode
9. Implementation Notes & Tips

---

# 1. Overview

This generator produces a set of polygons by:

- generating random points,
- computing the **Delaunay triangulation**,
- computing centroids of triangles,
- grouping those centroids around each original point,
- forming polygons by sorting centroids angularly.

This acts like a smooth, organic alternative to Voronoi diagrams.

### Properties

- Each polygon corresponds to one input point.
- Typically yields **5–7 sided polygons**.
- Produces smooth, rounded Voronoi-like cells.
- Very stable and visually appealing.

---

# 2. Algorithm Summary

Given a set of seed points:

1. Compute Delaunay triangulation.
2. For each seed point:
   - Collect all triangles that include the point.
   - Compute centroid of each triangle.
   - Sort the centroids around the seed point by angle.
   - Connect the centroids to form a polygon.
3. Output polygons.

This produces a complete polygonal tiling.

---

# 3. Step‑by‑Step Algorithm

## Step 0 — Inputs

- **N**: number of tiles desired.
- **bounding shape**: circle, rounded hexagon, etc.
- **seed**: RNG seed (deterministic).
- **irregularity**: 0–1 displacement amount.

## Step 1 — Generate Random Points

Generate N random points inside the bounding shape. Apply optional Lloyd relaxation (1–3 iterations) for uniformity. Apply **irregularity displacement**:

- displace each point by `random_vector() * irregularity * cell_radius`.

## Step 2 — Compute Delaunay Triangulation

Using the point set, compute:

- `triangles`: each triangle defined by 3 point indices.
- `adjacency`: triangles incident to each point.

Any standard Delaunay library/module works.

## Step 3 — Compute Triangle Centroids

For each triangle with vertices `(A, B, C)` at `(x,y)` coordinates:

```
centroid = ((Ax+Bx+Cx)/3, (Ay+By+Cy)/3)
```

Store centroid positions.

## Step 4 — Build Polygons Via Angular Sort

For each point **P**:

1. Gather all triangle centroids from triangles that include P.
2. For each centroid **C**, compute angle:

```
theta = atan2(C.y - P.y, C.x - P.x)
```

3. Sort all centroids by `theta`.
4. Connect them in sorted order to form polygon vertices.

The polygon for P is the ordered centroid list.

## Step 5 — Clip to Bounding Shape (optional)

If necessary, clip polygons to bounding shape. Use polygon clipping library or Sutherland–Hodgman.

---

# 4. Data Structures

Use simple JSON‑style structures.

### Point

```
{
  id: string,
  x: number,
  y: number
}
```

### Triangle

```
{
  a: pointId,
  b: pointId,
  c: pointId,
  centroid: {x,y}
}
```

### Polygon Cell

```
{
  id: string,
  centerPoint: pointId,
  vertices: [ {x,y}, ... ], // sorted centroid list
  neighbors: [cellId,...]    // filled in post-processing
}
```

---

# 5. Post‑Processing & Cleanup

The raw polygons may need cleanup.

## 5.1 Ensure Proper Winding

Ensure vertices appear in **counter‑clockwise** (CCW) order.

## 5.2 Build Adjacency Graph

Two polygons are neighbors if they share a polygon edge.

## 5.3 Repair/Normalize

Depending on gameplay needs:

- **Merge tiny polygons**: if area < threshold.
- **Split jagged polygons**: if too many vertices.
- **Remove slivers**: triangles that produce very thin cells.

## 5.4 Enforce Vertex‑Degree=3 (for Catan‑like games)

If required by the game (e.g., each node touches exactly 3 tiles):

- Intersect all polygons.
- Construct primal graph (nodes/edges from polygon intersections).
- Detect vertices touching != 3 tiles.
- Locally merge or split polygons to correct.
- Or regenerate if constraint cannot be met.

---

# 6. Validation Requirements

A generated map is valid when:

- All polygons have ≥3 vertices.
- No self‑intersections.
- Polygons cover the domain with no major gaps.
- Polygon adjacency is consistent.
- Optional: vertex‑degree=3 invariant holds.

---

# 7. Tunable Parameters

```
params = {
  seed,
  count,          // number of polygons
  boundingShape,  // circle, hex, rect
  smoothingIters, // Lloyd relax iterations
  irregularity,   // 0..1
  mergeThreshold, // for post-processing
}
```

---

# 8. Example Pseudocode

```ts
function generateDelaunayCentroidMap(params): MapData {
  const pts = generateRandomPoints(params.count, params.boundingShape, params.seed);
  relaxPoints(pts, params.smoothingIters);
  applyIrregularity(pts, params.irregularity);

  const del = computeDelaunay(pts);
  const triCentroids = del.triangles.map(t => centroid(t));

  const cells = [];
  for (let p of pts) {
    const tris = del.trianglesIncidentTo[p.id];
    const centroids = tris.map(t => triCentroids[t.id]);
    const ordered = sortByAngle(centroids, p);
    cells.push({ id: p.id, centerPoint: p.id, vertices: ordered });
  }

  const clippedCells = clipCells(cells, params.boundingShape);
  const finalCells = cleanUp(clippedCells, params);
  const adjacency = buildAdjacency(finalCells);

  return { cells: finalCells, adjacency };
}
```

---

# 9. Implementation Notes & Tips

- The centroid‑polygon approach avoids degenerate Voronoi edges and yields smoother shapes.
- More Lloyd relaxation → more uniform polygons.
- Higher irregularity → more organic variation.
- If used for a game with strict topological rules (Catan‑like), implement a **strict validator** and retry generation if needed.
- For reproducibility, use a deterministic RNG (seeded PRNG or hash‑based RNG).
- Libraries: in JS, consider `d3-delaunay`, `robust-predicates`, `polygon-clipping`.

---

End of document.

