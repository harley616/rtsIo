import { Vec3 } from "./vec3";
import {
    Fighter, Builder, Building, Resource,
    EntityID, PlayerID, GridLocation,
    BuildingType, ResourceType, Cost,
    BUILDER_SPEED, BUILDER_MAX_HEALTH,
    BUILDING_COSTS, BUILDING_HEALTH, BUILDING_MAX_COOLDOWN,
} from "./types";

// --- Movement ---

interface Movable {
    position: Vec3;
    goalPosition: Vec3;
}

function getSpeed(entity: Fighter | Builder): number {
    if (entity.unitType === "knight") return entity.speed;
    return BUILDER_SPEED;
}

export function updateMovable(entity: Fighter | Builder, dt: number): void {
    const speed = getSpeed(entity);
    const delta = entity.goalPosition.subtract(entity.position);
    const distanceToMove = speed * dt;
    if (delta.length() <= distanceToMove) {
        entity.position = entity.goalPosition.clone();
    } else {
        const moveVector = delta.normalize().scale(distanceToMove);
        entity.position = entity.position.add(moveVector);
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
    return {
        id,
        buildingType,
        position: { x: position.x, z: position.z },
        cost,
        maxHealth: BUILDING_HEALTH[buildingType],
        health: BUILDING_HEALTH[buildingType],
        progress: 0,
        cooldown: buildingType === "barracks" ? 10 : 0,
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
        position: { x: position.x, z: position.z },
        ...amounts,
    };
}

export function resourceTotal(r: Resource): number {
    return r.gold + r.stone + r.wood;
}

export function buildingPosition(b: Building): Vec3 {
    return Vec3.fromGrid(b.position.x, b.position.z);
}

export function setHealth(entity: { health: number; maxHealth: number }, h: number): void {
    entity.health = Math.min(h, entity.maxHealth);
}
