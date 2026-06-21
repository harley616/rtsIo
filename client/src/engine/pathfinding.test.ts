import { describe, it, expect } from "vitest";
import { findPath } from "./pathfinding";
import { GridLocation } from "./types";
import { SpatialGrid } from "./grid";

// Build an isBlocked predicate from an explicit list of blocked tiles. Keeps the
// pathfinding tests independent of the grid so failures point at one layer.
function blockedBy(tiles: Array<[number, number]>): (tx: number, tz: number) => boolean {
    const set = new Set(tiles.map(([x, z]) => `${x},${z}`));
    return (tx, tz) => set.has(`${tx},${tz}`);
}

const open = () => false; // nothing blocked

describe("findPath", () => {
    it("returns [] when already at the goal", () => {
        expect(findPath({ x: 5, z: 5 }, { x: 5, z: 5 }, open)).toEqual([]);
    });

    it("excludes the start tile and includes the goal", () => {
        const path = findPath({ x: 0, z: 0 }, { x: 0, z: 3 }, open);
        expect(path).not.toBeNull();
        expect(path).not.toContainEqual({ x: 0, z: 0 });
        expect(path![path!.length - 1]).toEqual({ x: 0, z: 3 });
        expect(path!.length).toBe(3); // three orthogonal steps
    });

    it("is deterministic: identical inputs yield identical paths", () => {
        const blocked = blockedBy([[2, 0], [2, 1], [2, 2], [2, 3]]);
        const a = findPath({ x: 0, z: 1 }, { x: 4, z: 1 }, blocked);
        const b = findPath({ x: 0, z: 1 }, { x: 4, z: 1 }, blocked);
        expect(a).toEqual(b);
        expect(a).not.toBeNull();
    });

    it("returns null when the goal is walled off", () => {
        // Box the goal at (5,5) in on all 8 surrounding tiles.
        const wall: Array<[number, number]> = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                if (dx === 0 && dz === 0) continue;
                wall.push([5 + dx, 5 + dz]);
            }
        }
        expect(findPath({ x: 0, z: 0 }, { x: 5, z: 5 }, blockedBy(wall))).toBeNull();
    });

    it("takes the diagonal across open ground", () => {
        // Both orthogonals clear -> (0,0)->(1,1) is a single legal diagonal step.
        const path = findPath({ x: 0, z: 0 }, { x: 1, z: 1 }, open);
        expect(path).toEqual([{ x: 1, z: 1 }]);
    });

    it("refuses to cut a corner past even one blocked orthogonal", () => {
        // Strict no-corner-cutting: a diagonal needs BOTH shared orthogonals open,
        // so blocking just (1,0) already forbids stepping (0,0)->(1,1) — otherwise
        // the unit would clip that obstacle's corner. The detour must avoid it.
        const oneBlocked = findPath({ x: 0, z: 0 }, { x: 1, z: 1 }, blockedBy([[1, 0]]));
        expect(oneBlocked).not.toBeNull();
        expect(oneBlocked![0]).not.toEqual({ x: 1, z: 1 });

        // Both orthogonals blocked: still no corner cut.
        const bothBlocked = findPath({ x: 0, z: 0 }, { x: 1, z: 1 }, blockedBy([[1, 0], [0, 1]]));
        expect(bothBlocked).not.toBeNull();
        expect(bothBlocked![0]).not.toEqual({ x: 1, z: 1 });
    });

    it("routes around a wall rather than through it", () => {
        // Vertical wall at x=2 spanning z in [-2,2], with a gap at z=3 above it.
        const wall: Array<[number, number]> = [];
        for (let z = -2; z <= 2; z++) wall.push([2, z]);
        const path = findPath({ x: 0, z: 0 }, { x: 4, z: 0 }, blockedBy(wall));
        expect(path).not.toBeNull();
        // No waypoint may sit on a blocked tile.
        for (const p of path!) expect(wall).not.toContainEqual([p.x, p.z]);
        // The detour is strictly longer than the blocked straight-line distance.
        expect(path!.length).toBeGreaterThan(4);
    });

    it("reads obstacles from a real SpatialGrid via isStaticBlocked", () => {
        const grid = new SpatialGrid();
        // A 2x2 building footprint anchored at (2,-1), blocking x in {2,3}, z in {-1,0}.
        grid.insertArea(1, 2, -1, 2, 2);
        // A unit standing in the way must NOT block the route (dynamic, not static).
        grid.insert(99, 1, 0);

        const isBlocked = (tx: number, tz: number) => grid.isStaticBlocked(tx, tz);
        const path = findPath({ x: 0, z: 0 }, { x: 5, z: 0 }, isBlocked);
        expect(path).not.toBeNull();
        const blockedSteps = path!.filter((p: GridLocation) => grid.isStaticBlocked(p.x, p.z));
        expect(blockedSteps).toEqual([]);
        // The unit's tile (1,0) is allowed to appear — units don't block paths.
    });

    it("removing a static entity reopens its tiles", () => {
        const grid = new SpatialGrid();
        grid.insertArea(1, 2, -1, 2, 2);
        expect(grid.isStaticBlocked(2, 0)).toBe(true);
        grid.remove(1);
        expect(grid.isStaticBlocked(2, 0)).toBe(false);
    });
});
