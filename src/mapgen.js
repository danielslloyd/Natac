// mapgen.js - Standalone Map Generation Module
// Pure logic functions for Delaunay triangulation and Voronoi-based map generation

// Configuration parameters
const MIN_ANGLE_DEG = 20;
const LLOYD_RELAXATION = true;
const MAX_AREA_PERCENT = 125;
const MIN_AREA_PERCENT = 75;

// Default canvas dimensions (can be adjusted as needed)
let width = 1200;
let height = 800;
let margin = 20;

// Bounding box
let bounds = {
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: height - 2 * margin
};

// Global state variables (reset with each generateMapData call)
let points = [];
let triangles = [];
let tileNeighbors = [];
let voronoiVertices = [];
let voronoiEdges = [];
let tiles = [];
let validTiles = new Set();
let edgeTiles = new Set();
let ineligibleTiles = new Set();
let waterOnlyTiles = new Set();
let validTriangles = new Set();

// ============================================================================
// Utility Functions
// ============================================================================

// Calculate distance between two points
function distance(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return Math.sqrt(dx * dx + dy * dy);
}

// Calculate triangle centroid (node position)
function getCentroid(p1, p2, p3) {
    return [
        (p1[0] + p2[0] + p3[0]) / 3,
        (p1[1] + p2[1] + p3[1]) / 3
    ];
}

// Calculate angle in degrees at vertex B in triangle ABC
function getAngle(a, b, c) {
    const ba = [a[0] - b[0], a[1] - b[1]];
    const bc = [c[0] - b[0], c[1] - b[1]];
    const dotProduct = ba[0] * bc[0] + ba[1] * bc[1];
    const magBA = Math.sqrt(ba[0] * ba[0] + ba[1] * ba[1]);
    const magBC = Math.sqrt(bc[0] * bc[0] + bc[1] * bc[1]);
    const cosAngle = dotProduct / (magBA * magBC);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
}

// Check if triangle has all angles above threshold
function isTriangleValid(p1, p2, p3, minAngleDeg) {
    const angle1 = getAngle(p2, p1, p3);
    const angle2 = getAngle(p1, p2, p3);
    const angle3 = getAngle(p1, p3, p2);
    return angle1 >= minAngleDeg && angle2 >= minAngleDeg && angle3 >= minAngleDeg;
}

// Check if triangle has an edge
function hasEdge(tri, a, b) {
    return (tri.includes(a) && tri.includes(b));
}

// Test if point is in circumcircle of triangle
function inCircumcircle(px, py, ax, ay, bx, by, cx, cy) {
    const ax_ = ax - px;
    const ay_ = ay - py;
    const bx_ = bx - px;
    const by_ = by - py;
    const cx_ = cx - px;
    const cy_ = cy - py;

    return (
        (ax_ * ax_ + ay_ * ay_) * (bx_ * cy_ - cx_ * by_) -
        (bx_ * bx_ + by_ * by_) * (ax_ * cy_ - cx_ * ay_) +
        (cx_ * cx_ + cy_ * cy_) * (ax_ * by_ - bx_ * ay_)
    ) > 0;
}

// Calculate centroid of a polygon (for Lloyd's algorithm)
function getPolygonCentroid(vertices) {
    if (vertices.length < 3) return null;

    let cx = 0, cy = 0;
    let area = 0;

    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const cross = vertices[i][0] * vertices[j][1] - vertices[j][0] * vertices[i][1];
        area += cross;
        cx += (vertices[i][0] + vertices[j][0]) * cross;
        cy += (vertices[i][1] + vertices[j][1]) * cross;
    }

    area *= 0.5;
    if (Math.abs(area) < 1e-10) return null;

    cx /= (6 * area);
    cy /= (6 * area);

    return [cx, cy];
}

// Calculate area of a polygon
function getPolygonArea(vertices) {
    if (vertices.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i][0] * vertices[j][1] - vertices[j][0] * vertices[i][1];
    }

    return Math.abs(area) / 2;
}

// ============================================================================
// Point Generation Functions
// ============================================================================

// Poisson-disc sampling
function poissonDiscSampling(numPoints) {
    const minDistance = Math.sqrt((bounds.width * bounds.height) / numPoints) * 0.8;
    const cellSize = minDistance / Math.sqrt(2);
    const gridWidth = Math.ceil(bounds.width / cellSize);
    const gridHeight = Math.ceil(bounds.height / cellSize);
    const grid = new Array(gridWidth * gridHeight).fill(null);
    const active = [];
    const points = [];

    function getGridIndex(x, y) {
        const col = Math.floor((x - bounds.x) / cellSize);
        const row = Math.floor((y - bounds.y) / cellSize);
        return row * gridWidth + col;
    }

    function isValid(x, y) {
        if (x < bounds.x || x >= bounds.x + bounds.width ||
            y < bounds.y || y >= bounds.y + bounds.height) {
            return false;
        }

        const col = Math.floor((x - bounds.x) / cellSize);
        const row = Math.floor((y - bounds.y) / cellSize);

        for (let r = Math.max(0, row - 2); r <= Math.min(gridHeight - 1, row + 2); r++) {
            for (let c = Math.max(0, col - 2); c <= Math.min(gridWidth - 1, col + 2); c++) {
                const idx = r * gridWidth + c;
                if (grid[idx] !== null) {
                    const other = grid[idx];
                    const dx = x - other[0];
                    const dy = y - other[1];
                    if (Math.sqrt(dx * dx + dy * dy) < minDistance) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    // Start with random point
    const startX = bounds.x + Math.random() * bounds.width;
    const startY = bounds.y + Math.random() * bounds.height;
    const start = [startX, startY];
    points.push(start);
    active.push(start);
    grid[getGridIndex(startX, startY)] = start;

    // Generate points
    while (active.length > 0 && points.length < numPoints) {
        const idx = Math.floor(Math.random() * active.length);
        const point = active[idx];
        let found = false;

        for (let i = 0; i < 30; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const radius = minDistance + Math.random() * minDistance;
            const x = point[0] + radius * Math.cos(angle);
            const y = point[1] + radius * Math.sin(angle);

            if (isValid(x, y)) {
                const newPoint = [x, y];
                points.push(newPoint);
                active.push(newPoint);
                grid[getGridIndex(x, y)] = newPoint;
                found = true;
                break;
            }
        }

        if (!found) {
            active.splice(idx, 1);
        }
    }

    return points;
}

// Hex grid generation
function generateHexGrid(numPoints) {
    const points = [];
    const area = bounds.width * bounds.height;
    const spacing = Math.sqrt(area / numPoints) * 1.1;
    const rowHeight = spacing * Math.sqrt(3) / 2;

    let row = 0;
    for (let y = bounds.y; y < bounds.y + bounds.height && points.length < numPoints; y += rowHeight) {
        const offset = (row % 2) * spacing / 2;
        for (let x = bounds.x + offset; x < bounds.x + bounds.width && points.length < numPoints; x += spacing) {
            if (x >= bounds.x && x <= bounds.x + bounds.width &&
                y >= bounds.y && y <= bounds.y + bounds.height) {
                points.push([x, y]);
            }
        }
        row++;
    }

    return points.slice(0, numPoints);
}

// ============================================================================
// Delaunay Triangulation
// ============================================================================

// Delaunay triangulation (Bowyer-Watson algorithm)
function delaunay(points) {
    if (points.length < 3) return [];

    // Create super-triangle that contains all points
    const minX = Math.min(...points.map(p => p[0])) - 1000;
    const minY = Math.min(...points.map(p => p[1])) - 1000;
    const maxX = Math.max(...points.map(p => p[0])) + 1000;
    const maxY = Math.max(...points.map(p => p[1])) + 1000;

    const superTriangle = [
        [minX, minY],
        [maxX, minY],
        [(minX + maxX) / 2, maxY]
    ];

    let triangles = [[0, 1, 2]];
    const vertices = [...superTriangle, ...points];

    // Add points one at a time
    for (let i = 0; i < points.length; i++) {
        const pointIdx = i + 3; // Offset by super-triangle vertices
        const point = vertices[pointIdx];
        const badTriangles = [];

        // Find triangles whose circumcircle contains the point
        for (let j = 0; j < triangles.length; j++) {
            const tri = triangles[j];
            const [ax, ay] = vertices[tri[0]];
            const [bx, by] = vertices[tri[1]];
            const [cx, cy] = vertices[tri[2]];

            if (inCircumcircle(point[0], point[1], ax, ay, bx, by, cx, cy)) {
                badTriangles.push(j);
            }
        }

        // Find boundary edges
        const polygon = [];
        for (const triIdx of badTriangles) {
            const tri = triangles[triIdx];
            const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];

            for (const edge of edges) {
                let shared = false;
                for (const otherTriIdx of badTriangles) {
                    if (otherTriIdx === triIdx) continue;
                    const otherTri = triangles[otherTriIdx];
                    if (hasEdge(otherTri, edge[0], edge[1])) {
                        shared = true;
                        break;
                    }
                }
                if (!shared) {
                    polygon.push(edge);
                }
            }
        }

        // Remove bad triangles
        for (let j = badTriangles.length - 1; j >= 0; j--) {
            triangles.splice(badTriangles[j], 1);
        }

        // Add new triangles
        for (const edge of polygon) {
            triangles.push([edge[0], edge[1], pointIdx]);
        }
    }

    // Remove triangles that share vertices with super-triangle
    triangles = triangles.filter(tri =>
        tri[0] >= 3 && tri[1] >= 3 && tri[2] >= 3
    );

    // Adjust indices (remove super-triangle offset)
    triangles = triangles.map(tri =>
        tri.map(idx => idx - 3)
    );

    return { triangles, vertices: points };
}

// ============================================================================
// Voronoi and Tile Building
// ============================================================================

// Find neighboring triangles (share an edge) - for nodes
function findNeighbors(triangles) {
    const neighbors = triangles.map(() => []);

    for (let i = 0; i < triangles.length; i++) {
        const tri1 = triangles[i];
        const edges1 = [
            [tri1[0], tri1[1]],
            [tri1[1], tri1[2]],
            [tri1[2], tri1[0]]
        ];

        for (let j = i + 1; j < triangles.length; j++) {
            const tri2 = triangles[j];

            // Check if triangles share an edge
            for (const edge of edges1) {
                if (hasEdge(tri2, edge[0], edge[1])) {
                    neighbors[i].push(j);
                    neighbors[j].push(i);
                    break;
                }
            }
        }
    }

    return neighbors;
}

// Build Voronoi diagram and tile structure
function buildVoronoi(points, triangles) {
    // Check triangle validity and calculate centroids (blue nodes)
    validTriangles = new Set();
    voronoiVertices = [];
    for (let i = 0; i < triangles.length; i++) {
        const tri = triangles[i];
        const p1 = points[tri[0]];
        const p2 = points[tri[1]];
        const p3 = points[tri[2]];

        if (isTriangleValid(p1, p2, p3, MIN_ANGLE_DEG)) {
            validTriangles.add(i);
            voronoiVertices.push(getCentroid(p1, p2, p3));
        } else {
            voronoiVertices.push(null); // Placeholder for invalid triangles
        }
    }

    // Find triangle neighbors (share an edge)
    const triangleNeighbors = findNeighbors(triangles);

    // Build Voronoi edges (green lines) - connect centroids of adjacent valid triangles
    voronoiEdges = [];
    for (let i = 0; i < triangles.length; i++) {
        if (!validTriangles.has(i)) continue;
        for (const j of triangleNeighbors[i]) {
            if (j > i && validTriangles.has(j)) { // Both triangles must be valid
                voronoiEdges.push([i, j]);
            }
        }
    }

    // Build tiles: for each point, find all triangles containing it
    tiles = [];
    tileNeighbors = [];
    validTiles = new Set();
    edgeTiles = new Set();
    ineligibleTiles = new Set();

    for (let i = 0; i < points.length; i++) {
        // Find all valid triangles containing point i
        const trianglesWithPoint = [];
        for (let t = 0; t < triangles.length; t++) {
            if (triangles[t].includes(i) && validTriangles.has(t)) {
                trianglesWithPoint.push(t);
            }
        }

        tiles.push(trianglesWithPoint);

        // Find Delaunay neighbors: points connected by Delaunay edges from valid triangles
        const delaunayNeighbors = new Set();
        for (const t of trianglesWithPoint) {
            for (const v of triangles[t]) {
                if (v !== i) {
                    delaunayNeighbors.add(v);
                }
            }
        }

        // Find Voronoi neighbors: points that share a Voronoi edge (green line)
        // These are neighbors where the connecting Delaunay edge crosses a Voronoi edge
        const voronoiNeighbors = new Set();
        for (const neighbor of delaunayNeighbors) {
            // Check if this neighbor shares a Voronoi edge
            // They share a Voronoi edge if there are two valid triangles that both contain i and neighbor
            let sharedValidTriangles = 0;
            for (const t of trianglesWithPoint) {
                if (triangles[t].includes(neighbor)) {
                    sharedValidTriangles++;
                }
            }
            if (sharedValidTriangles >= 2) {
                voronoiNeighbors.add(neighbor);
            }
        }

        tileNeighbors.push(Array.from(voronoiNeighbors));

        // Validate tile: all tiles are valid if they have at least 3 vertices
        if (trianglesWithPoint.length >= 3) {
            validTiles.add(i);

            // Edge tile detection: if N Delaunay edges but fewer than N Voronoi neighbors
            const numDelaunayEdges = delaunayNeighbors.size;
            const numVoronoiNeighbors = voronoiNeighbors.size;

            if (numVoronoiNeighbors < numDelaunayEdges) {
                edgeTiles.add(i);
            }

            // Ineligible tiles: N valid edges but fewer than N valid neighbors
            if (numVoronoiNeighbors < numDelaunayEdges) {
                ineligibleTiles.add(i);
            }
        }
    }

    // Expand ineligible tiles: any tile next to an ineligible tile is also ineligible
    const initialIneligible = new Set(ineligibleTiles);
    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i)) continue;
        if (initialIneligible.has(i)) continue;

        // Check if any neighbor is ineligible
        for (const neighbor of tileNeighbors[i]) {
            if (initialIneligible.has(neighbor)) {
                ineligibleTiles.add(i);
                break;
            }
        }
    }

    // Create water-only tiles: 2-ring buffer around ineligible tiles
    // Tiles that border ineligible tiles OR neighbors of ineligible tiles are water-only
    waterOnlyTiles = new Set(ineligibleTiles);

    // Add first ring: neighbors of ineligible tiles
    const firstRing = new Set();
    for (const ineligible of ineligibleTiles) {
        if (tileNeighbors[ineligible]) {
            for (const neighbor of tileNeighbors[ineligible]) {
                if (validTiles.has(neighbor)) {
                    firstRing.add(neighbor);
                    waterOnlyTiles.add(neighbor);
                }
            }
        }
    }

    // Add second ring: neighbors of first ring
    for (const tile of firstRing) {
        if (tileNeighbors[tile]) {
            for (const neighbor of tileNeighbors[tile]) {
                if (validTiles.has(neighbor)) {
                    waterOnlyTiles.add(neighbor);
                }
            }
        }
    }
}

// Find center tile (closest to canvas center)
function findCenterTile() {
    const cx = width / 2;
    const cy = height / 2;
    let minDist = Infinity;
    let centerIdx = 0;

    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i) || waterOnlyTiles.has(i)) continue;
        const dx = points[i][0] - cx;
        const dy = points[i][1] - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDist) {
            minDist = dist;
            centerIdx = i;
        }
    }

    return centerIdx;
}

// Find outer ring points (boundary points)
function findOuterRingPoints() {
    const outerRing = new Set();

    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i)) continue;

        // A point is on the outer ring if it's an edge tile
        if (edgeTiles.has(i) || ineligibleTiles.has(i)) {
            outerRing.add(i);
        }
    }

    return outerRing;
}

// Calculate tile areas and find outliers
function findAreaOutliers() {
    const areas = [];
    const tileAreas = new Map();

    // Calculate areas for all valid, eligible tiles
    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i) || ineligibleTiles.has(i)) continue;
        if (tiles[i].length < 3) continue;

        const tileVertices = tiles[i].map(t => voronoiVertices[t]).filter(v => v !== null);
        if (tileVertices.length < 3) continue;

        // Order vertices
        const center = points[i];
        tileVertices.sort((a, b) => {
            const angleA = Math.atan2(a[1] - center[1], a[0] - center[0]);
            const angleB = Math.atan2(b[1] - center[1], b[0] - center[0]);
            return angleA - angleB;
        });

        const area = getPolygonArea(tileVertices);
        if (area > 0) {
            areas.push(area);
            tileAreas.set(i, area);
        }
    }

    if (areas.length === 0) return [];

    // Calculate median area
    areas.sort((a, b) => a - b);
    const medianArea = areas[Math.floor(areas.length / 2)];

    // Find outliers using hardcoded percentages
    const outliers = [];
    for (const [tileIdx, area] of tileAreas) {
        if (area > medianArea * (MAX_AREA_PERCENT / 100) || area < medianArea * (MIN_AREA_PERCENT / 100)) {
            outliers.push(tileIdx);
        }
    }

    return outliers;
}

// Find all 4-sided tiles among eligible tiles
function getFourSidedTiles() {
    const fourSided = [];
    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i)) continue;
        if (ineligibleTiles.has(i)) continue;

        const numNeighbors = tileNeighbors[i].length;
        if (numNeighbors === 4) {
            fourSided.push(i);
        }
    }
    return fourSided;
}

// ============================================================================
// Lloyd's Relaxation
// ============================================================================

// Apply Lloyd's relaxation to specific points (excluding outer ring)
function applyLloydsRelaxationToPoints(pointsToRelax, outerRing) {
    const relaxSet = new Set(pointsToRelax);
    const newPoints = [...points];

    for (const i of pointsToRelax) {
        // Skip outer ring points
        if (outerRing.has(i)) continue;

        if (!validTiles.has(i) || tiles[i].length < 3) {
            continue;
        }

        // Get the tile's vertices (centroids of triangles containing this point)
        const tileVertices = tiles[i].map(t => voronoiVertices[t]).filter(v => v !== null);

        if (tileVertices.length < 3) continue;

        // Order vertices around the center point
        const center = points[i];
        tileVertices.sort((a, b) => {
            const angleA = Math.atan2(a[1] - center[1], a[0] - center[0]);
            const angleB = Math.atan2(b[1] - center[1], b[0] - center[0]);
            return angleA - angleB;
        });

        // Calculate polygon centroid
        const centroid = getPolygonCentroid(tileVertices);

        if (centroid) {
            // Keep point within bounds
            const x = Math.max(bounds.x, Math.min(bounds.x + bounds.width, centroid[0]));
            const y = Math.max(bounds.y, Math.min(bounds.y + bounds.height, centroid[1]));
            newPoints[i] = [x, y];
        }
    }

    return newPoints;
}

// Merge 4-sided tiles with their closest neighbors
function merge4SidedTiles() {
    const fourSided = getFourSidedTiles();
    if (fourSided.length === 0) return { merged: false };

    // For each 4-sided tile, find its closest neighbor
    const closestPairs = [];
    for (const tile of fourSided) {
        let closestNeighbor = -1;
        let minDist = Infinity;

        for (const neighbor of tileNeighbors[tile]) {
            const dist = distance(points[tile], points[neighbor]);
            if (dist < minDist) {
                minDist = dist;
                closestNeighbor = neighbor;
            }
        }

        if (closestNeighbor !== -1) {
            // Store as sorted pair to avoid duplicates
            const pair = tile < closestNeighbor
                ? [tile, closestNeighbor]
                : [closestNeighbor, tile];
            closestPairs.push({ pair, dist: minDist });
        }
    }

    // Remove duplicate pairs and sort by distance
    const uniquePairs = new Map();
    for (const { pair, dist } of closestPairs) {
        const key = `${pair[0]},${pair[1]}`;
        if (!uniquePairs.has(key) || uniquePairs.get(key) > dist) {
            uniquePairs.set(key, dist);
        }
    }

    if (uniquePairs.size === 0) return { merged: false };

    // Merge pairs
    const mergedPoints = [];
    const pointMapping = new Map(); // old index -> new index
    const deletedPoints = new Set();
    const mergeLocations = []; // Track where merges happened

    let newIdx = 0;
    for (let i = 0; i < points.length; i++) {
        // Check if this point is part of a pair to merge
        let merged = false;
        for (const [key] of uniquePairs) {
            const [a, b] = key.split(',').map(Number);
            if (i === a) {
                // Create midpoint
                const midpoint = [
                    (points[a][0] + points[b][0]) / 2,
                    (points[a][1] + points[b][1]) / 2
                ];
                mergedPoints.push(midpoint);
                pointMapping.set(a, newIdx);
                pointMapping.set(b, newIdx);
                deletedPoints.add(a);
                deletedPoints.add(b);
                mergeLocations.push(newIdx);
                newIdx++;
                merged = true;
                break;
            } else if (i === b) {
                // Already handled by the 'a' case
                merged = true;
                break;
            }
        }

        if (!merged) {
            mergedPoints.push([...points[i]]);
            pointMapping.set(i, newIdx);
            newIdx++;
        }
    }

    return {
        merged: true,
        newPoints: mergedPoints,
        mergeLocations
    };
}

// Find all points within N connections of target points
function findPointsWithinDistance(targetIndices, connectionDistance) {
    const result = new Set(targetIndices);
    let frontier = new Set(targetIndices);

    for (let depth = 0; depth < connectionDistance; depth++) {
        const nextFrontier = new Set();
        for (const idx of frontier) {
            if (idx >= 0 && idx < points.length && tileNeighbors[idx]) {
                for (const neighbor of tileNeighbors[idx]) {
                    if (!result.has(neighbor)) {
                        result.add(neighbor);
                        nextFrontier.add(neighbor);
                    }
                }
            }
        }
        frontier = nextFrontier;
        if (frontier.size === 0) break;
    }

    return Array.from(result);
}

// ============================================================================
// Main Map Generation Function
// ============================================================================

// Generate map data for game logic
function generateMapData(mapType, numTiles, erosionRounds) {
    // Reset global state
    points = [];
    triangles = [];
    tileNeighbors = [];
    voronoiVertices = [];
    voronoiEdges = [];
    tiles = [];
    validTiles = new Set();
    edgeTiles = new Set();
    ineligibleTiles = new Set();
    waterOnlyTiles = new Set();
    validTriangles = new Set();

    // Generate points based on map type
    if (mapType === 'standard-catan') {
        points = generateHexGrid(500);
    } else if (mapType === 'expanded-hex') {
        points = generateHexGrid(500);
    } else if (mapType === 'delaunay-polygon') {
        points = poissonDiscSampling(500);
    }

    if (points.length < 3) {
        return { error: 'Not enough points generated' };
    }

    // Compute Delaunay triangulation
    let result = delaunay(points);
    triangles = result.triangles;

    if (triangles.length === 0) {
        return { error: 'Triangulation failed' };
    }

    // Build Voronoi diagram
    buildVoronoi(points, triangles);

    // Apply Lloyd's relaxation for Delaunay mode
    if (mapType === 'delaunay-polygon' && LLOYD_RELAXATION) {
        const maxIterations = 20;
        let iteration = 0;
        let fourSided = getFourSidedTiles();

        console.log(`Initial: ${fourSided.length} 4-sided tiles`);

        while ((fourSided.length > 0) && iteration < maxIterations) {
            iteration++;
            const outerRing = findOuterRingPoints();

            if (fourSided.length > 0) {
                const mergeResult = merge4SidedTiles();

                if (mergeResult.merged) {
                    points = mergeResult.newPoints;
                    result = delaunay(points);
                    triangles = result.triangles;

                    if (triangles.length === 0) break;

                    buildVoronoi(points, triangles);

                    const pointsToRelax = findPointsWithinDistance(mergeResult.mergeLocations, 2);
                    const newOuterRing = findOuterRingPoints();
                    points = applyLloydsRelaxationToPoints(pointsToRelax, newOuterRing);

                    result = delaunay(points);
                    triangles = result.triangles;

                    if (triangles.length === 0) break;

                    buildVoronoi(points, triangles);
                }
            }

            const areaOutliers = findAreaOutliers();
            if (areaOutliers.length > 0) {
                const pointsToRelax = new Set(areaOutliers);
                for (const outlier of areaOutliers) {
                    if (tileNeighbors[outlier]) {
                        for (const neighbor of tileNeighbors[outlier]) {
                            pointsToRelax.add(neighbor);
                        }
                    }
                }

                const newOuterRing = findOuterRingPoints();
                points = applyLloydsRelaxationToPoints(Array.from(pointsToRelax), newOuterRing);

                result = delaunay(points);
                triangles = result.triangles;

                if (triangles.length === 0) break;

                buildVoronoi(points, triangles);
            }

            fourSided = getFourSidedTiles();
        }

        console.log(`Lloyd's relaxation: ${iteration} iterations, ${fourSided.length} 4-sided tiles remain`);
    }

    // Generate land tiles based on map type
    const centerTile = findCenterTile();
    const landTiles = new Set();

    if (mapType === 'standard-catan') {
        // Center + 6 neighbors + 12 neighbors
        landTiles.add(centerTile);

        const ring1 = tileNeighbors[centerTile].filter(t => validTiles.has(t) && !waterOnlyTiles.has(t));
        ring1.forEach(t => landTiles.add(t));

        const ring2 = new Set();
        ring1.forEach(t => {
            tileNeighbors[t].forEach(n => {
                if (!landTiles.has(n) && validTiles.has(n) && !waterOnlyTiles.has(n)) {
                    ring2.add(n);
                }
            });
        });
        ring2.forEach(t => landTiles.add(t));

    } else {
        // Random propagation for expanded modes
        landTiles.add(centerTile);
        const frontier = [centerTile];

        while (landTiles.size < numTiles && frontier.length > 0) {
            const randomIdx = Math.floor(Math.random() * frontier.length);
            const current = frontier[randomIdx];
            frontier.splice(randomIdx, 1);

            let neighbors = tileNeighbors[current].filter(n =>
                validTiles.has(n) && !waterOnlyTiles.has(n)
            );

            const shuffled = neighbors.sort(() => Math.random() - 0.5);
            for (const neighbor of shuffled) {
                if (!landTiles.has(neighbor) && landTiles.size < numTiles) {
                    landTiles.add(neighbor);
                    frontier.push(neighbor);
                }
            }
        }
    }

    // Run erosion/accretion rounds
    const rootTile = centerTile;

    for (let round = 0; round < erosionRounds; round++) {
        const shoreTiles = [];
        landTiles.forEach(tile => {
            const hasNonLandNeighbor = tileNeighbors[tile].some(n => !landTiles.has(n));
            if (hasNonLandNeighbor) {
                shoreTiles.push(tile);
            }
        });

        if (shoreTiles.length === 0) break;

        let closestShore = shoreTiles[0];
        let minDist = distance(points[rootTile], points[closestShore]);
        for (const tile of shoreTiles) {
            const dist = distance(points[rootTile], points[tile]);
            if (dist < minDist) {
                minDist = dist;
                closestShore = tile;
            }
        }

        landTiles.delete(closestShore);

        const newShoreTiles = [];
        landTiles.forEach(tile => {
            const hasNonLandNeighbor = tileNeighbors[tile].some(n => !landTiles.has(n));
            if (hasNonLandNeighbor) {
                newShoreTiles.push(tile);
            }
        });

        if (newShoreTiles.length === 0) {
            landTiles.add(closestShore);
            break;
        }

        let furthestShore = newShoreTiles[0];
        let maxDist = distance(points[rootTile], points[furthestShore]);
        for (const tile of newShoreTiles) {
            const dist = distance(points[rootTile], points[tile]);
            if (dist > maxDist) {
                maxDist = dist;
                furthestShore = tile;
            }
        }

        const nonLandNeighbors = tileNeighbors[furthestShore].filter(n =>
            !landTiles.has(n) && validTiles.has(n) && !waterOnlyTiles.has(n)
        );

        if (nonLandNeighbors.length > 0) {
            const randomNeighbor = nonLandNeighbors[Math.floor(Math.random() * nonLandNeighbors.length)];
            landTiles.add(randomNeighbor);
        }
    }

    // Determine water tiles
    const waterTiles = new Set();
    landTiles.forEach(tile => {
        tileNeighbors[tile].forEach(neighbor => {
            if (!landTiles.has(neighbor) && validTiles.has(neighbor)) {
                waterTiles.add(neighbor);
            }
        });
    });

    // Post-processing: fix isolated tiles
    const tilesToFix = [];
    for (let i = 0; i < points.length; i++) {
        if (!validTiles.has(i)) continue;
        if (waterTiles.has(i)) continue;

        const neighbors = tileNeighbors[i];
        if (neighbors.length < 2) continue;

        const waterNeighborIndices = [];
        for (let j = 0; j < neighbors.length; j++) {
            if (waterTiles.has(neighbors[j])) {
                waterNeighborIndices.push(j);
            }
        }

        if (waterNeighborIndices.length < 2) continue;

        let hasNonAdjacentWater = false;
        for (let a = 0; a < waterNeighborIndices.length; a++) {
            for (let b = a + 1; b < waterNeighborIndices.length; b++) {
                const idxA = waterNeighborIndices[a];
                const idxB = waterNeighborIndices[b];
                const diff = Math.abs(idxA - idxB);

                if (diff !== 1 && diff !== neighbors.length - 1) {
                    hasNonAdjacentWater = true;
                    break;
                }
            }
            if (hasNonAdjacentWater) break;
        }

        if (hasNonAdjacentWater) {
            tilesToFix.push(i);
        }
    }

    for (const tile of tilesToFix) {
        const neighbors = tileNeighbors[tile];
        const allWater = neighbors.every(n => waterTiles.has(n));
        const hasLand = neighbors.some(n => landTiles.has(n));

        if (allWater) {
            waterTiles.add(tile);
            landTiles.delete(tile);
        } else if (hasLand) {
            landTiles.add(tile);
        }
    }

    // Collect all relevant tiles
    const allGameTiles = new Set([...landTiles, ...waterTiles]);

    // Collect red circles (tile centers)
    const redCircles = {
        land: Array.from(landTiles).map(i => ({ id: i, position: points[i] })),
        water: Array.from(waterTiles).map(i => ({ id: i, position: points[i] }))
    };

    // Collect blue nodes (Voronoi vertices connected to game tiles)
    const relevantBlueNodes = new Set();
    for (const tileIdx of allGameTiles) {
        for (const triIdx of tiles[tileIdx]) {
            if (validTriangles.has(triIdx)) {
                relevantBlueNodes.add(triIdx);
            }
        }
    }

    const blueNodes = Array.from(relevantBlueNodes).map(i => ({
        id: i,
        position: voronoiVertices[i]
    }));

    // Collect green edges (Voronoi edges between blue nodes)
    const greenEdges = [];
    for (const edge of voronoiEdges) {
        if (relevantBlueNodes.has(edge[0]) && relevantBlueNodes.has(edge[1])) {
            greenEdges.push({ from: edge[0], to: edge[1] });
        }
    }

    // Collect black edges (Delaunay edges between red nodes)
    const blackEdges = [];
    for (const tileIdx of allGameTiles) {
        for (const neighbor of tileNeighbors[tileIdx]) {
            if (allGameTiles.has(neighbor) && tileIdx < neighbor) {
                blackEdges.push({ from: tileIdx, to: neighbor });
            }
        }
    }

    return {
        redCircles,
        blueNodes,
        greenEdges,
        blackEdges,
        metadata: {
            mapType,
            totalLandTiles: landTiles.size,
            totalWaterTiles: waterTiles.size,
            totalBlueNodes: blueNodes.length,
            totalGreenEdges: greenEdges.length,
            totalBlackEdges: blackEdges.length
        }
    };
}

// ============================================================================
// Export for external use
// ============================================================================

window.generateMapData = generateMapData;
