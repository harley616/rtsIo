import { MapDefinition, validateMap } from "../engine/map";

// ============================================================
// Local persistence + file import/export for user-built maps.
//
// Maps live in localStorage under a single namespaced key holding a
// { [name]: MapDefinition } record. The map's `name` is its identity/key, so
// saving under an existing name overwrites it.
// ============================================================

const STORE_KEY = "rtsio.maps";

type MapStore = Record<string, MapDefinition>;

function readStore(): MapStore {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed as MapStore : {};
    } catch {
        return {};
    }
}

function writeStore(store: MapStore): void {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/** Names of all saved maps, sorted alphabetically. */
export function listMaps(): string[] {
    return Object.keys(readStore()).sort();
}

/** Load a saved map by name, or null if absent / invalid. */
export function loadMap(name: string): MapDefinition | null {
    const map = readStore()[name];
    if (!map) return null;
    return validateMap(map).ok ? map : null;
}

/** Persist a map under its own name. Returns validation errors if rejected. */
export function saveMap(map: MapDefinition): { ok: boolean; errors: string[] } {
    const result = validateMap(map);
    if (!result.ok) return result;
    const store = readStore();
    store[map.name] = map;
    writeStore(store);
    return { ok: true, errors: [] };
}

export function deleteMap(name: string): void {
    const store = readStore();
    delete store[name];
    writeStore(store);
}

/** Trigger a browser download of the map as a .rtsmap.json file. */
export function exportMap(map: MapDefinition): void {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${map.name || "map"}.rtsmap.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/** Parse + validate an imported file's text into a MapDefinition. */
export function importMapFromText(text: string): { map?: MapDefinition; errors: string[] } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { errors: ["File is not valid JSON"] };
    }
    const result = validateMap(parsed);
    if (!result.ok) return { errors: result.errors };
    return { map: parsed as MapDefinition, errors: [] };
}
