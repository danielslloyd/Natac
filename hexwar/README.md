# hexwar — hex-ish tactics engine + game variants

A self-contained combat-game framework living entirely inside `hexwar/`. It
shares the *spirit* of the repo's map generators (regular hex grids and
"hexish" pentagon/hexagon/heptagon maps) but has no imports from `src/`, so it
can be lifted out wholesale.

**Everything is headless-first.** The UI is a thin canvas page; every rule
runs identically in Node, games are deterministic under a seed, and the AI
interface is a single function — the architecture is built for plugging in
agents and running simulated games at scale.

## Quick start

```bash
npm install
npm run serve                 # open http://localhost:8080/hexwar/
                               # → level editor: http://localhost:8080/hexwar/editor.html
npm test                      # engine + variant unit tests
npm run sim                   # headless AI-vs-AI match (civ variant)
node hexwar/sim/run.js --variant all --matches 10 --agents heuristic,random
node hexwar/sim/run.js --variant hexiso --options rangeMode=los --verbose
```

## Layout

```
hexwar/
  core/
    util.js      seeded RNG, blob noise fields, small math
    map.js       TileMap abstraction + generators:
                   generateHexMap        — regular pointy-top hex grid
                   generateHexishMap     — Voronoi over blue-noise points,
                                           optionally density-weighted
                   buildHexishFromPoints, relaxPointsInRadius, addPoint —
                                           the point-editing primitives the
                                           level editor drives directly
    engine.js    Game: units, dual-budget Dijkstra movement, civ-style
                 combat, actions, turn/round loop, objectives, observe()
    los.js       per-tile-pair elevation line of sight
    serialize.js TileMap <-> plain JSON, for export/import and buildMap's
                 `opts.customMap` override
  games/
    common.js    army/objective placement helpers
    stretch.js   hexiso.js   civ.js   rift.js   surge.js   index.js
  ai/
    agents.js    Agent interface + RandomAgent, HeuristicAgent,
                 playTurn(), runMatch()
  sim/
    run.js       CLI simulation runner (the AI-training harness)
  tests/
    hexwar.test.js
  index.html     minimal canvas UI (clean lines, verbose text hints)
  editor.html    level editor for stretch / hexiso / civ (see below)
```

## The framework

A **Game** = `TileMap` + `Ruleset`. The engine owns everything that is the
same in every variant: units and one-unit-per-tile occupancy, movement
search, attack targeting, HP-ratio combat with counterattacks and melee
advance, fortify/heal, objective scoring, elimination and round-limit
victory, logging, and serialization. A **Ruleset** owns everything
geometric/terrain-specific through a small hook contract (documented at the
top of `core/engine.js`):

- `buildMap` / `setup` — geometry, terrain in `tile.props`, edge features in
  `map.edgeProps`, starting armies, objectives
- `moveCost(game, unit, from, to)` — per-step cost, `Infinity` = wall
- `lineCost` / `lineBudget` — optional **second** movement budget (used by
  hexiso for iso-line crossings; the engine runs a Pareto-label Dijkstra so
  both budgets are honored simultaneously)
- `attackRange`, `canTarget` — range in tiles + optional per-pair check (LOS)
- `attackModifier` / `defenseModifier` — situational combat math
- `extraActions` / `applyExtraAction` — variant verbs (fortify, bridge)
- `onRoundStart` / `onTurnStart` / `victory` — timers, tides, win checks

Distances and ranges are **always counted in tiles** (BFS hops), which is
what makes the geometry-as-terrain variants work.

## The variants

| key | map | the twist |
|---|---|---|
| `stretch` | hexish | No terrain at all. Parts of the map are tiled more densely; since movement and range are strictly tile-counted, dense regions are slow and shorten weapon reach — difficult terrain made of pure geometry. |
| `hexiso` | hex | Integer elevation per tile, drawn only as curving iso lines on edges. Movement spends tiles **and** iso-line crossings (per-type climb budgets), so cliffs wall off some units but not others. Ranged units toggle between simple N-tile range and true per-pair line of sight. |
| `civ` | hex or hexish (toggle) | Civilization V combat: terrain move costs and defense bonuses, zone of control, fortify, melee counterattacks and advance, ranged fire blocked by forest/hill unless shooting from a hill. |
| `rift` | hex | Terrain lives on the **edges**: rivers (crossing eats the whole move, −25% attacking across) and impassable rifts, with a few bridges; Pioneers build more. Ranged fire ignores edges — canyons don't stop arrows. |
| `surge` | hexish | Elevation plus a fully forecast tide on a 12-round cycle. Flooded tiles block land units and drown stragglers; Marines wade. Causeways open and close — the map itself is the changing battlefield. |

All variants share the same objective scoring (hold a starred tile at round
end; first to the target score, or last army standing, wins).

## Level editor (`editor.html`)

A hand-sculpting tool for the three variants whose maps are worth authoring
by hand — `stretch`, `hexiso`, `civ`. Not implemented for `rift`/`surge`
(their maps are edge-features/tide-driven, not a good fit for point-and-paint).

- **Stretch** — the map *is* a Voronoi point layout, so the tools edit points
  directly: **Add** drops new points where you click/drag (packing them
  tighter makes smaller, faster-to-cross tiles); **Erase** removes every
  point inside the brush; **Relax** nudges points inside the brush toward
  their own cell's centroid each pass — a "smoothing" brush that evens out a
  chaotic patch into regular hexagon-like cells without changing the point
  count. `buildHexishFromPoints` rebuilds the Voronoi diagram from the live
  point list after every stroke.
- **Hex Iso** — **Raise**/**Lower** bump every tile in the brush by one
  elevation step; **Flatten to…** sets the brush to a chosen level. Iso lines
  redraw live as you sculpt, exactly as the game renders them.
- **Civ** — pick a terrain from the palette (plains/forest/hill/mountain/
  water) and paint it on with the brush; toggle hex vs. hexish map style.

Each variant also has **Randomize** (reruns the same blob-noise generation
the game itself uses, as a starting point to hand-edit from) and **Generate
new** (a blank canvas — flat elevation / all-plains / freshly sampled points).

**Export JSON** downloads the current map; **Import JSON** loads one back
(including, for `stretch`, the exact underlying point list, so editing can
resume losslessly). **▶ Play this map** stashes the map in `localStorage`
and opens `index.html` with it pre-loaded — `createGame`'s `options.customMap`
short-circuits that variant's `buildMap` straight to `deserializeMap`, so a
hand-edited map is exercised through the same engine, AI agents, and
`sim/run.js` as a procedurally generated one.

## Plugging in an AI

An agent is anything with:

```js
chooseAction(game, playerId, legalActions) -> action
```

`game.legalActions(playerId)` enumerates every legal action (`move`,
`attack`, `endTurn`, plus variant verbs), `game.applyAction(action)` advances
the state and reports `{ ok, events }`. For model-based agents,
`game.observe()` returns the full state as plain JSON and
`game.describeMap()` the static geometry — a policy can be a pure
`(observation, legalActions) -> action` function. `runMatch(game, agents)`
drives a full game headless; `sim/run.js` wraps it with seeds, match counts,
and per-variant options. Two reference agents ship in `ai/agents.js`:
`random` and `heuristic` (greedy attacks + goal-seeking movement).

Determinism: same seed + same agents ⇒ identical game, byte for byte
(covered by a test), which makes replay logging and self-play training
straightforward.

## Adding a variant

1. Create `games/<key>.js` exporting a ruleset object (copy the closest
   existing one; `stretch.js` is the smallest).
2. Register it in `games/index.js`.
3. It immediately works in the UI dropdown, the sim runner, and the
   "all variants complete a match" test.
