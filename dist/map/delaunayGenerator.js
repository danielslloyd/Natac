// Delaunay-centroid based irregular polygon map generator
import { Resource } from '../models/types.js';
import { generateId, SeededRandom, centroid, sortPointsByAngle, pointsEqual, polygonArea, ensureCounterClockwise } from '../core/utils.js';
export function generateDelaunayMap(params) {
    const { seed, targetTileCount = 30, irregularity = 0.3, boundingRadius = 300, smoothingIters = 2 } = params;
    const rng = new SeededRandom(seed);
    // Step 1: Generate random points
    let points = generateRandomPoints(targetTileCount, boundingRadius, rng);
    // Step 2: Apply Lloyd relaxation for more uniform distribution
    points = lloydRelaxation(points, boundingRadius, smoothingIters, rng);
    // Step 3: Apply irregularity displacement
    points = applyIrregularity(points, irregularity, boundingRadius / Math.sqrt(targetTileCount), rng);
    // Step 4: Compute Delaunay triangulation
    const { triangles, pointsArray } = computeDelaunay(points);
    // Step 5: Build polygons from triangle centroids
    const polygons = buildPolygonsFromCentroids(points, triangles, pointsArray);
    // Step 6: Convert to game map format
    const mapData = convertToMapData(polygons, rng);
    return mapData;
}
function generateRandomPoints(count, radius, rng) {
    const points = [];
    for (let i = 0; i < count; i++) {
        // Generate point in circle
        const angle = rng.next() * 2 * Math.PI;
        const r = Math.sqrt(rng.next()) * radius * 0.9; // Keep slightly inside boundary
        points.push({
            id: generateId('point'),
            x: r * Math.cos(angle),
            y: r * Math.sin(angle)
        });
    }
    return points;
}
function lloydRelaxation(points, radius, iterations, rng) {
    let current = [...points];
    for (let iter = 0; iter < iterations; iter++) {
        // Build Voronoi diagram and move points to centroids
        const { triangles, pointsArray } = computeDelaunay(current);
        const newPoints = current.map((point, idx) => {
            // Find all triangles containing this point
            const containingTriangles = triangles.filter(t => t.points.includes(idx));
            if (containingTriangles.length === 0)
                return point;
            // Calculate centroid of all triangle centroids (approximation of Voronoi cell centroid)
            const centroids = containingTriangles.map(t => t.centroid);
            const avgCentroid = centroid(centroids);
            // Move point toward centroid (partial step for stability)
            const newX = point.x * 0.3 + avgCentroid[0] * 0.7;
            const newY = point.y * 0.3 + avgCentroid[1] * 0.7;
            // Keep within bounds
            const dist = Math.sqrt(newX * newX + newY * newY);
            if (dist > radius * 0.9) {
                const scale = (radius * 0.9) / dist;
                return { ...point, x: newX * scale, y: newY * scale };
            }
            return { ...point, x: newX, y: newY };
        });
        current = newPoints;
    }
    return current;
}
function applyIrregularity(points, irregularity, cellRadius, rng) {
    return points.map(point => {
        const angle = rng.next() * 2 * Math.PI;
        const magnitude = rng.next() * irregularity * cellRadius;
        return {
            ...point,
            x: point.x + magnitude * Math.cos(angle),
            y: point.y + magnitude * Math.sin(angle)
        };
    });
}
function computeDelaunay(points) {
    // Convert points to flat array for delaunay
    const coords = [];
    const pointsArray = [];
    points.forEach(p => {
        coords.push(p.x, p.y);
        pointsArray.push([p.x, p.y]);
    });
    // Simple Delaunay implementation using Bowyer-Watson algorithm
    const triangles = bowyerWatson(pointsArray);
    return {
        triangles: triangles.map((t, idx) => ({
            id: generateId('tri'),
            points: t,
            centroid: centroid([pointsArray[t[0]], pointsArray[t[1]], pointsArray[t[2]]])
        })),
        pointsArray
    };
}
// Simple Bowyer-Watson Delaunay triangulation
function bowyerWatson(points) {
    if (points.length < 3)
        return [];
    // Find bounding triangle (super triangle)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    points.forEach(p => {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
    });
    const dx = maxX - minX;
    const dy = maxY - minY;
    const deltaMax = Math.max(dx, dy);
    const midx = (minX + maxX) / 2;
    const midy = (minY + maxY) / 2;
    // Super triangle vertices (large enough to contain all points)
    const superTriangle = [
        [midx - 20 * deltaMax, midy - deltaMax],
        [midx, midy + 20 * deltaMax],
        [midx + 20 * deltaMax, midy - deltaMax]
    ];
    // Add super triangle points
    const allPoints = [...points, ...superTriangle];
    const superIndices = [points.length, points.length + 1, points.length + 2];
    // Start with super triangle
    const triangles = [superIndices];
    // Add each point one at a time
    for (let i = 0; i < points.length; i++) {
        const point = allPoints[i];
        const badTriangles = [];
        // Find all triangles whose circumcircle contains the point
        triangles.forEach(tri => {
            if (inCircumcircle(point, allPoints[tri[0]], allPoints[tri[1]], allPoints[tri[2]])) {
                badTriangles.push(tri);
            }
        });
        // Find the boundary of the polygonal hole
        const polygon = [];
        badTriangles.forEach(tri => {
            for (let j = 0; j < 3; j++) {
                const edge = [tri[j], tri[(j + 1) % 3]];
                // Check if edge is shared by another bad triangle
                const isShared = badTriangles.some(otherTri => otherTri !== tri && ((otherTri.includes(edge[0]) && otherTri.includes(edge[1]))));
                if (!isShared) {
                    polygon.push(edge);
                }
            }
        });
        // Remove bad triangles
        badTriangles.forEach(bad => {
            const idx = triangles.indexOf(bad);
            if (idx !== -1)
                triangles.splice(idx, 1);
        });
        // Re-triangulate the polygonal hole
        polygon.forEach(edge => {
            triangles.push([edge[0], edge[1], i]);
        });
    }
    // Remove triangles that share vertices with super triangle
    const result = triangles.filter(tri => !tri.some(idx => idx >= points.length));
    return result;
}
function inCircumcircle(p, a, b, c) {
    const ax = a[0] - p[0];
    const ay = a[1] - p[1];
    const bx = b[0] - p[0];
    const by = b[1] - p[1];
    const cx = c[0] - p[0];
    const cy = c[1] - p[1];
    const det = (ax * ax + ay * ay) * (bx * cy - cx * by) -
        (bx * bx + by * by) * (ax * cy - cx * ay) +
        (cx * cx + cy * cy) * (ax * by - bx * ay);
    return det > 0;
}
function buildPolygonsFromCentroids(points, triangles, pointsArray) {
    const polygons = [];
    points.forEach((point, idx) => {
        // Find all triangles containing this point
        const containingTriangles = triangles.filter(t => t.points.includes(idx));
        if (containingTriangles.length < 3)
            return; // Skip degenerate cases
        // Get centroids
        const centroids = containingTriangles.map(t => t.centroid);
        // Sort centroids by angle around the point
        const sorted = sortPointsByAngle(centroids, [point.x, point.y]);
        // Ensure counter-clockwise
        const vertices = ensureCounterClockwise(sorted);
        // Only include if reasonable polygon
        if (vertices.length >= 5 && vertices.length <= 8) {
            const area = polygonArea(vertices);
            if (area > 100) { // Minimum area threshold
                polygons.push({
                    pointId: point.id,
                    center: [point.x, point.y],
                    vertices
                });
            }
        }
    });
    return polygons;
}
function convertToMapData(polygons, rng) {
    const tiles = [];
    const nodeMap = new Map();
    const edgeMap = new Map();
    const epsilon = 0.5;
    function getOrCreateNode(position) {
        // Find existing node
        for (const nodeData of nodeMap.values()) {
            if (pointsEqual(position, nodeData.position, epsilon)) {
                return nodeData.nodeId;
            }
        }
        // Create new
        const nodeId = generateId('node');
        const key = `${position[0].toFixed(1)},${position[1].toFixed(1)}`;
        nodeMap.set(key, { position, nodeId });
        return nodeId;
    }
    function getOrCreateEdge(nodeA, nodeB) {
        const key1 = `${nodeA}:${nodeB}`;
        const key2 = `${nodeB}:${nodeA}`;
        if (edgeMap.has(key1))
            return edgeMap.get(key1);
        if (edgeMap.has(key2))
            return edgeMap.get(key2);
        const edgeId = generateId('edge');
        edgeMap.set(key1, edgeId);
        return edgeId;
    }
    // Create tiles
    polygons.forEach(poly => {
        const nodeIds = poly.vertices.map(v => getOrCreateNode(v));
        const edgeIds = [];
        for (let i = 0; i < nodeIds.length; i++) {
            const next = (i + 1) % nodeIds.length;
            edgeIds.push(getOrCreateEdge(nodeIds[i], nodeIds[next]));
        }
        const shape = nodeIds.length;
        tiles.push({
            id: generateId('tile'),
            shape,
            polygonPoints: poly.vertices,
            resource: Resource.WOOD,
            diceNumber: null,
            edges: edgeIds,
            nodes: nodeIds,
            robberPresent: false
        });
    });
    // Build node-to-tiles mapping
    const nodeTilesMap = new Map();
    tiles.forEach(tile => {
        tile.nodes.forEach(nodeId => {
            if (!nodeTilesMap.has(nodeId)) {
                nodeTilesMap.set(nodeId, []);
            }
            nodeTilesMap.get(nodeId).push(tile.id);
        });
    });
    // Filter nodes to only those touching exactly 3 tiles
    const validNodes = Array.from(nodeMap.values())
        .filter(nodeData => {
        const tiles = nodeTilesMap.get(nodeData.nodeId) || [];
        return tiles.length === 3;
    });
    // Create nodes
    const nodes = validNodes.map(nodeData => ({
        id: nodeData.nodeId,
        location: nodeData.position,
        tiles: nodeTilesMap.get(nodeData.nodeId) || [],
        occupant: null
    }));
    // Create edges
    const edges = [];
    const processedEdges = new Set();
    tiles.forEach(tile => {
        for (let i = 0; i < tile.nodes.length; i++) {
            const nodeA = tile.nodes[i];
            const nodeB = tile.nodes[(i + 1) % tile.nodes.length];
            const edgeId = getOrCreateEdge(nodeA, nodeB);
            if (!processedEdges.has(edgeId)) {
                processedEdges.add(edgeId);
                const tilesWithEdge = tiles.filter(t => t.edges.includes(edgeId));
                edges.push({
                    id: edgeId,
                    nodeA,
                    nodeB,
                    tileLeft: tilesWithEdge[0]?.id || null,
                    tileRight: tilesWithEdge[1]?.id || null,
                    roadOwner: null
                });
            }
        }
    });
    // Assign resources
    assignResources(tiles, rng);
    return { tiles, nodes, edges };
}
function assignResources(tiles, rng) {
    const resources = [Resource.WOOD, Resource.BRICK, Resource.SHEEP, Resource.WHEAT, Resource.ORE];
    const diceNumbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
    // Assign one desert
    const desertIdx = rng.nextInt(0, tiles.length - 1);
    tiles.forEach((tile, idx) => {
        if (idx === desertIdx) {
            tile.resource = Resource.DESERT;
            tile.diceNumber = null;
            tile.robberPresent = true;
        }
        else {
            tile.resource = resources[rng.nextInt(0, resources.length - 1)];
            tile.diceNumber = diceNumbers[rng.nextInt(0, diceNumbers.length - 1)];
        }
    });
}
//# sourceMappingURL=delaunayGenerator.js.map