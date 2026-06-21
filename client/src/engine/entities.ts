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
import { SpatialGrid, toTile } from "./grid";

// --- Movement ---

function findClosestUnoccupiedPosition(entity: Movable, grid: SpatialGrid): Vec3 {
    const candidates = grid.findUnnocupiedTiles(entity.position.x, entity.position.z, 1);
    if (candidates.length === 0) {
        return entity.position.clone(); // No unoccupied tiles found, stay in place
    }
    let closest = candidates[0];
    let closestDist = entity.goalPosition.distanceTo(Vec3.fromGrid(closest.x, closest.z));
    for (const candidate of candidates) {
        const candidatePos = Vec3.fromGrid(candidate.x, candidate.z);
        const dist = entity.goalPosition.distanceTo(candidatePos);
        if (dist < closestDist) {
            closest = candidate;
            closestDist = dist;
        }
    }
    return Vec3.fromGrid(closest.x, closest.z);
}


export function updateMovable(entity: Movable, dt: number, grid: SpatialGrid): void {
    const speed = entity.speed;
    const distanceToMove = speed * dt;
    const delta = entity.goalPosition.subtract(entity.position);
    if (delta.length() <= distanceToMove) {
        entity.position = entity.goalPosition.clone();
    } else {
        let moveVector = delta.normalize().scale(distanceToMove);
        let destPos = entity.position.add(moveVector);
        const destTile = toTile(destPos.x, destPos.z);
        const destCell = grid.at(destTile.tx, destTile.tz);
        const filteredCell = destCell ? Array.from(destCell).filter(id => id !== entity.id) : [];
        if (filteredCell.length > 0) {
            const moveVector = findClosestUnoccupiedPosition(entity, grid).normalize().scale(distanceToMove);
            destPos = entity.position.add(moveVector);
        }
        entity.position = destPos;
    }
}

// --- Factory functions ---

export function createFighter(id: EntityID, position: Vec3): Fighter {
    return {
        id,
        unitType: "knight",
        position: position.clone(),
        goalPosition: position.clone(),
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
        speed: 1,
        gold: 0,
        stone: 0,
        wood: 0,
        aggro: false,
        health: BUILDER_MAX_HEALTH,
        maxHealth: BUILDER_MAX_HEALTH,
        resourceTarget: null,
    };
}

export function createBuilding(id: EntityID, buildingType: BuildingType, position: GridLocation, cost: Cost): Building {
    console.log(`Creating building ${id} of type ${buildingType} at position (${position.x}, ${position.z}) with cost: gold=${cost.gold}, stone=${cost.stone}, wood=${cost.wood}`);
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

export function createResource(id: EntityID, resourceType: ResourceType, position: GridLocation): Resource {
    const amounts = { gold: 0, stone: 0, wood: 0 };
    if (resourceType === "gold") amounts.gold = 300;
    else if (resourceType === "stone") amounts.stone = 300;
    else amounts.wood = 100;

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
