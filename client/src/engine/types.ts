import { Vec3 } from "./vec3";

export type EntityID = number;
export type PlayerID = number;

export interface GridLocation {
    x: number;
    z: number;
}

// --- Constants ---

export const AGGRO_RADIUS = 10;
export const BUILDER_MAX_HEALTH = 100;
export const BUILDER_CARRYING_CAPACITY = 20;
export const BUILDER_REACH = 0.5;
export const BUILDER_MINE_SPEED = 1;

export interface Cost {
    gold: number;
    stone: number;
    wood: number;
}

export type BuildingType = "house" | "townhall" | "barracks";
export type ResourceType = "gold" | "stone" | "wood";
export type UnitType = "knight" | "builder";

export const BUILDING_COSTS: Record<BuildingType, Cost> = {
    house: { gold: 100, stone: 0, wood: 50 },
    townhall: { gold: 500, stone: 400, wood: 200 },
    barracks: { gold: 100, stone: 100, wood: 50 },
};

export const BUILDING_HEALTH: Record<BuildingType, number> = {
    house: 500,
    townhall: 1000,
    barracks: 500,
};

export const BUILDING_MAX_COOLDOWN: Record<BuildingType, number> = {
    house: 10,
    townhall: 5,
    barracks: 10,
};

export interface Footprint {
    width: number;
    height: number;
}

// Tile footprint each building occupies, anchored at its `position` and
// extending toward +x/+z. Source of truth for occupancy/collision; the
// renderer's Building view mirrors these dimensions. Resources are 1x1.
export const BUILDING_FOOTPRINT: Record<BuildingType, Footprint> = {
    house: { width: 2, height: 2 },
    townhall: { width: 4, height: 4 },
    barracks: { width: 4, height: 4 },
};

export const RESOURCE_FOOTPRINT: Record<ResourceType, Footprint> = {
    gold: { width: 1, height: 1 },
    stone: { width: 1, height: 1 },
    wood: { width: 1, height: 1 },
};

export interface Entity {
    id: EntityID;
    position: Vec3;
}


export interface Movable extends Entity {
    goalPosition: Vec3;
    speed: number;
    // Precomputed waypoint route to goalPosition, around static obstacles
    // (see pathfinding.ts). Consumed front-to-back by updateMovable; empty
    // means "steer straight at the goal". Final waypoint is the exact goal.
    path: Vec3[];
    // Tile key the current `path` was computed for. Lets setMovableGoal skip
    // recomputing A* when the goal tile hasn't changed (NaN = force recompute).
    pathGoalKey: number;
}


// --- Entity interfaces ---

export interface Fighter extends Movable {
    unitType: "knight";
    targetEntityId: EntityID; // -1 if none
    aggro: boolean;
    strength: number;
    timeTillNextAttack: number;
    areaOfAttack: number;
    attackDelay: number;
    maxHealth: number;
    health: number;
}

export interface Builder extends Movable {
    unitType: "builder";
    gold: number;
    stone: number;
    wood: number;
    aggro: boolean;
    health: number;
    maxHealth: number;
    resourceTarget: EntityID | null; // ID of targeted resource, null if none
    // True while obeying a player move order: the auto-gather AI is suspended
    // (won't reassign goalPosition) until the builder reaches the commanded
    // point, then it flips back to false and gathering resumes.
    manualMove: boolean;
}

export interface Building extends Entity {
    buildingType: BuildingType;
    cost: Cost;
    maxHealth: number;
    health: number;
    progress: number;
    cooldown: number;
    maxCooldown: number;
}

export interface Resource extends Entity {
    resourceType: ResourceType;
    gold: number;
    stone: number;
    wood: number;
}

export interface Player {
    id: PlayerID;
    gold: number;
    stone: number;
    wood: number;
    primaryTownHall: EntityID;
    fighters: Map<EntityID, Fighter>;
    builders: Map<EntityID, Builder>;
    buildings: Map<EntityID, Building>;
}

// --- Commands (re-exported from shared protocol) ---

export type {
    Command, MoveUnitCommand, PlaceBuildingCommand,
    CreateKnightCommand, CreateBuilderCommand,
} from "../../../shared/protocol";
