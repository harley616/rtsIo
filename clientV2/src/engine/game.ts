import { Vec3 } from "./vec3";
import {
    EntityID, PlayerID, GridLocation,
    Player, Fighter, Builder, Building, Resource,
    Command, BuildingType,
    AGGRO_RADIUS, BUILDER_CARRYING_CAPACITY, BUILDER_REACH, BUILDER_MINE_SPEED,
    BUILDING_COSTS, Cost,
} from "./types";
import {
    updateMovable, createFighter, createBuilder, createBuilding, createResource,
    resourceTotal, buildingPosition, setHealth,
} from "./entities";

export class Game {
    elapsedTime = 0;
    deceased: EntityID[] = [];
    players: Map<PlayerID, Player> = new Map();
    resources: Map<EntityID, Resource> = new Map();
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
        const game = new Game();

        // Create players with townhalls
        game.createPlayer(1, { x: 0, z: 0 });
        game.createPlayer(2, { x: 30, z: -30 });

        // Add resources (deterministic with seeded RNG)
        game.addResources(100, seed ?? 42);

        return game;
    }

    createPlayer(id: PlayerID, townHallLoc: GridLocation): void {
        const townHallId = this.newEntityID();
        const townHall = createBuilding(townHallId, "townhall", townHallLoc, { gold: 0, stone: 0, wood: 0 });
        townHall.maxCooldown = 5;
        townHall.cooldown = 0;

        const buildings = new Map<EntityID, Building>();
        buildings.set(townHallId, townHall);

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

    addResources(n: number, seed: number): void {
        // Simple seeded PRNG for determinism
        let s = seed;
        const rand = () => {
            s = (s * 1664525 + 1013904223) & 0x7fffffff;
            return s / 0x7fffffff;
        };

        const takenTiles = new Set<string>();
        const minX = -100, maxX = 100;
        const minZ = -100, maxZ = 100;

        for (let i = 0; i < n; i++) {
            let x: number, z: number, key: string;
            do {
                x = Math.floor(rand() * (maxX - minX)) + minX;
                z = Math.floor(rand() * (maxZ - minZ)) + minZ;
                key = `${x},${z}`;
            } while (takenTiles.has(key));
            takenTiles.add(key);

            const roll = rand();
            const id = this.newEntityID();
            if (roll < 0.3) {
                this.resources.set(id, createResource(id, "gold", { x, z }));
            } else if (roll < 0.6) {
                this.resources.set(id, createResource(id, "stone", { x, z }));
            } else {
                this.resources.set(id, createResource(id, "wood", { x, z }));
            }
        }
    }

    // --- Main update loop ---

    update(dt: number): void {
        this.elapsedTime += dt;

        for (const [pid, player] of this.players) {
            // Update fighters
            for (const [, fighter] of player.fighters) {
                updateMovable(fighter, dt);
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
                updateMovable(builder, dt);
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

    // --- Builder AI ---

    private updateBuilder(builder: Builder, player: Player, dt: number): void {
        const carrying = builder.gold + builder.wood + builder.stone;

        if (carrying >= BUILDER_CARRYING_CAPACITY) {
            // Go to townhall to deposit
            const townHall = player.buildings.get(player.primaryTownHall);
            if (!townHall) return;
            const thPos = buildingPosition(townHall);
            builder.goalPosition = thPos;

            if (thPos.distanceTo(builder.position) < BUILDER_REACH) {
                player.gold += builder.gold;
                player.stone += builder.stone;
                player.wood += builder.wood;
                builder.gold = 0;
                builder.stone = 0;
                builder.wood = 0;
            }
        } else {
            // Find nearest resource and mine
            const [resource, targetPos] = this.getNearestResource(builder.position);
            if (!resource) return;

            builder.resourceTarget = resource.id;
            builder.goalPosition = targetPos;

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
        let minDistance = Infinity;
        let nearest: Resource | null = null;
        let nearestPos = new Vec3();

        for (const [, resource] of this.resources) {
            if (resourceTotal(resource) <= 0) continue;
            const rPos = Vec3.fromGrid(resource.position.x, resource.position.z);
            const dist = rPos.distanceTo(position);
            if (dist < minDistance) {
                minDistance = dist;
                nearest = resource;
                nearestPos = rPos;
            }
        }
        return [nearest, nearestPos];
    }

    // --- Combat ---

    private getClosestEnemy(fighter: Fighter, playerId: PlayerID): EntityID {
        let closest: EntityID = -1;
        let closestDist = Infinity;

        for (const [pid, player] of this.players) {
            if (pid === playerId) continue;

            for (const [, enemy] of player.fighters) {
                const dist = enemy.position.distanceTo(fighter.position);
                if (dist > AGGRO_RADIUS) continue;
                if (closest < 0 || dist < closestDist) {
                    closest = enemy.id;
                    closestDist = dist;
                }
            }
            for (const [, enemy] of player.builders) {
                const dist = enemy.position.distanceTo(fighter.position);
                if (dist > AGGRO_RADIUS) continue;
                if (closest < 0 || dist < closestDist) {
                    closest = enemy.id;
                    closestDist = dist;
                }
            }
            for (const [, enemy] of player.buildings) {
                const dist = buildingPosition(enemy).distanceTo(fighter.position);
                if (dist > AGGRO_RADIUS) continue;
                if (closest < 0 || dist < closestDist) {
                    closest = enemy.id;
                    closestDist = dist;
                }
            }
        }
        return closest;
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
            fighter.goalPosition = target.getPosition().subtract(new Vec3(0.5, 0.5, 0.5));
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
                movable.goalPosition = new Vec3(command.pos.x, command.pos.y, command.pos.z);
                if (command.moveType === "aggressive") {
                    movable.aggro = true;
                } else {
                    movable.aggro = false;
                }
                // Clear target when given a new move order
                if ("targetEntityId" in movable) {
                    (movable as Fighter).targetEntityId = -1;
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

        player.gold -= cost.gold;
        player.stone -= cost.stone;
        player.wood -= cost.wood;

        const id = this.newEntityID();
        const building = createBuilding(id, type, pos, cost);
        player.buildings.set(id, building);
        return building;
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
        const fighter = createFighter(id, buildingPosition(barracks));
        player.fighters.set(id, fighter);
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
        const builder = createBuilder(id, buildingPosition(townHall));
        player.builders.set(id, builder);
        return builder;
    }

    private canAfford(player: Player, cost: Cost): boolean {
        return player.gold >= cost.gold && player.stone >= cost.stone && player.wood >= cost.wood;
    }
}
