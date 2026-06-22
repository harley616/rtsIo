import { ResourceType, GridLocation, BUILDING_FOOTPRINT } from "./types";

// ============================================================
// MapDefinition — the serializable description of a playable map.
//
// A Game is always built from one of these (see Game.fromMap). The procedural
// "random" map is just one producer of a MapDefinition (generateRandomMap),
// so user-authored maps and the legacy seed-based map share the exact same
// construction path. Keep this module Three.js-free and engine-side: it is
// pure data + the deterministic random generator.
// ============================================================

export const MAP_FORMAT_VERSION = 1;

// Half-extent of the playable area, in world/tile units. The legacy random
// map scattered resources across [-100, 100]; the editor uses the same bounds.
export const DEFAULT_MAP_BOUNDS = 100;

export interface MapResource {
    type: ResourceType;
    x: number;
    z: number;
    // Optional override of the per-type default node total (see createResource).
    amount?: number;
}

export interface MapDefinition {
    version: number;
    name: string;
    // spawns[i] is player (i + 1)'s starting townhall location. A playable map
    // needs at least 2.
    spawns: GridLocation[];
    resources: MapResource[];
}

export function emptyMap(name: string): MapDefinition {
    return {
        version: MAP_FORMAT_VERSION,
        name,
        spawns: [],
        resources: [],
    };
}

// Deterministic procedural map: the legacy makeTwoPlayerGame layout. Same seed
// → identical resource placement (seeded LCG, no Math.random), so this stays
// lockstep-safe and reproduces the pre-refactor game exactly.
export function generateRandomMap(seed: number): MapDefinition {
    let s = seed;
    const rand = () => {
        s = (s * 1664525 + 1013904223) & 0x7fffffff;
        return s / 0x7fffffff;
    };

    const resources: MapResource[] = [];
    const takenTiles = new Set<string>();
    const min = -DEFAULT_MAP_BOUNDS, max = DEFAULT_MAP_BOUNDS;

    for (let i = 0; i < 100; i++) {
        let x: number, z: number, key: string;
        do {
            x = Math.floor(rand() * (max - min)) + min;
            z = Math.floor(rand() * (max - min)) + min;
            key = `${x},${z}`;
        } while (takenTiles.has(key));
        takenTiles.add(key);

        const roll = rand();
        let type: ResourceType;
        if (roll < 0.3) type = "gold";
        else if (roll < 0.6) type = "stone";
        else type = "wood";
        resources.push({ type, x, z });
    }

    return {
        version: MAP_FORMAT_VERSION,
        name: "Random",
        spawns: [{ x: 0, z: 0 }, { x: 30, z: -30 }],
        resources,
    };
}

export interface MapValidation {
    ok: boolean;
    errors: string[];
}

// Structural + playability checks. Used by the editor (save) and the loader
// (so a corrupt/incompatible map can't blow up game construction).
export function validateMap(map: unknown): MapValidation {
    const errors: string[] = [];
    const m = map as Partial<MapDefinition> | null;

    if (!m || typeof m !== "object") {
        return { ok: false, errors: ["Not a map object"] };
    }
    if (m.version !== MAP_FORMAT_VERSION) {
        errors.push(`Unsupported map version ${m.version} (expected ${MAP_FORMAT_VERSION})`);
    }
    if (!Array.isArray(m.spawns) || m.spawns.length < 2) {
        errors.push("Map needs at least 2 spawn points");
    }
    if (!Array.isArray(m.resources)) {
        errors.push("Map is missing a resources list");
    }

    const inBounds = (x: number, z: number) =>
        x >= -DEFAULT_MAP_BOUNDS && x <= DEFAULT_MAP_BOUNDS &&
        z >= -DEFAULT_MAP_BOUNDS && z <= DEFAULT_MAP_BOUNDS;

    // Tile occupancy across both spawns (4x4 townhall footprints) and 1x1
    // resources — flag overlaps so an unplayable map can't be saved/loaded.
    const taken = new Set<string>();
    const claim = (x: number, z: number, label: string) => {
        const key = `${x},${z}`;
        if (taken.has(key)) errors.push(`Overlapping placement at (${x}, ${z}): ${label}`);
        taken.add(key);
    };

    if (Array.isArray(m.spawns)) {
        const fp = BUILDING_FOOTPRINT["townhall"];
        m.spawns.forEach((s, i) => {
            if (!inBounds(s.x, s.z)) errors.push(`Spawn ${i + 1} is out of bounds`);
            for (let dx = 0; dx < fp.width; dx++) {
                for (let dz = 0; dz < fp.height; dz++) {
                    claim(s.x + dx, s.z + dz, `spawn ${i + 1}`);
                }
            }
        });
    }
    if (Array.isArray(m.resources)) {
        m.resources.forEach((r, i) => {
            if (!inBounds(r.x, r.z)) errors.push(`Resource ${i + 1} is out of bounds`);
            claim(r.x, r.z, `${r.type} node`);
        });
    }

    return { ok: errors.length === 0, errors };
}
