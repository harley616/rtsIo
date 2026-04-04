import { Vec3 } from "./vec3";

export type EntityID = number;
export type PlayerID = number;

export interface GridLocation {
    x: number;
    z: number;
}

// --- Constants ---

export const AGGRO_RADIUS = 10;
export const BUILDER_SPEED = 1;
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
    house:    { gold: 100, stone: 0,   wood: 50  },
    townhall: { gold: 500, stone: 400, wood: 200 },
    barracks: { gold: 100, stone: 100, wood: 50  },
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

// --- Entity interfaces ---

export interface Fighter {
    id: EntityID;
    unitType: "knight";
    position: Vec3;
    goalPosition: Vec3;
    targetEntityId: EntityID; // -1 if none
    aggro: boolean;
    strength: number;
    speed: number;
    timeTillNextAttack: number;
    areaOfAttack: number;
    attackDelay: number;
    maxHealth: number;
    health: number;
}

export interface Builder {
    id: EntityID;
    unitType: "builder";
    position: Vec3;
    goalPosition: Vec3;
    gold: number;
    stone: number;
    wood: number;
    aggro: boolean;
    health: number;
    maxHealth: number;
    resourceTarget: EntityID | null; // ID of targeted resource, null if none
}

export interface Building {
    id: EntityID;
    buildingType: BuildingType;
    position: GridLocation;
    cost: Cost;
    maxHealth: number;
    health: number;
    progress: number;
    cooldown: number;
    maxCooldown: number;
}

export interface Resource {
    id: EntityID;
    resourceType: ResourceType;
    position: GridLocation;
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

// --- Commands ---

export interface MoveUnitCommand {
    type: "moveUnit";
    entityId: EntityID;
    pos: { x: number; y: number; z: number };
    moveType: "passive" | "aggressive";
}

export interface PlaceBuildingCommand {
    type: "placeBuilding";
    buildingType: BuildingType;
    pos: GridLocation;
}

export interface CreateKnightCommand {
    type: "createKnight";
}

export interface CreateBuilderCommand {
    type: "createBuilder";
}

export type Command = MoveUnitCommand | PlaceBuildingCommand | CreateKnightCommand | CreateBuilderCommand;
