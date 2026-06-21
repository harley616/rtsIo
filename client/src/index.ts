import * as THREE from "three"
import { Scene } from "./scene"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { ModelsDict } from "./types/models"
import { Game } from "./engine/game"
import { Command } from "./engine/types"
import { LockstepManager } from "./engine/lockstep"

const TICK_MS = 10
const DT = 0.05
const RELAY_URL = import.meta.env.DEV ? "ws://localhost:3001/" : "wss://rts.waterthegarden.com/relay/"

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

		const game = Game.makeTwoPlayerGame()
		scene.playerId = 1
		if (playerNumElem) playerNumElem.innerText = "1"

		setInterval(() => {
			while (pendingCommands.length > 0) {
				game.applyCommand(scene.playerId, pendingCommands.shift()!)
			}
			game.update(DT)
			scene.syncFromEngine(game)
			updateResourceDisplay(game, scene.playerId)
		}, TICK_MS)
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

// --- Model loading ---

async function loadModels() {
	var modelsDict: ModelsDict = {}
	const houseModel_red = (await loadModel(
		"/models/buildings/house/house_red.glb"
	)) as THREE.Object3D
	const houseModel_blue = (await loadModel(
		"/models/buildings/house/house_blue.glb"
	)) as THREE.Object3D
	const townhallModel_red = (await loadModel(
		"/models/buildings/townhall/townhall_red.glb"
	)) as THREE.Object3D
	const townhallModel_blue = (await loadModel(
		"/models/buildings/townhall/townhall_blue.glb"
	)) as THREE.Object3D
	const barracksModel_red = (await loadModel(
		"/models/buildings/barracks/barracks_red.glb"
	)) as THREE.Object3D
	const barracksModel_blue = (await loadModel(
		"/models/buildings/barracks/barracks_blue.glb"
	)) as THREE.Object3D
	const goldModel = (await loadModelResource(
		"/models/buildings/nodes/gold/gold.glb"
	)) as THREE.Object3D
	const stoneModel = (await loadModelResource(
		"/models/buildings/nodes/stone/stone.glb"
	)) as THREE.Object3D
	const wood = (await loadModelResource(
		"/models/buildings/nodes/wood/wood.glb"
	)) as THREE.Object3D
	const knight_red_idle = (await loadModelResource(
		"/models/characters/knight_red/knight_red_idle.glb"
	)) as THREE.Object3D
	const knight_blue_idle = (await loadModelResource(
		"/models/characters/knight_blue/knight_blue_idle.glb"
	)) as THREE.Object3D
	const knight_red_attack = (await loadModelResource(
		"/models/characters/knight_red/knight_red_attack.glb"
	)) as THREE.Object3D
	const knight_blue_attack = (await loadModelResource(
		"/models/characters/knight_blue/knight_blue_attack.glb"
	)) as THREE.Object3D
	const worker_red = (await loadModelResource(
		"/models/characters/worker/worker_red.glb"
	)) as THREE.Object3D
	const worker_blue = (await loadModelResource(
		"/models/characters/worker/worker_blue.glb"
	)) as THREE.Object3D
	modelsDict.house = [houseModel_blue, houseModel_red]
	modelsDict.townhall = [townhallModel_blue, townhallModel_red]
	modelsDict.barracks = [barracksModel_blue, barracksModel_red]
	modelsDict.gold = goldModel
	modelsDict.stone = stoneModel
	modelsDict.wood = wood
	modelsDict.knight_attack = [knight_blue_attack, knight_red_attack]
	modelsDict.knight_idle = [knight_blue_idle, knight_red_idle]
	modelsDict.worker = [worker_blue, worker_red]

	return modelsDict
}

async function loadModel(path: string) {
	const loader = new GLTFLoader()
	return new Promise((resolve, reject) => {
		loader.load(
			path,
			(gltf) => {
				let model = gltf.scene
				model.rotation.x = -Math.PI / 2
				model.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						const edges = new THREE.EdgesGeometry(child.geometry)
						const lineMaterial = new THREE.LineBasicMaterial({
							color: 0x000000,
							linewidth: 10,
						})
						const outline = new THREE.LineSegments(edges, lineMaterial)
						child.userData.outline = outline
						child.add(outline)
						child.castShadow = true
					}
				})
				resolve(model)
			},
			undefined,
			(error) => {
				console.error("Found an error", error)
				reject(error)
			}
		)
	})
}

async function loadModelResource(path: string) {
	const loader = new GLTFLoader()
	return new Promise((resolve, reject) => {
		loader.load(
			path,
			(gltf) => {
				let model = gltf.scene
				model.rotation.x = -Math.PI / 2

				model.traverse((child) => {
					if (child instanceof THREE.Mesh) {
						child.castShadow = true
					}
				})
				resolve(model)
			},
			undefined,
			(error) => {
				console.error("Found an error", error)
				reject(error)
			}
		)
	})
}
