import { Vec3 } from "./vec3";
import {
    EntityID, PlayerID, GridLocation,
    Player, Fighter, Builder, Building, Resource,
    Command, BuildingType, ResourceType,
    AGGRO_RADIUS, BUILDER_CARRYING_CAPACITY, BUILDER_REACH, BUILDER_MINE_SPEED,
    BUILDING_COSTS, BUILDING_FOOTPRINT, Cost,
} from "./types";
import {
    updateMovable, setMovableGoal, createFighter, createBuilder, createBuilding, createResource,
    resourceTotal, buildingPosition, setHealth,
    buildingSpawnPosition,
} from "./entities";
import { SpatialGrid, toTile } from "./grid";
import { MapDefinition, generateRandomMap } from "./map";

export class Game {
    elapsedTime = 0;
    deceased: EntityID[] = [];
    players: Map<PlayerID, Player> = new Map();
    resources: Map<EntityID, Resource> = new Map();
    // Derived spatial index over all entities; kept in sync with the per-player
    // Maps + resources below (which remain the source of truth). See grid.ts.
    grid: SpatialGrid = new SpatialGrid();
    private entityIDs: Set<EntityID> = new Set();
    private nextEntityCounter = 0;

    // --- Entity ID generation ---
    // Uses a counter instead of random for determinism (lockstep)
    newEntityID(): EntityID {
        while (this.entityIDs.has(this.nextEntityCounter)) {
            this.nextEntityCounter++;
        }
        const id = this.nextEntityCounter;
        this.entityIDs.add(id);
        this.nextEntityCounter++;
        return id;
    }

    // --- Initialization ---

    static makeTwoPlayerGame(seed?: number): Game {
        return Game.fromMap(generateRandomMap(seed ?? 42));
    }

    // Build a game from an explicit map definition. Entities are created in a
    // fixed order — players in spawn order, then resources in array order — so
    // identical map data yields identical entity IDs on every client (the
    // determinism the lockstep path will rely on).
    static fromMap(map: MapDefinition): Game {
        const game = new Game();
        map.spawns.forEach((loc, i) => game.createPlayer(i + 1, loc));
        for (const r of map.resources) {
            game.addResourceNode(r.type, r.x, r.z, r.amount);
        }
        return game;
    }

    createPlayer(id: PlayerID, townHallLoc: GridLocation): void {
        const townHallId = this.newEntityID();
        const townHall = createBuilding(townHallId, "townhall", townHallLoc, { gold: 0, stone: 0, wood: 0 });
        townHall.maxCooldown = 5;
        townHall.cooldown = 0;

        const buildings = new Map<EntityID, Building>();
        buildings.set(townHallId, townHall);
        const thFootprint = BUILDING_FOOTPRINT["townhall"];
        this.grid.insertArea(townHallId, townHallLoc.x, townHallLoc.z, thFootprint.width, thFootprint.height);

        const player: Player = {
            id,
            gold: 1000,
            stone: 1000,
            wood: 1000,
            primaryTownHall: townHallId,
            fighters: new Map(),
            builders: new Map(),
            buildings,
        };
        this.players.set(id, player);
    }

    // Place a single resource node and index it in the spatial grid. The atomic
    // building block both fromMap and any future in-game spawning go through.
    addResourceNode(type: ResourceType, x: number, z: number, amount?: number): void {
        const id = this.newEntityID();
        this.resources.set(id, createResource(id, type, { x, z }, amount));
        this.grid.insertStatic(id, x, z);
    }

    // --- Main update loop ---
    //
    update(dt: number): void {
        for (let i = 0; i < 5; i++) {
            this.elapsedTime += dt;

            for (const [pid, player] of this.players) {
                // Update fighters
                for (const [, fighter] of player.fighters) {
                    updateMovable(fighter, dt, this.grid);
                    this.grid.move(fighter.id, fighter.position.x, fighter.position.z);
                    if (fighter.targetEntityId !== -1) {
                        this.huntDown(fighter, dt);
                    } else {
                        const atGoal = fighter.position.subtract(fighter.goalPosition).length() === 0;
                        if (atGoal || fighter.aggro) {
                            this.generalAttack(fighter, pid, dt);
                        }
                    }
                }

                // Update builders
                for (const [, builder] of player.builders) {
                    updateMovable(builder, dt, this.grid);
                    this.grid.move(builder.id, builder.position.x, builder.position.z);
                    this.updateBuilder(builder, player, dt);
                }

                // Decrement building cooldowns
                for (const [, building] of player.buildings) {
                    if (building.cooldown > 0) {
                        building.cooldown -= dt;
                    }
                }
            }

            this.collectDeceased();
        }
    }

    async updateAsync(dt: number): Promise<void> {
        this.update(dt);
        await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // --- Builder AI ---

    private updateBuilder(builder: Builder, player: Player, dt: number): void {
        // Obeying a player move order: leave the goal alone until we arrive, then
        // hand control back to the auto-gather loop (resumes next tick).
        if (builder.manualMove) {
            if (builder.goalPosition.distanceTo(builder.position) < BUILDER_REACH) {
                builder.manualMove = false;
            }
            return;
        }

        const carrying = builder.gold + builder.wood + builder.stone;

        if (carrying >= BUILDER_CARRYING_CAPACITY) {
            // Go to townhall to deposit
            const townHall = player.buildings.get(player.primaryTownHall);
            if (!townHall) return;
            builder.resourceTarget = null;
            const thPos = buildingPosition(townHall);
            setMovableGoal(builder, thPos, this.grid);

            if (thPos.distanceTo(builder.position) < BUILDER_REACH) {
                player.gold += builder.gold;
                player.stone += builder.stone;
                player.wood += builder.wood;
                builder.gold = 0;
                builder.stone = 0;
                builder.wood = 0;
            }
        } else {
            // Keep mining the current resource until it's gone; only then look
            // for the nearest one (avoids re-searching and target flip-flop every tick).
            let resource = builder.resourceTarget !== null ? this.resources.get(builder.resourceTarget) : undefined;
            if (!resource || resourceTotal(resource) <= 0) {
                const [nearest] = this.getNearestResource(builder.position);
                if (!nearest) {
                    builder.resourceTarget = null;
                    return;
                }
                resource = nearest;
                builder.resourceTarget = nearest.id;
            }

            const targetPos = Vec3.fromGrid(resource.position.x, resource.position.z);
            setMovableGoal(builder, targetPos, this.grid);

            if (targetPos.distanceTo(builder.position) < BUILDER_REACH) {
                const available = resource.gold + resource.stone + resource.wood;
                const mined = Math.min(available, BUILDER_MINE_SPEED * dt);

                switch (resource.resourceType) {
                    case "gold":
                        builder.gold += mined;
                        resource.gold -= mined;
                        if (resource.gold <= 1) resource.gold = 0;
                        break;
                    case "stone":
                        builder.stone += mined;
                        resource.stone -= mined;
                        if (resource.stone <= 1) resource.stone = 0;
                        break;
                    case "wood":
                        builder.wood += mined;
                        resource.wood -= mined;
                        if (resource.wood <= 1) resource.wood = 0;
                        break;
                }
            }
        }
    }

    private getNearestResource(position: Vec3): [Resource | null, Vec3] {
        const id = this.grid.queryNearest(position.x, position.z, (eid) => {
            const resource = this.resources.get(eid);
            if (!resource || resourceTotal(resource) <= 0) return null;
            return resource.position;
        });
        if (id < 0) return [null, new Vec3()];
        const resource = this.resources.get(id)!;
        return [resource, Vec3.fromGrid(resource.position.x, resource.position.z)];
    }

    // --- Combat ---

    private getClosestEnemy(fighter: Fighter, playerId: PlayerID): EntityID {
        // Grid narrows candidates spatially; the per-player Maps answer whose
        // team an entity is on. Sorting candidates by id makes equal-distance
        // tie-breaks deterministic across clients.
        const candidates = this.grid.queryRadius(fighter.position.x, fighter.position.z, AGGRO_RADIUS);
        candidates.sort((a, b) => a - b);

        let closest: EntityID = -1;
        let closestDist = Infinity;

        for (const id of candidates) {
            const enemy = this.findOwnedEntity(id);
            if (!enemy || enemy.owner === playerId) continue;
            const dist = enemy.position.distanceTo(fighter.position);
            if (dist > AGGRO_RADIUS) continue; // box query overshoots the circle at corners
            if (closest < 0 || dist < closestDist) {
                closest = id;
                closestDist = dist;
            }
        }
        return closest;
    }

    // Resolves a candidate id to its owning player and world position, or null
    // if it isn't a player-owned entity (e.g. a resource node, which is never a
    // combat target).
    private findOwnedEntity(id: EntityID): { owner: PlayerID; position: Vec3 } | null {
        for (const [pid, player] of this.players) {
            const fighter = player.fighters.get(id);
            if (fighter) return { owner: pid, position: fighter.position };
            const builder = player.builders.get(id);
            if (builder) return { owner: pid, position: builder.position };
            const building = player.buildings.get(id);
            if (building) return { owner: pid, position: buildingPosition(building) };
        }
        return null;
    }

    private getKillable(id: EntityID): { getHealth(): number; setHealth(h: number): void; getPosition(): Vec3 } | null {
        for (const [, player] of this.players) {
            const fighter = player.fighters.get(id);
            if (fighter) return {
                getHealth() { return fighter.health; },
                setHealth(h: number) { setHealth(fighter, h); },
                getPosition() { return fighter.position; },
            };
            const builder = player.builders.get(id);
            if (builder) return {
                getHealth() { return builder.health; },
                setHealth(h: number) { setHealth(builder, h); },
                getPosition() { return builder.position; },
            };
            const building = player.buildings.get(id);
            if (building) return {
                getHealth() { return building.health; },
                setHealth(h: number) { setHealth(building, h); },
                getPosition() { return buildingPosition(building); },
            };
        }
        return null;
    }

    private huntDown(fighter: Fighter, dt: number): void {
        const target = this.getKillable(fighter.targetEntityId);
        if (!target) {
            fighter.targetEntityId = -1;
            return;
        }
        if (target.getHealth() <= 0) {
            fighter.targetEntityId = -1;
            return;
        }

        if (fighter.position.distanceTo(target.getPosition()) <= fighter.areaOfAttack) {
            if (fighter.timeTillNextAttack <= 0) {
                target.setHealth(target.getHealth() - fighter.strength);
                fighter.timeTillNextAttack = fighter.attackDelay;
                if (target.getHealth() <= 0) {
                    fighter.targetEntityId = -1;
                }
            }
        } else {
            setMovableGoal(fighter, target.getPosition().subtract(new Vec3(0.5, 0.5, 0.5)), this.grid);
        }
        fighter.timeTillNextAttack -= dt;
    }

    private generalAttack(fighter: Fighter, playerId: PlayerID, dt: number): void {
        const closestEnemy = this.getClosestEnemy(fighter, playerId);
        if (closestEnemy < 0) return;
        fighter.targetEntityId = closestEnemy;
        this.huntDown(fighter, dt);
    }

    // --- Deceased cleanup ---

    private collectDeceased(): void {
        this.deceased = [];

        for (const [, player] of this.players) {
            for (const [id, fighter] of player.fighters) {
                if (fighter.health <= 0) {
                    this.deceased.push(id);
                    this.deleteEntity(id);
                }
            }
            for (const [id, builder] of player.builders) {
                if (builder.health <= 0) {
                    this.deceased.push(id);
                    this.deleteEntity(id);
                }
            }
            for (const [id, building] of player.buildings) {
                if (building.health <= 0) {
                    this.deceased.push(id);
                    this.deleteEntity(id);
                }
            }
        }

        for (const [id, resource] of this.resources) {
            if (resourceTotal(resource) <= 1) {
                this.deceased.push(id);
                this.deleteEntity(id);
            }
        }
    }

    private deleteEntity(id: EntityID): void {
        this.entityIDs.delete(id);
        this.grid.remove(id);
        for (const [, player] of this.players) {
            player.fighters.delete(id);
            player.builders.delete(id);
            player.buildings.delete(id);
        }
        this.resources.delete(id);
    }

    // --- Command handling ---

    applyCommand(playerId: PlayerID, command: Command): void {
        const player = this.players.get(playerId);
        if (!player) return;

        switch (command.type) {
            case "moveUnit": {
                const movable = this.getMovable(command.entityId);
                if (!movable) return;
                setMovableGoal(movable, new Vec3(command.pos.x, command.pos.y, command.pos.z), this.grid);
                if (command.moveType === "aggressive") {
                    movable.aggro = true;
                } else {
                    movable.aggro = false;
                }
                // Clear target when given a new move order
                if ("targetEntityId" in movable) {
                    (movable as Fighter).targetEntityId = -1;
                }
                // Builders: suspend auto-gather until the commanded point is reached.
                if (movable.unitType === "builder") {
                    movable.resourceTarget = null;
                    movable.manualMove = true;
                }
                break;
            }
            case "placeBuilding": {
                this.placeBuilding(playerId, command.buildingType, command.pos);
                break;
            }
            case "createKnight": {
                this.spawnKnight(playerId);
                break;
            }
            case "createBuilder": {
                this.spawnBuilder(playerId);
                break;
            }
        }
    }

    private getMovable(id: EntityID): (Fighter | Builder) | null {
        for (const [, player] of this.players) {
            const fighter = player.fighters.get(id);
            if (fighter) return fighter;
            const builder = player.builders.get(id);
            if (builder) return builder;
        }
        return null;
    }

    private placeBuilding(playerId: PlayerID, type: BuildingType, pos: GridLocation): Building | null {
        const player = this.players.get(playerId);
        if (!player) return null;

        const cost = BUILDING_COSTS[type];
        if (!this.canAfford(player, cost)) return null;

        // Reject placement if any tile in the building's footprint is occupied.
        const footprint = BUILDING_FOOTPRINT[type];
        if (this.areaBlocked(pos.x, pos.z, footprint.width, footprint.height)) return null;

        player.gold -= cost.gold;
        player.stone -= cost.stone;
        player.wood -= cost.wood;

        const id = this.newEntityID();
        const building = createBuilding(id, type, pos, cost);
        player.buildings.set(id, building);
        this.grid.insertArea(id, pos.x, pos.z, footprint.width, footprint.height);
        return building;
    }

    // True if any tile in the [origin, origin+size) footprint is occupied.
    private areaBlocked(originX: number, originZ: number, width: number, height: number): boolean {
        const origin = toTile(originX, originZ);
        for (let dx = 0; dx < width; dx++) {
            for (let dz = 0; dz < height; dz++) {
                if (this.tileBlocked(origin.tx + dx, origin.tz + dz)) return true;
            }
        }
        return false;
    }

    // True if any entity occupies the tile. The single grid-backed predicate
    // for building placement, shared by both the engine (placeBuilding) and the
    // renderer's build-preview collision check so they can never disagree.
    tileBlocked(tx: number, tz: number): boolean {
        const cell = this.grid.at(tx, tz);
        if (!cell) return false;
        if (cell.size > 0) {
            console.log("cell", cell)
            return true;
        }

        return false;
    }

    private spawnKnight(playerId: PlayerID): Fighter | null {
        const player = this.players.get(playerId);
        if (!player) return null;

        // Find a barracks that's off cooldown
        let barracks: Building | null = null;
        for (const [, b] of player.buildings) {
            if (b.buildingType === "barracks" && b.cooldown <= 0) {
                barracks = b;
                break;
            }
        }
        if (!barracks) return null;

        const cost: Cost = { gold: 50, stone: 0, wood: 0 };
        if (!this.canAfford(player, cost)) return null;

        player.gold -= cost.gold;
        barracks.cooldown = barracks.maxCooldown;

        const id = this.newEntityID();
        const fighter = createFighter(id, buildingSpawnPosition(barracks));
        player.fighters.set(id, fighter);
        this.grid.insert(id, fighter.position.x, fighter.position.z);
        return fighter;
    }

    private spawnBuilder(playerId: PlayerID): Builder | null {
        const player = this.players.get(playerId);
        if (!player) return null;

        const townHall = player.buildings.get(player.primaryTownHall);
        if (!townHall) return null;

        const cost: Cost = { gold: 50, stone: 0, wood: 0 };
        if (!this.canAfford(player, cost)) return null;

        player.gold -= cost.gold;

        const id = this.newEntityID();
        const builder = createBuilder(id, buildingSpawnPosition(townHall));
        player.builders.set(id, builder);
        this.grid.insert(id, builder.position.x, builder.position.z);
        return builder;
    }

    private canAfford(player: Player, cost: Cost): boolean {
        return player.gold >= cost.gold && player.stone >= cost.stone && player.wood >= cost.wood;
    }
}
