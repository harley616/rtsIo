import { Scene } from "./scene"
import { Game } from "./engine/game"
import { Command } from "./engine/types"
import { LockstepManager } from "./engine/lockstep"
import { loadModels } from "./loadModels"
import { loadMap } from "./editor/storage"

const TICK_MS = parseInt(import.meta.env.VITE_TICK_MS)
const DT = parseFloat(import.meta.env.VITE_DT)
const RELAY_URL = import.meta.env.VITE_RELAY_URL

let tick = 0

InitScene()

async function InitScene() {
	const models = await loadModels()
	const params = new URLSearchParams(window.location.search)
	const mode = params.get("mode") // "multiplayer" or null (offline)
	const gameCode = params.get("code")
	const playerParam = params.get("player") // "1" or "2"

	// Shared sendCommand — wired to either local queue or lockstep
	let sendCommand: (cmd: Command) => void

	const scene = new Scene("threejs-container", models, (cmd) => sendCommand(cmd))
	scene.startAnimationLoop()

	const playerNumElem = document.getElementById("player-number")
	const goldDisplay = document.getElementById("gold")
	const woodDisplay = document.getElementById("wood")
	const stoneDisplay = document.getElementById("stone")
	const statusElem = document.getElementById("player-label")

	function updateResourceDisplay(game: Game, playerId: number) {
		const player = game.players.get(playerId)
		if (player) {
			if (goldDisplay) goldDisplay.innerText = `${Math.floor(player.gold)}`
			if (stoneDisplay) stoneDisplay.innerText = `${Math.floor(player.stone)}`
			if (woodDisplay) woodDisplay.innerText = `${Math.floor(player.wood)}`
		}
	}

	if (mode === "multiplayer" && gameCode && playerParam) {
		// --- Multiplayer (lockstep) ---
		const myPlayerId = parseInt(playerParam)

		const lockstep = new LockstepManager({
			onStateChange: (state) => {
				if (statusElem) {
					switch (state) {
						case "connecting":
							statusElem.textContent = "Reconnecting..."
							break
						case "waiting":
							statusElem.textContent = "Waiting for opponent..."
							break
						case "playing":
							statusElem.innerHTML = `Player <span id="player-number">${myPlayerId}</span>`
							scene.playerId = myPlayerId
							const game = lockstep.getGame()
							if (game) {
								const playerTownHall = game.players.get(myPlayerId)?.buildings.get(game.players.get(myPlayerId)?.primaryTownHall ?? -1)
								scene.camera.position.set((playerTownHall?.position.x ?? 0) + 50, 50, (playerTownHall?.position.z ?? 0) + 50)
								scene.camera.lookAt(playerTownHall?.position.x ?? 0, 0, playerTownHall?.position.z ?? 0)
							}

							break
						case "disconnected":
							statusElem.textContent = "Disconnected"
							break
					}
				}
			},
			onGameCreated: () => { },
			onTurnApplied: (game) => {
				scene.syncFromEngine(game)
				updateResourceDisplay(game, myPlayerId)
			},
		})

		sendCommand = (cmd) => lockstep.sendCommand(cmd)
		scene.playerId = myPlayerId
		if (playerNumElem) playerNumElem.innerText = `${myPlayerId}`

		lockstep.reconnectGame(RELAY_URL, gameCode, myPlayerId)

		// Signal ready once assets are loaded (loadModels already awaited above)
		// Need to wait for the websocket to open before sending
		const waitForLoaded = setInterval(() => {
			if (lockstep.getState() !== "connecting") {
				lockstep.sendLoaded()
				clearInterval(waitForLoaded)
			}
		}, 50)
	} else {
		// --- Offline single-player ---
		const pendingCommands: Command[] = []
		sendCommand = (cmd) => pendingCommands.push(cmd)

		// A user-built map can be requested with ?map=<storage key>; fall back to
		// the procedural map if it's missing or fails validation.
		const mapKey = params.get("map")
		const savedMap = mapKey ? loadMap(mapKey) : null
		const game = savedMap ? Game.fromMap(savedMap) : Game.makeTwoPlayerGame()
		scene.playerId = 1
		if (playerNumElem) playerNumElem.innerText = "1"

		// Center the camera on player 1's starting townhall.
		const startTownHall = game.players.get(1)?.buildings.get(game.players.get(1)?.primaryTownHall ?? -1)
		if (startTownHall) {
			scene.camera.position.set(startTownHall.position.x + 50, 50, startTownHall.position.z + 50)
			scene.camera.lookAt(startTownHall.position.x, 0, startTownHall.position.z)
		}

		setInterval(async () => {
			if (tick % 2 === 0) {
				game.update(DT)
				while (pendingCommands.length > 0) {
					game.applyCommand(scene.playerId, pendingCommands.shift()!)
				}
				scene.syncFromEngine(game)
				updateResourceDisplay(game, scene.playerId)
			}
			else {
				game.update(DT)
			}
			tick++
		}, 5)
	}

	// --- UI Button handlers ---

	document.getElementById("addHouse")?.addEventListener("click", () => {
		scene.isBuilding = true
		scene.currentBuildingType = "house"
	})

	document.getElementById("addTownHall")?.addEventListener("click", () => {
		scene.isBuilding = true
		scene.currentBuildingType = "townhall"
	})

	document.getElementById("addBarracks")?.addEventListener("click", () => {
		scene.isBuilding = true
		scene.currentBuildingType = "barracks"
	})

	document.getElementById("addKnight")?.addEventListener("click", () => {
		sendCommand({ type: "createKnight" })
	})

	document.getElementById("addWorker")?.addEventListener("click", () => {
		sendCommand({ type: "createBuilder" })
	})

	// --- Input handlers ---

	window.addEventListener("mousemove", (event) => {
		scene.mouseX = (event.clientX / window.innerWidth) * 2 - 1
		scene.mouseY = -(event.clientY / window.innerHeight) * 2 + 1
	})

	window.addEventListener("keydown", (event) => {
		scene.keysPressed[event.key] = true
		if (event.key === "1") {
			scene.moveType = 1
		} else if (event.key === "2") {
			scene.moveType = 0
		}
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
