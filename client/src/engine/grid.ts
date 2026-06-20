import { EntityID } from "./types";

// --- Spatial grid ---
//
// A derived spatial index over the world. The per-player entity Maps in Game
// remain the source of truth; this grid is kept in sync as entities are
// created, moved, and deleted, and accelerates spatial queries (nearest
// resource, in-radius enemies) and tile occupancy / collision checks.
//
// Determinism (lockstep): the grid is NEVER iterated in an order-sensitive way
// that feeds simulation state. Cells store a Set<EntityID>, whose insertion
// order is itself a deterministic function of the command stream, and all
// queries walk tiles in a fixed nested-loop order. Consumers that pick a single
// winner must still break ties on EntityID — see getClosestEnemy/getNearestResource.

const TILE_SIZE = 1; // world units per tile; the map is already integer-tiled

// Pack (tx, tz) into one integer key. ORIGIN keeps keys non-negative; STRIDE
// must exceed the addressable width. Supports tile coords in [-32768, 32767].
const ORIGIN = 1 << 15;
const STRIDE = 1 << 16;

// Safety cap on queryNearest ring expansion so a fully-depleted map can't spin
// the search unbounded. Comfortably covers the ~[-100,100] play area.
const MAX_RING = 256;

export type TileKey = number;

export function toTile(x: number, z: number): { tx: number; tz: number } {
    return { tx: Math.floor(x / TILE_SIZE), tz: Math.floor(z / TILE_SIZE) };
}

export function tileKey(tx: number, tz: number): TileKey {
    return (tx + ORIGIN) * STRIDE + (tz + ORIGIN);
}

export class SpatialGrid {
    // tile -> entities occupying it. Set preserves insertion order.
    private cells: Map<TileKey, Set<EntityID>> = new Map();
    // reverse index: entity -> every tile key it occupies (one for units, the
    // full footprint for multi-tile structures), so move/remove are O(footprint).
    private entityCells: Map<EntityID, TileKey[]> = new Map();

    // Single-tile insert for point entities (units, 1x1 resources).
    insert(id: EntityID, x: number, z: number): void {
        // Idempotent: if already tracked, treat as a move.
        if (this.entityCells.has(id)) {
            this.move(id, x, z);
            return;
        }
        const { tx, tz } = toTile(x, z);
        const key = tileKey(tx, tz);
        this.addToCell(key, id);
        this.entityCells.set(id, [key]);
    }

    // Occupy every tile in the [origin, origin+size) footprint. For static
    // multi-tile structures; such entities are not expected to move().
    insertArea(id: EntityID, originX: number, originZ: number, width: number, height: number): void {
        if (this.entityCells.has(id)) this.remove(id);
        const origin = toTile(originX, originZ);
        const keys: TileKey[] = [];
        for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < height; dz++) {
                const key = tileKey(origin.tx + dx, origin.tz + dz);
                this.addToCell(key, id);
                keys.push(key);
            }
        }
        this.entityCells.set(id, keys);
    }

    remove(id: EntityID): void {
        const keys = this.entityCells.get(id);
        if (keys === undefined) return;
        for (const key of keys) this.removeFromCell(key, id);
        this.entityCells.delete(id);
    }

    // The single position-change chokepoint for movers. No-op unless the entity
    // crossed a tile boundary, so it's cheap to call every tick for every unit.
    // Movers are single-tile; a multi-tile entity collapses to one tile if moved.
    move(id: EntityID, x: number, z: number): void {
        const keys = this.entityCells.get(id);
        if (keys === undefined) {
            this.insert(id, x, z);
            return;
        }
        const { tx, tz } = toTile(x, z);
        const newKey = tileKey(tx, tz);
        if (keys.length === 1 && keys[0] === newKey) return;
        this.remove(id);
        this.addToCell(newKey, id);
        this.entityCells.set(id, [newKey]);
    }

    at(tx: number, tz: number): ReadonlySet<EntityID> | undefined {
        return this.cells.get(tileKey(tx, tz));
    }

    isOccupied(tx: number, tz: number): boolean {
        const cell = this.cells.get(tileKey(tx, tz));
        return cell !== undefined && cell.size > 0;
    }

    // All entity IDs in tiles overlapping the [x±r, z±r] box. The caller does
    // the exact circular distance test. Returned in deterministic tile order;
    // sort by EntityID before any tie-sensitive reduction.
    queryRadius(x: number, z: number, r: number): EntityID[] {
        const min = toTile(x - r, z - r);
        const max = toTile(x + r, z + r);
        const out: EntityID[] = [];
        for (let tx = min.tx; tx <= max.tx; tx++) {
            for (let tz = min.tz; tz <= max.tz; tz++) {
                const cell = this.cells.get(tileKey(tx, tz));
                if (!cell) continue;
                for (const id of cell) out.push(id);
            }
        }
        return out;
    }

    // Unbounded nearest. `resolve` returns an entity's true position, or null to
    // reject it (wrong kind, depleted, etc.). The grid only narrows candidates;
    // exact distances come from the resolved positions, so this works for
    // float-positioned units as well as tile-aligned buildings/resources.
    // Ties break on the lowest EntityID. Returns -1 if nothing matches.
    queryNearest(x: number, z: number, resolve: (id: EntityID) => { x: number; z: number } | null): EntityID {
        const center = toTile(x, z);
        let best: EntityID = -1;
        let bestDist = Infinity;

        const consider = (tx: number, tz: number) => {
            const cell = this.cells.get(tileKey(tx, tz));
            if (!cell) return;
            for (const id of cell) {
                const pos = resolve(id);
                if (!pos) continue;
                const dx = pos.x - x;
                const dz = pos.z - z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (best < 0 || d < bestDist || (d === bestDist && id < best)) {
                    best = id;
                    bestDist = d;
                }
            }
        };

        for (let ring = 0; ; ring++) {
            // The nearest a tile at this ring can be is (ring-1) tile-widths
            // away; once that exceeds our best hit, no closer match remains.
            if (best >= 0 && (ring - 1) * TILE_SIZE > bestDist) break;
            if (ring > MAX_RING) break;

            if (ring === 0) {
                consider(center.tx, center.tz);
                continue;
            }
            for (let d = -ring; d <= ring; d++) {
                consider(center.tx + d, center.tz - ring); // top edge
                consider(center.tx + d, center.tz + ring); // bottom edge
            }
            for (let d = -ring + 1; d <= ring - 1; d++) {
                consider(center.tx - ring, center.tz + d); // left edge
                consider(center.tx + ring, center.tz + d); // right edge
            }
        }
        return best;
    }

    private addToCell(key: TileKey, id: EntityID): void {
        let cell = this.cells.get(key);
        if (!cell) {
            cell = new Set();
            this.cells.set(key, cell);
        }
        cell.add(id);
    }

    private removeFromCell(key: TileKey, id: EntityID): void {
        const cell = this.cells.get(key);
        if (!cell) return;
        cell.delete(id);
        if (cell.size === 0) this.cells.delete(key);
    }
}
