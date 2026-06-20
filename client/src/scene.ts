import * as THREE from "three"
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox"
import { SelectionHelper } from "three/examples/jsm/interactive/SelectionHelper"
import { Building } from "./structures/building"
import { createGround, createLights, GROUND_PLANE_SIZE } from "./environment"
import { Knight, Builder } from "./guys"
import { BuildingType } from "./types/models"
import { Game } from "./engine/game"
import { buildingPosition } from "./engine/entities"
import { Command, BuildingType as EngineBuildingType } from "./engine/types"

interface Unit {
	model: THREE.Object3D
	height: number
	halo?: THREE.Mesh
}

type UnitType = "knight" | "builder"

export class Scene {
	keysPressed: Record<string, boolean> = {}
	playerId: number
	moveType: number = 0
	/** Single source of truth for every entity currently rendered, keyed by engine entity ID. */
	entities: Map<number, Unit | Building> = new Map()
	isBuilding: boolean = false
	canBuild: boolean = false
	currentBuildingType: string | false = false
	mouseX: number = 0
	mouseY: number = 0
	modelsDict: any
	zoom: number = 1
	sendCommand: (cmd: Command) => void
	container: HTMLElement | null
	scene: THREE.Scene
	camera: THREE.OrthographicCamera
	renderer: THREE.WebGLRenderer
	groundPlane: THREE.Mesh
	selectionBox: SelectionBox
	helper: SelectionHelper
	selectedUnits: any[] = []
	selectableObjects: any[] = []
	grid: THREE.GridHelper
	TEMP_house: Building
	TEMP_townhall: Building
	TEMP_barracks: Building
	cubes: THREE.Mesh[] = []
	constructor(containerId: string, models: any, sendCommand: (cmd: Command) => void) {
		this.keysPressed = {}
		this.playerId = -1
		this.moveType = 0
		this.isBuilding = false
		this.canBuild = false
		this.currentBuildingType = false
		this.mouseX = 0
		this.mouseY = 0
		this.modelsDict = models
		this.zoom = 1

		this.sendCommand = sendCommand
		this.container = document.getElementById(containerId)
		if (!this.container) {
			throw new Error(`Container with id ${containerId} not found`)
		}
		this.scene = new THREE.Scene()
		this.scene.background = new THREE.Color(0x333344)

		const frustumSize = 20
		const aspect = window.innerWidth / window.innerHeight
		this.camera = new THREE.OrthographicCamera(
			(-frustumSize * aspect) / 2, // left
			(frustumSize * aspect) / 2, // right
			frustumSize / 2, // top
			-frustumSize / 2, // bottom
			0.1, // near
			1000 // far
		)
		this.camera.position.set(50, 50, 50)
		this.camera.lookAt(new THREE.Vector3(0, 0, 0))

		this.renderer = new THREE.WebGLRenderer({ antialias: true })
		this.renderer.setSize(window.innerWidth, window.innerHeight)
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
		this.renderer.shadowMap.enabled = true
		this.container.appendChild(this.renderer.domElement)

		// Ground plane
		this.groundPlane = createGround()
		this.scene.add(this.groundPlane)

		this.selectionBox = new SelectionBox(this.camera, this.scene)
		this.helper = new SelectionHelper(this.renderer, "selectBox")
		this.selectedUnits = []
		this.selectableObjects = []
		// Grid
		const totalSize = GROUND_PLANE_SIZE
		const cellSize = 1
		const divisions = totalSize / cellSize
		this.grid = new THREE.GridHelper(totalSize, divisions)
		this.scene.add(this.grid)

		// Temporary Buildings
		this.TEMP_house = new Building(
			"house",
			-1,
			1,
			0,
			0,
			0,
			this.scene,
			this.modelsDict
		)
		this.TEMP_house.setVisible(true)

		this.TEMP_townhall = new Building(
			"townhall",
			-1,
			1,
			0,
			0,
			0,
			this.scene,
			this.modelsDict
		)
		this.TEMP_townhall.setVisible(false)

		this.TEMP_barracks = new Building(
			"barracks",
			-1,
			1,
			0,
			0,
			0,
			this.scene,
			this.modelsDict
		)
		this.TEMP_barracks.setVisible(false)

		// TODO: Scene Init

		this.scene.add(...createLights())

		window.addEventListener("resize", this.onWindowResize.bind(this))
		this.container.addEventListener("mousedown", this.onMouseDown.bind(this))
		this.container.addEventListener("mousemove", this.onMouseMove.bind(this))
		this.container.addEventListener("mouseup", this.onMouseUp.bind(this))
	}

	onWindowResize() {
		// this.camera.aspect = window.innerWidth / window.innerHeight
		this.camera.updateProjectionMatrix()
		this.renderer.setSize(window.innerWidth, window.innerHeight)
	}

	onMouseDown(e: MouseEvent) {
		this.handleClick(e.button, this.mouseX, this.mouseY)
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1
		const clickLocation = this.getMouseCoordinatesOnGroundPlane(
			this.mouseX,
			this.mouseY
		)

		if (e.button == 2) {
			for (const selection of this.selectedUnits) {
				if (selection.entityId && selection.isMoveable) {
					this.sendCommand({
						type: "moveUnit",
						entityId: selection.entityId,
						moveType: this.moveType === 0 ? "passive" : "aggressive",
						pos: {
							x: clickLocation?.x ?? 0,
							y: 0.5,
							z: clickLocation?.z ?? 0,
						},
					})
				}
			}
			this.helper.isDown = false
		} else if (e.button == 0) {
			this.selectedUnits = []

			this.selectionBox.startPoint = new THREE.Vector3(mX, mY, 0)

			this.helper.isDown = true
		}
	}

	onMouseMove(e: MouseEvent) {
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1
		if (this.helper.isDown) {
			this.selectionBox.endPoint.set(mX, mY, 0)
			// this.helper.onSelectMove(e)
			// this.selectedUnits = this.selectionBox.select()
			// this.updateSelectedAppearances();
		}
	}

	onMouseUp(e: MouseEvent) {
		const DRAG_THRESHOLD = 0.02
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1

		if (e.button == 0) {
			this.selectionBox.endPoint.set(mX, mY, 0)

			const dx = mX - this.selectionBox.startPoint.x
			const dy = mY - this.selectionBox.startPoint.y
			const distance = Math.sqrt(dx * dx + dy * dy)

			if (distance < DRAG_THRESHOLD) {
				this.selectedUnits = []
				this.updateSelectedAppearances()
			} else {
				// Finalize the selection rectangle
				this.selectionBox.collection = this.selectableObjects
				const meshes = this.selectionBox.select()

				// Deduplicate: map meshes back to their parent Unit objects
				const seen = new Set<number>()
				this.selectedUnits = []
				for (const mesh of meshes) {
					const unit = (mesh as any).unit
					if (unit?.entityId != null && unit.isSelectable && !seen.has(unit.entityId)) {
						seen.add(unit.entityId)
						this.selectedUnits.push(unit)
					}
				}

				this.helper.isDown = false
				this.updateSelectedAppearances()
			}
		}
	}

	updateSelectedAppearances() {
		// Reset all halos
		for (const mesh of this.selectableObjects) {
			const unit = (mesh as any).unit
			if (unit?.halo) {
				unit.halo.visible = false
			}
		}
		// Show halos on selected units
		for (const unit of this.selectedUnits) {
			if (unit.halo) {
				unit.halo.visible = true
			}
		}
	}

	addCube(x: number, y: number, z: number, l: number) {
		const geometry = new THREE.BoxGeometry(l, l, l)
		const material = new THREE.MeshLambertMaterial({ color: 0x00ff00 })
		const cube = new THREE.Mesh(geometry, material)
		cube.position.set(x, y, z)
		cube.castShadow = true
		cube.receiveShadow = true
		const edges = new THREE.EdgesGeometry(cube.geometry)
		const lineMaterial = new THREE.LineBasicMaterial({
			color: 0x000000,
			linewidth: 5,
		})
		const outline = new THREE.LineSegments(edges, lineMaterial)
		cube.add(outline)
		this.cubes.push(cube)
		this.scene.add(cube)
	}

	// TODO: Update type of unit type
	addUnit(
		id: number,
		pId: number,
		type: UnitType,
		x: number,
		y: number,
		z: number
	) {
		let unit
		switch (type) {
			case "knight":
				unit = new Knight(id, pId, this)
				break
			case "builder":
				unit = new Builder(id, pId, this)
				break
			default:
				console.error(`Unknown unit type: ${type}`)
				return
		}
		if (unit && unit.mesh) {
			unit.mesh.position.set(x, y, z)
			unit.mesh.scale.set(1.15, 1.15, 1.15)
			unit.isSelectable = Number(pId) === Number(this.playerId)
			unit.isMoveable = Number(pId) === Number(this.playerId)
			unit.entityId = id

			if (unit.isSelectable) {
				unit.mesh.traverse((child: THREE.Object3D) => {
					if ((child as THREE.Mesh).isMesh) {
						this.selectableObjects.push(child)
					}
				})
			}

			this.entities.set(id, unit)
			this.scene.add(unit.mesh)
		} else {
			console.error(`Failed to create unit of type: ${type}`)
		}
	}

	moveUnit(id: number, x: number, z: number) {
		const unit = this.entities.get(id)
		if (!unit) return
		unit.model.position.set(x, unit.height / 2, z)
	}

	/** All rendered building/resource-node views (excludes the build previews). */
	private buildingViews(): Building[] {
		const result: Building[] = []
		for (const entity of this.entities.values()) {
			if (entity instanceof Building) result.push(entity)
		}
		return result
	}

	removeUnit(id: number) {
		const entity = this.entities.get(id)
		if (!entity) return

		if (entity instanceof Building) {
			this.scene.remove(entity.model)
		} else {
			// Remove child meshes from selectableObjects
			this.selectableObjects = this.selectableObjects.filter(
				(mesh: any) => !mesh.unit || mesh.unit.entityId !== id
			)
			this.scene.remove(entity.model)
			this.renderer.renderLists.dispose()
		}

		// Remove from selected units if present
		this.selectedUnits = this.selectedUnits.filter(
			(u: any) => u.entityId !== id
		)

		this.entities.delete(id)
	}

	/**
	 * Sync engine game state to Three.js scene.
	 * Creates new objects for new entities, removes dead ones, updates positions.
	 */
	syncFromEngine(game: Game): void {
		// Sync all players' entities
		for (const [pid, player] of game.players) {
			// Fighters (knights)
			for (const [id, fighter] of player.fighters) {
				if (!this.entities.has(id)) {
					this.addUnit(id, pid, "knight", fighter.position.x, fighter.position.y, fighter.position.z)
				} else {
					this.moveUnit(id, fighter.position.x, fighter.position.z)
				}
			}

			// Builders (workers)
			for (const [id, builder] of player.builders) {
				if (!this.entities.has(id)) {
					this.addUnit(id, pid, "builder", builder.position.x, builder.position.y, builder.position.z)
				} else {
					this.moveUnit(id, builder.position.x, builder.position.z)
				}
			}

			// Buildings
			for (const [id, building] of player.buildings) {
				if (!this.entities.has(id)) {
					this.createBuilding(id, pid, building.buildingType as BuildingType, building.position.x, building.position.z)
				}
			}
		}

		// Resources
		for (const [id, resource] of game.resources) {
			if (!this.entities.has(id)) {
				this.createResourceNode(id, resource.resourceType as BuildingType, resource.position.x, resource.position.z, resource.gold, resource.stone, resource.wood)
			}
		}

		// Remove deceased entities
		for (const id of game.deceased) {
			this.removeUnit(id)
		}
	}

	startAnimationLoop() {
		this.renderer.setAnimationLoop(this.animate.bind(this))
	}

	handleClick(mouseButton: number, mouseX: number, mouseY: number) {
		const clickLocation = this.getMouseCoordinatesOnGroundPlane(mouseX, mouseY)

		if (this.isBuilding && this.currentBuildingType) {
			if (this.canBuild) {
				if (mouseButton == 0 && clickLocation) {
					// Left click
					const buildingCoordinates = this.getGridCoordinates(clickLocation)
					this.sendCommand({
						type: "placeBuilding",
						buildingType: this.currentBuildingType as EngineBuildingType,
						pos: {
							x: buildingCoordinates.x,
							z: buildingCoordinates.z,
						},
					})
					this.isBuilding = false
					return
				} else {
					// Other click
					this.isBuilding = false
					return
				}
			} else {
				console.log("Can't Build there!")
			}
		}
	}

	createBuilding(
		id: number,
		pId: number,
		type: BuildingType,
		x: number,
		z: number
	) {
		const newBuilding = new Building(
			type,
			id,
			pId,
			x,
			0,
			z,
			this.scene,
			this.modelsDict
		)
		this.entities.set(id, newBuilding)
	}
	createResourceNode(
		id: number,
		type: BuildingType,
		x: number,
		z: number,
		gold: number,
		stone: number,
		wood: number
	) {
		const newBuilding = new Building(
			type,
			id,
			0,
			x,
			0,
			z,
			this.scene,
			this.modelsDict,
			[gold, stone, wood]
		)
		this.entities.set(id, newBuilding)
	}

	checkGridCollisions(
		gridLocation: THREE.Vector3,
		width: number,
		height: number
	) {
		var collide = false
		const buildingPositions: THREE.Vector3[] = []
		this.buildingViews().forEach((building) => {
			const buildingPos = building.gridPosition
			for (var x = 0; x < building.width; x++) {
				for (var z = 0; z < building.height; z++) {
					const posX = buildingPos.x + x
					const posZ = buildingPos.z + z
					const loc = new THREE.Vector3(posX, buildingPos.y, posZ)
					buildingPositions.push(loc)
				}
			}
		})

		for (var x = 0; x < width; x++) {
			for (var z = 0; z < height; z++) {
				const posX = gridLocation.x + x
				const posZ = gridLocation.z + z

				buildingPositions.forEach((buildingPosition) => {
					if (
						Math.abs(posX - buildingPosition.x) < 0.01 &&
						Math.abs(posZ - buildingPosition.z) < 0.01
					) {
						collide = true
						return
					}
				})
			}
		}

		return collide
	}

	getMouseCoordinatesOnGroundPlane(mouseX: number, mouseY: number) {
		const raycaster = new THREE.Raycaster()
		const mousePosition = new THREE.Vector2(mouseX, mouseY)
		raycaster.setFromCamera(mousePosition, this.camera)
		const intersects = raycaster.intersectObject(this.groundPlane)
		if (intersects.length > 0) {
			return intersects[0].point
		} else {
			return null
		}
	}

	getGridCoordinates(position: THREE.Vector3) {
		const x = Math.floor(position.x)
		const z = Math.floor(position.z)

		return new THREE.Vector3(x, position.y, z)
	}

	updateCamera() {
		const speed = 0.2 * this.zoom // Adjust speed as needed

		const frustumSize = 20 * this.zoom
		const aspect = window.innerWidth / window.innerHeight
		this.camera.left = (-frustumSize * aspect) / 2
		this.camera.right = (frustumSize * aspect) / 2
		this.camera.top = frustumSize / 2
		this.camera.bottom = -frustumSize / 2
		this.camera.updateProjectionMatrix()

		// Move forward
		if (
			this.keysPressed["ArrowUp"] ||
			this.keysPressed["w"] ||
			this.keysPressed["W"]
		) {
			this.camera.position.z -= speed * 1.4
			this.camera.position.x -= speed * 1.4
		}
		// Move backward
		if (
			this.keysPressed["ArrowDown"] ||
			this.keysPressed["s"] ||
			this.keysPressed["S"]
		) {
			this.camera.position.z += speed * 1.4
			this.camera.position.x += speed * 1.4
		}
		// Move left
		if (
			this.keysPressed["ArrowLeft"] ||
			this.keysPressed["a"] ||
			this.keysPressed["A"]
		) {
			this.camera.position.x -= speed
			this.camera.position.z += speed
		}
		// Move right
		if (
			this.keysPressed["ArrowRight"] ||
			this.keysPressed["d"] ||
			this.keysPressed["D"]
		) {
			this.camera.position.x += speed
			this.camera.position.z -= speed
		}

		// Clamp the camera position to stay within the map bounds
		this.camera.position.x = Math.min(
			150,
			Math.max(-150, this.camera.position.x)
		)
		this.camera.position.z = Math.min(
			150,
			Math.max(-150, this.camera.position.z)
		)
		this.camera.updateProjectionMatrix()

		//console.log(this.camera.position.x + " : " + this.camera.position.z)
	}

	animate() {
		this.updateCamera()
		this.grid.visible = this.isBuilding
		if (this.isBuilding) {
			const groundMousePos = this.getMouseCoordinatesOnGroundPlane(
				this.mouseX,
				this.mouseY
			)
			if (groundMousePos) {
				var currentTEMP = this.TEMP_house
				if (this.currentBuildingType == "house") {
					currentTEMP = this.TEMP_house
				} else if (this.currentBuildingType == "townhall") {
					currentTEMP = this.TEMP_townhall
				} else if (this.currentBuildingType == "barracks") {
					currentTEMP = this.TEMP_barracks
				}

				currentTEMP.setVisible(true)
				const gridMousePos = this.getGridCoordinates(groundMousePos)
				currentTEMP.moveTo(gridMousePos)
				const collision = this.checkGridCollisions(
					gridMousePos,
					currentTEMP.width,
					currentTEMP.height
				)
				if (collision) {
					currentTEMP.setAppearance_CantBuild()
					this.canBuild = false
				} else {
					currentTEMP.setAppearance_CanBuild()
					this.canBuild = true
				}
			}
		} else {
			this.TEMP_house.setVisible(false)
			this.TEMP_townhall.setVisible(false)
			this.TEMP_barracks.setVisible(false)
			this.canBuild = false
		}
		this.renderer.render(this.scene, this.camera)
	}
}
