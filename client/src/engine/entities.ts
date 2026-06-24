import { Vec3 } from "./vec3";
import {
    Fighter, Builder, Building, Resource,
    EntityID, GridLocation,
    BuildingType, ResourceType, Cost,
    BUILDER_MAX_HEALTH,
    BUILDING_HEALTH,
    BUILDING_FOOTPRINT,
    Movable,
    BUILDING_MAX_COOLDOWN,
} from "./types";
import { SpatialGrid, toTile, tileKey } from "./grid";
import { findPath } from "./pathfinding";

// --- Movement ---

// True if some entity other than `self` occupies tile (tx, tz).
function tileHasOtherUnit(grid: SpatialGrid, tx: number, tz: number, self: EntityID): boolean {
    const cell = grid.at(tx, tz);
    return cell !== undefined && Array.from(cell).some((id) => id !== self);
}

// Assign a movement goal and compute the static-obstacle route to it. Idempotent
// on the destination tile, so the AI can re-issue the same goal every tick
// without recomputing A*. Route around all static obstacles except the goal tile
// itself (the unit may be walking onto a resource/building it interacts with).
export function setMovableGoal(entity: Movable, goal: Vec3, grid: SpatialGrid): void {
    entity.goalPosition = goal.clone();
    const goalTile = toTile(goal.x, goal.z);
    const goalKey = tileKey(goalTile.tx, goalTile.tz);
    if (goalKey === entity.pathGoalKey) return; // same destination tile, keep path
    entity.pathGoalKey = goalKey;

    const start = toTile(entity.position.x, entity.position.z);
    const isBlocked = (tx: number, tz: number): boolean =>
        tx === goalTile.tx && tz === goalTile.tz ? false : grid.isStaticBlocked(tx, tz);

    const tiles = findPath({ x: start.tx, z: start.tz }, { x: goalTile.tx, z: goalTile.tz }, isBlocked);
    if (tiles === null) {
        entity.path = []; // unreachable — fall back to steering straight at the goal
        return;
    }
    // Intermediate waypoints ride tile centres for smooth routing; the last
    // becomes the exact goal so the unit stops precisely where commanded.
    const path = tiles.map((t) => new Vec3(t.x + 0.5, 0, t.z + 0.5));
    if (path.length > 0) path[path.length - 1] = goal.clone();
    entity.path = path;
}

export function updateMovable(entity: Movable, dt: number, grid: SpatialGrid): void {
    let distanceToMove = entity.speed * dt;

    // The destination tile (== path's last waypoint). Used to tell apart a unit
    // blocking the *way* (go around) from one sitting *on the destination* (stop).
    const goalTile = toTile(entity.goalPosition.x, entity.goalPosition.z);
    const goalHeldByOther =
        !grid.isStaticBlocked(goalTile.tx, goalTile.tz) &&
        tileHasOtherUnit(grid, goalTile.tx, goalTile.tz, entity.id);

    // Follow the waypoint path, then the exact goal, spending the tick's travel
    // budget across every waypoint reached so fast units don't stutter at corners.
    while (distanceToMove > 0) {
        // The current target is the goal once only it (or nothing) remains.
        const targetIsGoal = entity.path.length <= 1;
        const target = entity.path.length > 0 ? entity.path[0] : entity.goalPosition;
        const delta = target.subtract(entity.position);
        const dist = delta.length();

        if (dist <= distanceToMove) {
            // Don't snap onto a goal tile another unit holds — stop short and
            // wait (we'll resume if it moves) rather than overlap it.
            if (targetIsGoal && goalHeldByOther) break;
            entity.position = target.clone();
            if (targetIsGoal) {
                entity.path.length = 0; // arrived; drop any trailing waypoint
                break;
            }
            entity.path.shift();
            distanceToMove -= dist;
            continue;
        }

        let destPos = entity.position.add(delta.normalize().scale(distanceToMove));
        // Local avoidance for DYNAMIC blockers only (other units). Static
        // obstacles are already handled by the path; a static-blocked dest tile
        // is the goal tile we mean to walk onto, so never sidestep off it.
        const destTile = toTile(destPos.x, destPos.z);
        if (!grid.isStaticBlocked(destTile.tx, destTile.tz) && !(entity.unitType === 'builder') && tileHasOtherUnit(grid, destTile.tx, destTile.tz, entity.id)) {
            return
        }
        entity.position = destPos;
        break;
    }
}

// --- Factory functions ---

export function createFighter(id: EntityID, position: Vec3): Fighter {
    return {
        id,
        unitType: "knight",
        position: position.clone(),
        goalPosition: position.clone(),
        path: [],
        pathGoalKey: NaN,
        targetEntityId: -1,
        aggro: false,
        strength: 10,
        speed: 1,
        timeTillNextAttack: 0,
        areaOfAttack: 1,
        attackDelay: 1,
        maxHealth: 100,
        health: 100,
    };
}

export function createBuilder(id: EntityID, position: Vec3): Builder {
    return {
        id,
        unitType: "builder",
        position: position.clone(),
        goalPosition: position.clone(),
        path: [],
        pathGoalKey: NaN,
        speed: 1,
        gold: 0,
        stone: 0,
        wood: 0,
        aggro: false,
        health: BUILDER_MAX_HEALTH,
        maxHealth: BUILDER_MAX_HEALTH,
        resourceTarget: null,
        manualMove: false,
    };
}

export function createBuilding(id: EntityID, buildingType: BuildingType, position: GridLocation, cost: Cost): Building {
    return {
        id,
        buildingType,
        position: Vec3.fromGrid(position.x, position.z),
        cost,
        maxHealth: BUILDING_HEALTH[buildingType],
        health: BUILDING_HEALTH[buildingType],
        progress: 0,
        cooldown: 0,
        maxCooldown: BUILDING_MAX_COOLDOWN[buildingType],
    };
}

export function createResource(id: EntityID, resourceType: ResourceType, position: GridLocation, amount?: number): Resource {
    // Per-type defaults; `amount` (when given by a map definition) overrides them.
    const total = amount ?? (resourceType === "wood" ? 100 : 300);
    const amounts = { gold: 0, stone: 0, wood: 0 };
    amounts[resourceType] = total;

    return {
        id,
        resourceType,
        position: Vec3.fromGrid(position.x, position.z),
        ...amounts,
    };
}

export function resourceTotal(r: Resource): number {
    return r.gold + r.stone + r.wood;
}

export function buildingPosition(b: Building): Vec3 {
    return Vec3.fromGrid(b.position.x, b.position.z);
}

export function buildingSpawnPosition(b: Building): Vec3 {
    const footprint = BUILDING_FOOTPRINT[b.buildingType];
    return Vec3.fromGrid(b.position.x + 2 + footprint.width / 2, b.position.z + 2 + footprint.height / 2);
}

export function setHealth(entity: { health: number; maxHealth: number }, h: number): void {
    entity.health = Math.min(h, entity.maxHealth);
}
