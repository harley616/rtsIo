import { describe, it, expect } from "vitest";
import { createFighter, createBuilder, setMovableGoal, updateMovable } from "./entities";
import { SpatialGrid } from "./grid";
import { Vec3 } from "./vec3";

describe("setMovableGoal", () => {
    it("routes around a static obstacle, ending at the exact goal", () => {
        const grid = new SpatialGrid();
        grid.insertArea(1, 2, -2, 1, 5); // wall at x=2, z in [-2,2]
        const unit = createFighter(10, new Vec3(0, 0, 0));

        const goal = new Vec3(4, 0, 0);
        setMovableGoal(unit, goal, grid);

        expect(unit.path.length).toBeGreaterThan(0);
        expect(unit.path[unit.path.length - 1]).toEqual(goal); // exact goal last
        // No waypoint sits on the wall.
        for (const wp of unit.path) {
            expect(grid.isStaticBlocked(Math.floor(wp.x), Math.floor(wp.z))).toBe(false);
        }
    });

    it("is idempotent on the destination tile (same tile -> path untouched)", () => {
        const grid = new SpatialGrid();
        const unit = createFighter(10, new Vec3(0, 0, 0));

        setMovableGoal(unit, new Vec3(5, 0, 5), grid);
        const firstPath = unit.path;
        // Re-issue a goal in the SAME tile (5,5) but a different sub-tile point.
        setMovableGoal(unit, new Vec3(5.4, 0, 5.4), grid);

        expect(unit.path).toBe(firstPath); // not recomputed
        expect(unit.goalPosition).toEqual(new Vec3(5.4, 0, 5.4)); // precise goal still updated
    });

    it("recomputes when the destination tile changes", () => {
        const grid = new SpatialGrid();
        const unit = createFighter(10, new Vec3(0, 0, 0));
        setMovableGoal(unit, new Vec3(5, 0, 5), grid);
        const firstPath = unit.path;
        setMovableGoal(unit, new Vec3(8, 0, 8), grid);
        expect(unit.path).not.toBe(firstPath);
    });

    it("lets the route terminate on a static goal tile (e.g. a resource)", () => {
        const grid = new SpatialGrid();
        grid.insertStatic(1, 3, 0); // resource at tile (3,0)
        const unit = createBuilder(10, new Vec3(0, 0, 0));
        setMovableGoal(unit, Vec3.fromGrid(3, 0), grid);
        // A route exists and ends exactly on the resource, despite it being static.
        expect(unit.path.length).toBeGreaterThan(0);
        expect(unit.path[unit.path.length - 1]).toEqual(Vec3.fromGrid(3, 0));
    });
});

describe("updateMovable", () => {
    // Drive an entity to its goal over many small ticks.
    function run(unit: ReturnType<typeof createFighter>, grid: SpatialGrid, ticks = 200, dt = 0.1) {
        for (let i = 0; i < ticks; i++) {
            updateMovable(unit, dt, grid);
            grid.move(unit.id, unit.position.x, unit.position.z);
        }
    }

    it("follows a path around an obstacle and reaches the goal", () => {
        const grid = new SpatialGrid();
        grid.insertArea(1, 2, -2, 1, 5); // wall at x=2, z in [-2,2]
        const unit = createFighter(10, new Vec3(0, 0, 0));
        grid.insert(unit.id, 0, 0);

        const goal = new Vec3(4, 0, 0);
        setMovableGoal(unit, goal, grid);
        run(unit, grid);

        expect(unit.position.distanceTo(goal)).toBeLessThan(0.01);
    });

    it("does NOT sidestep off a static goal tile (so it can reach a resource)", () => {
        const grid = new SpatialGrid();
        grid.insertStatic(1, 3, 0); // resource occupies tile (3,0)
        const builder = createBuilder(10, new Vec3(0, 0, 0));
        grid.insert(builder.id, 0, 0);

        const goal = Vec3.fromGrid(3, 0);
        setMovableGoal(builder, goal, grid);
        for (let i = 0; i < 200; i++) {
            updateMovable(builder, 0.1, grid);
            grid.move(builder.id, builder.position.x, builder.position.z);
        }
        // Reaches the resource tile within mining reach rather than being pushed off.
        expect(builder.position.distanceTo(goal)).toBeLessThan(0.5);
    });

    it("settles next to a unit sitting on the destination instead of orbiting it", () => {
        const grid = new SpatialGrid();
        // A stationary blocker parked on the goal tile (5,0).
        const blocker = createFighter(1, Vec3.fromGrid(5, 0));
        grid.insert(blocker.id, blocker.position.x, blocker.position.z);

        const mover = createFighter(10, new Vec3(0, 0, 0));
        grid.insert(mover.id, 0, 0);
        setMovableGoal(mover, Vec3.fromGrid(5, 0), grid);

        // Run well past arrival, recording the tail of the trajectory.
        const tail: Vec3[] = [];
        for (let i = 0; i < 300; i++) {
            updateMovable(mover, 0.1, grid);
            grid.move(mover.id, mover.position.x, mover.position.z);
            if (i >= 290) tail.push(mover.position.clone());
        }

        // It got close to the blocker...
        expect(mover.position.distanceTo(Vec3.fromGrid(5, 0))).toBeLessThan(2);
        // ...did NOT land on top of it...
        expect(grid.isStaticBlocked(5, 0)).toBe(false); // (tile isn't static, just occupied)
        expect(mover.position).not.toEqual(Vec3.fromGrid(5, 0));
        // ...and came to rest (no perpetual orbiting): last frames are identical.
        for (const p of tail) expect(p).toEqual(tail[0]);
    });

    it("resumes onto the destination once the blocker moves away", () => {
        const grid = new SpatialGrid();
        const blocker = createFighter(1, Vec3.fromGrid(5, 0));
        grid.insert(blocker.id, blocker.position.x, blocker.position.z);
        const mover = createFighter(10, new Vec3(0, 0, 0));
        grid.insert(mover.id, 0, 0);
        setMovableGoal(mover, Vec3.fromGrid(5, 0), grid);

        for (let i = 0; i < 100; i++) {
            updateMovable(mover, 0.1, grid);
            grid.move(mover.id, mover.position.x, mover.position.z);
        }
        const parked = mover.position.distanceTo(Vec3.fromGrid(5, 0));
        expect(parked).toBeGreaterThan(0.01); // stopped short

        // Blocker leaves; mover should now reach the goal.
        grid.remove(blocker.id);
        for (let i = 0; i < 100; i++) {
            updateMovable(mover, 0.1, grid);
            grid.move(mover.id, mover.position.x, mover.position.z);
        }
        expect(mover.position.distanceTo(Vec3.fromGrid(5, 0))).toBeLessThan(0.01);
    });

    it("is deterministic: identical setups move identically", () => {
        const make = () => {
            const grid = new SpatialGrid();
            grid.insertArea(1, 2, -2, 1, 5);
            const unit = createFighter(10, new Vec3(0, 0, 0));
            grid.insert(unit.id, 0, 0);
            setMovableGoal(unit, new Vec3(4, 0, 0), grid);
            return { grid, unit };
        };
        const a = make();
        const b = make();
        for (let i = 0; i < 50; i++) {
            updateMovable(a.unit, 0.1, a.grid);
            a.grid.move(a.unit.id, a.unit.position.x, a.unit.position.z);
            updateMovable(b.unit, 0.1, b.grid);
            b.grid.move(b.unit.id, b.unit.position.x, b.unit.position.z);
        }
        expect(a.unit.position).toEqual(b.unit.position);
    });
});
