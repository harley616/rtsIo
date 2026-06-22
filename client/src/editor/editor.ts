import { Scene, EditTool } from "../scene"
import { loadModels } from "../loadModels"
import { Game } from "../engine/game"
import { MapDefinition, emptyMap, validateMap, DEFAULT_MAP_BOUNDS } from "../engine/map"
import { BUILDING_FOOTPRINT } from "../engine/types"
import {
	listMaps, loadMap, saveMap, deleteMap, exportMap, importMapFromText,
} from "./storage"

const TOWNHALL_FP = BUILDING_FOOTPRINT["townhall"]

// The map being edited (authoritative). Rendering is derived from it: after
// every mutation we tear down the rendered scene and rebuild it from a fresh
// Game.fromMap(map) — cheap at human edit speed and guarantees what you see is
// exactly what the map produces in-game.
let map: MapDefinition = emptyMap("Untitled")
let scene: Scene

init()

async function init() {
	const models = await loadModels()
	scene = new Scene("threejs-container", models, () => { })
	scene.playerId = 1
	scene.editMode = true
	scene.editTool = "gold"
	scene.onEditPlace = handlePlace
	scene.startAnimationLoop()

	render()
	wireToolbar()
	wireFileActions()
	wireInput()
	refreshMapList()
	refreshStatus()
}

// --- Rendering ---

function render() {
	scene.resetEntities()
	scene.syncFromEngine(Game.fromMap(map))
}

// --- Placement / erase ---

function handlePlace(tx: number, tz: number, button: number) {
	// Right-click always erases, regardless of the selected tool.
	if (scene.editTool === "erase" || button === 2) {
		eraseAt(tx, tz)
	} else if (scene.editTool === "spawn1") {
		placeSpawn(0, tx, tz)
	} else if (scene.editTool === "spawn2") {
		placeSpawn(1, tx, tz)
	} else {
		placeResource(scene.editTool, tx, tz)
	}
	render()
	refreshStatus()
}

function tileKey(x: number, z: number): string {
	return `${x},${z}`
}

function inBoundsTile(x: number, z: number): boolean {
	return x >= -DEFAULT_MAP_BOUNDS && x <= DEFAULT_MAP_BOUNDS &&
		z >= -DEFAULT_MAP_BOUNDS && z <= DEFAULT_MAP_BOUNDS
}

// Tiles currently occupied by spawns (4x4) and resources (1x1). `excludeSpawn`
// lets a spawn move onto tiles it already owns when being repositioned.
function occupiedTiles(excludeSpawn?: number): Set<string> {
	const occ = new Set<string>()
	map.spawns.forEach((s, i) => {
		if (i === excludeSpawn) return
		for (let dx = 0; dx < TOWNHALL_FP.width; dx++) {
			for (let dz = 0; dz < TOWNHALL_FP.height; dz++) {
				occ.add(tileKey(s.x + dx, s.z + dz))
			}
		}
	})
	for (const r of map.resources) occ.add(tileKey(r.x, r.z))
	return occ
}

function placeResource(type: "gold" | "stone" | "wood", tx: number, tz: number) {
	if (!inBoundsTile(tx, tz)) return setStatus("Out of bounds", true)
	if (occupiedTiles().has(tileKey(tx, tz))) return setStatus("Tile is occupied", true)
	map.resources.push({ type, x: tx, z: tz })
}

function placeSpawn(index: number, tx: number, tz: number) {
	// Player 2's start can only be placed once Player 1's exists (keeps the
	// spawns array dense and the player→index mapping unambiguous).
	if (index === 1 && map.spawns.length === 0) {
		return setStatus("Place Player 1's start first", true)
	}
	if (!inBoundsTile(tx, tz) || !inBoundsTile(tx + TOWNHALL_FP.width - 1, tz + TOWNHALL_FP.height - 1)) {
		return setStatus("Start location is out of bounds", true)
	}
	const occ = occupiedTiles(index)
	for (let dx = 0; dx < TOWNHALL_FP.width; dx++) {
		for (let dz = 0; dz < TOWNHALL_FP.height; dz++) {
			if (occ.has(tileKey(tx + dx, tz + dz))) return setStatus("Start location overlaps something", true)
		}
	}
	if (index < map.spawns.length) map.spawns[index] = { x: tx, z: tz }
	else map.spawns.push({ x: tx, z: tz })
}

function eraseAt(tx: number, tz: number) {
	const ri = map.resources.findIndex((r) => r.x === tx && r.z === tz)
	if (ri >= 0) {
		map.resources.splice(ri, 1)
		return
	}
	const si = map.spawns.findIndex(
		(s) => tx >= s.x && tx < s.x + TOWNHALL_FP.width && tz >= s.z && tz < s.z + TOWNHALL_FP.height
	)
	if (si >= 0) map.spawns.splice(si, 1)
}

// --- Toolbar ---

function wireToolbar() {
	const tools: Record<string, EditTool> = {
		"tool-gold": "gold",
		"tool-stone": "stone",
		"tool-wood": "wood",
		"tool-spawn1": "spawn1",
		"tool-spawn2": "spawn2",
		"tool-erase": "erase",
	}
	for (const [id, tool] of Object.entries(tools)) {
		document.getElementById(id)?.addEventListener("click", () => setTool(tool))
	}
	setTool("gold")
}

function setTool(tool: EditTool) {
	scene.editTool = tool
	for (const el of Array.from(document.querySelectorAll(".tool-btn"))) {
		el.classList.toggle("active", el.id === `tool-${tool}`)
	}
}

// --- File / persistence actions ---

function wireFileActions() {
	const nameInput = document.getElementById("map-name") as HTMLInputElement
	nameInput.value = map.name

	document.getElementById("btn-save")?.addEventListener("click", () => {
		map.name = (nameInput.value || "Untitled").trim()
		const result = saveMap(map)
		if (!result.ok) {
			setStatus("Can't save: " + result.errors.join("; "), true)
			return
		}
		setStatus(`Saved "${map.name}"`)
		refreshMapList()
	})

	document.getElementById("btn-new")?.addEventListener("click", () => {
		map = emptyMap("Untitled")
		nameInput.value = map.name
		render()
		refreshStatus()
		setStatus("New map")
	})

	document.getElementById("btn-export")?.addEventListener("click", () => {
		map.name = (nameInput.value || "Untitled").trim()
		exportMap(map)
	})

	const fileInput = document.getElementById("import-file") as HTMLInputElement
	document.getElementById("btn-import")?.addEventListener("click", () => fileInput.click())
	fileInput.addEventListener("change", async () => {
		const file = fileInput.files?.[0]
		if (!file) return
		const { map: imported, errors } = importMapFromText(await file.text())
		fileInput.value = ""
		if (!imported) {
			setStatus("Import failed: " + errors.join("; "), true)
			return
		}
		map = imported
		nameInput.value = map.name
		render()
		refreshStatus()
		setStatus(`Imported "${map.name}"`)
	})

	document.getElementById("btn-load")?.addEventListener("click", () => {
		const select = document.getElementById("map-list") as HTMLSelectElement
		const name = select.value
		if (!name) return
		const loaded = loadMap(name)
		if (!loaded) {
			setStatus("Could not load map", true)
			return
		}
		map = loaded
		nameInput.value = map.name
		render()
		refreshStatus()
		setStatus(`Loaded "${map.name}"`)
	})

	document.getElementById("btn-delete")?.addEventListener("click", () => {
		const select = document.getElementById("map-list") as HTMLSelectElement
		const name = select.value
		if (!name) return
		deleteMap(name)
		refreshMapList()
		setStatus(`Deleted "${name}"`)
	})

	document.getElementById("btn-playtest")?.addEventListener("click", () => {
		map.name = (nameInput.value || "Untitled").trim()
		const result = saveMap(map)
		if (!result.ok) {
			setStatus("Can't play: " + result.errors.join("; "), true)
			return
		}
		window.location.href = `/play/?map=${encodeURIComponent(map.name)}`
	})

	document.getElementById("btn-lobby")?.addEventListener("click", () => {
		window.location.href = "/"
	})
}

function refreshMapList() {
	const select = document.getElementById("map-list") as HTMLSelectElement
	const names = listMaps()
	select.innerHTML = ""
	if (names.length === 0) {
		const opt = document.createElement("option")
		opt.textContent = "(no saved maps)"
		opt.value = ""
		select.appendChild(opt)
		return
	}
	for (const name of names) {
		const opt = document.createElement("option")
		opt.textContent = name
		opt.value = name
		select.appendChild(opt)
	}
}

// --- Status line ---

function refreshStatus() {
	const result = validateMap(map)
	const summary = `Spawns: ${map.spawns.length}/2 · Resources: ${map.resources.length}`
	const valid = result.ok ? "✓ playable" : `⚠ ${result.errors[0]}`
	setStatus(`${summary} — ${valid}`, !result.ok)
}

function setStatus(message: string, warn = false) {
	const el = document.getElementById("editor-status")
	if (!el) return
	el.textContent = message
	el.style.color = warn ? "#ff8866" : "#eed7a1"
}

// --- Camera input (mirrors the in-game controls in index.ts) ---

function wireInput() {
	window.addEventListener("mousemove", (event) => {
		scene.mouseX = (event.clientX / window.innerWidth) * 2 - 1
		scene.mouseY = -(event.clientY / window.innerHeight) * 2 + 1
	})

	window.addEventListener("keydown", (event) => {
		scene.keysPressed[event.key] = true
	})

	window.addEventListener("keyup", (event) => {
		scene.keysPressed[event.key] = false
	})

	window.addEventListener(
		"wheel",
		(event) => {
			const minZoom = 0.5
			const maxZoom = 3.0
			const zoomSensitivity = 0.001
			event.preventDefault()
			scene.zoom += event.deltaY * zoomSensitivity
			scene.zoom = Math.min(maxZoom, Math.max(minZoom, scene.zoom))
			scene.updateCamera()
		},
		{ passive: false }
	)

	window.addEventListener("contextmenu", (event) => {
		event.preventDefault()
	})
}
