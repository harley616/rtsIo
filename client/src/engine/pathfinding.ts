import { GridLocation } from "./types";
import { tileKey, TileKey } from "./grid";

// --- A* grid pathfinding ---
//
// Routes a mover around STATIC obstacles (buildings, resources) on the tile
// grid. Dynamic unit-vs-unit jostling is NOT this layer's job — that stays in
// updateMovable's local steering. A path is computed once when a goal is
// assigned and then followed waypoint-to-waypoint.
//
// Determinism (lockstep): the result must be byte-identical on every client or
// the sim desyncs. Three rules enforce that here:
//   1. Integer costs only (no Math.sqrt(2)) — floats could diverge per-platform.
//   2. Neighbours expanded in a single FIXED order (NEIGHBORS below).
//   3. The open set pops in (f, tileKey) order — ties break on tileKey, never
//      on insertion timing or Map iteration order.

// 10/14 is the standard integer stand-in for 1 / sqrt(2): a diagonal step costs
// 1.4x an orthogonal one, exactly and without floats.
const ORTHO_COST = 10;
const DIAG_COST = 14;

// Backstop against an unreachable goal expanding the whole world. The play area
// is ~200x200 (see grid.ts MAX_RING); this covers it many times over.
const MAX_EXPANSIONS = 1 << 16;

// 8-connected neighbours in a FIXED order — this array is the single source of
// expansion order, which determinism depends on.
const NEIGHBORS: ReadonlyArray<{ dx: number; dz: number; cost: number }> = [
    { dx: 0, dz: -1, cost: ORTHO_COST },
    { dx: 1, dz: 0, cost: ORTHO_COST },
    { dx: 0, dz: 1, cost: ORTHO_COST },
    { dx: -1, dz: 0, cost: ORTHO_COST },
    { dx: 1, dz: -1, cost: DIAG_COST },
    { dx: 1, dz: 1, cost: DIAG_COST },
    { dx: -1, dz: 1, cost: DIAG_COST },
    { dx: -1, dz: -1, cost: DIAG_COST },
];

// Octile heuristic in the same integer units as the costs. It equals the true
// cost on an empty 8-grid, so it's admissible AND consistent (never overshoots,
// never needs node re-opening) — exactly what keeps A* both correct and cheap.
function heuristic(tx: number, tz: number, gx: number, gz: number): number {
    const dx = Math.abs(tx - gx);
    const dz = Math.abs(tz - gz);
    return ORTHO_COST * (dx + dz) + (DIAG_COST - 2 * ORTHO_COST) * Math.min(dx, dz);
}

interface OpenNode {
    key: TileKey;
    tx: number;
    tz: number;
    g: number;
    f: number;
}

// Binary min-heap ordered by (f, tileKey). The tileKey tie-break is what makes
// pop order a total, deterministic function of state.
class OpenHeap {
    private items: OpenNode[] = [];

    get size(): number {
        return this.items.length;
    }

    private less(a: OpenNode, b: OpenNode): boolean {
        return a.f < b.f || (a.f === b.f && a.key < b.key);
    }

    push(node: OpenNode): void {
        const items = this.items;
        items.push(node);
        let i = items.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (!this.less(items[i], items[parent])) break;
            [items[i], items[parent]] = [items[parent], items[i]];
            i = parent;
        }
    }

    pop(): OpenNode {
        const items = this.items;
        const top = items[0];
        const last = items.pop()!;
        if (items.length > 0) {
            items[0] = last;
            let i = 0;
            const n = items.length;
            for (;;) {
                const left = 2 * i + 1;
                const right = 2 * i + 2;
                let smallest = i;
                if (left < n && this.less(items[left], items[smallest])) smallest = left;
                if (right < n && this.less(items[right], items[smallest])) smallest = right;
                if (smallest === i) break;
                [items[i], items[smallest]] = [items[smallest], items[i]];
                i = smallest;
            }
        }
        return top;
    }
}

// Walk the cameFrom chain back from the goal. Returns waypoints from the tile
// AFTER start through the goal tile (the start tile is dropped — the mover is
// already standing there). Empty array means "already at goal".
function reconstruct(cameFrom: Map<TileKey, GridLocation>, goal: GridLocation): GridLocation[] {
    const path: GridLocation[] = [];
    let cur: GridLocation | undefined = goal;
    while (cur) {
        path.push(cur);
        cur = cameFrom.get(tileKey(cur.x, cur.z));
    }
    path.reverse();
    path.shift(); // drop the start tile
    return path;
}

/**
 * Find a tile-grid route from `start` to `goal` around static obstacles.
 *
 * @param isBlocked  true if a tile is impassable. The caller decides what
 *                   "blocked" means — see notes below on static vs dynamic and
 *                   on the goal tile itself.
 * @returns ordered waypoints (start excluded, goal included), [] if already at
 *          the goal, or null if no route exists / the goal is unreachable.
 */
export function findPath(
    start: GridLocation,
    goal: GridLocation,
    isBlocked: (tx: number, tz: number) => boolean,
): GridLocation[] | null {
    const startKey = tileKey(start.x, start.z);
    const goalKey = tileKey(goal.x, goal.z);
    if (startKey === goalKey) return [];

    const open = new OpenHeap();
    const gScore = new Map<TileKey, number>();
    const cameFrom = new Map<TileKey, GridLocation>();
    const closed = new Set<TileKey>();

    gScore.set(startKey, 0);
    open.push({ key: startKey, tx: start.x, tz: start.z, g: 0, f: heuristic(start.x, start.z, goal.x, goal.z) });

    let expansions = 0;
    while (open.size > 0) {
        const cur = open.pop();
        if (cur.key === goalKey) return reconstruct(cameFrom, goal);
        // Lazy deletion: a tile can sit in the heap more than once after a
        // cheaper path to it is found; ignore the stale, already-closed copies.
        if (closed.has(cur.key)) continue;
        closed.add(cur.key);
        if (++expansions > MAX_EXPANSIONS) break;

        for (const n of NEIGHBORS) {
            const ntx = cur.tx + n.dx;
            const ntz = cur.tz + n.dz;
            if (isBlocked(ntx, ntz)) continue;
            // No corner-cutting: a diagonal step is only legal if both tiles it
            // squeezes between are open. Otherwise units clip building corners.
            if (n.cost === DIAG_COST && (isBlocked(cur.tx + n.dx, cur.tz) || isBlocked(cur.tx, cur.tz + n.dz))) {
                continue;
            }
            const nKey = tileKey(ntx, ntz);
            if (closed.has(nKey)) continue;
            const tentative = cur.g + n.cost;
            const prev = gScore.get(nKey);
            if (prev === undefined || tentative < prev) {
                gScore.set(nKey, tentative);
                cameFrom.set(nKey, { x: cur.tx, z: cur.tz });
                open.push({ key: nKey, tx: ntx, tz: ntz, g: tentative, f: tentative + heuristic(ntx, ntz, goal.x, goal.z) });
            }
        }
    }
    return null;
}
