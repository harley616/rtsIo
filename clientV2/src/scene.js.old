import * as THREE from "three"
import { SelectionBox } from "three/addons/interactive/SelectionBox.js"
import { SelectionHelper } from "three/addons/interactive/SelectionHelper.js"
import { Building } from "./building.js"
import { Knight, Builder } from "./guys.js"

export class Scene {
	constructor(containerId, models) {
		this.keysPressed = {}
		this.buildings = []
		this.playerId
		this.moveType = 0
		this.builderIds = {}
		this.unitsMap = {}
		this.isBuilding = false
		this.canBuild = false
		this.currentBuildingType = false
		this.mouseX = 0
		this.mouseY = 0
		this.modelsDict = models
		this.zoom = 1
		const Orthographic = true

		this.commandBuffer = []
		this.container = document.getElementById(containerId)
		this.scene = new THREE.Scene()
		this.scene.background = new THREE.Color(0x333344)

		if (Orthographic) {
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
			this.camera.position.set(200, 200, 200)
			this.camera.lookAt(new THREE.Vector3(0, 0, 0))
		} else {
			this.camera = new THREE.PerspectiveCamera(
				75,
				window.innerWidth / window.innerHeight,
				0.1,
				1000
			)
			this.camera.position.set(10, 20, 10)
			this.camera.lookAt(new THREE.Vector3(0, 0, 0))
		}
		this.renderer = new THREE.WebGLRenderer({ antialias: true })
		this.renderer.setSize(window.innerWidth, window.innerHeight)
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
		this.renderer.shadowMap.enabled = true
		this.container.appendChild(this.renderer.domElement)

		// Ground plane
		const groundPlaneSize = 500
		// const planeGeometry = new THREE.PlaneGeometry(
		// 	groundPlaneSize,
		// 	groundPlaneSize
		// )
		// const planeMaterial = new THREE.MeshLambertMaterial({
		// 	color: 0x2c7037,
		// 	shadowSide: THREE.DoubleSide,
		// })
		// this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial)
		// this.groundPlane.rotation.x = -Math.PI / 2
		// this.groundPlane.receiveShadow = true
		// this.scene.add(this.groundPlane)

		{
			// Define the ground plane size and base color for your grass
			const groundPlaneSize = 500
			var baseColor = { r: 8, g: 20, b: 9 } // corresponds to 0x2c7037

			// Set the desaturation factor (0 = no desaturation, 1 = fully grayscale)
			const desaturationFactor = 0.2
			const darkenFactor = 1 // Multiply the grayscale value to darken it

			// Create a low-resolution canvas to generate large, subtle noise
			const noiseCanvas = document.createElement("canvas")
			noiseCanvas.width = 64 // Low resolution for large noise blocks
			noiseCanvas.height = 64
			const noiseContext = noiseCanvas.getContext("2d")

			// Create image data to fill with noise
			const noiseImageData = noiseContext.createImageData(
				noiseCanvas.width,
				noiseCanvas.height
			)
			const noiseData = noiseImageData.data

			// Loop through each pixel and add a slight random offset to the base color
			for (let y = 0; y < noiseCanvas.height; y++) {
				for (let x = 0; x < noiseCanvas.width; x++) {
					const index = (y * noiseCanvas.width + x) * 4
					// Generate a noise value between -15 and 15 for subtle variation
					const noiseVal = Math.random() * 4 - 10

					// Apply the noise to each channel
					let r = baseColor.r + 2 * noiseVal
					let g = baseColor.g + noiseVal
					let b = baseColor.b + noiseVal

					// Clamp the values to valid [0, 255] range
					r = Math.min(255, Math.max(0, r))
					g = Math.min(255, Math.max(0, g))
					b = Math.min(255, Math.max(0, b))

					// Compute the grayscale value using the luminosity method
					const gray = r * 0.299 + g * 0.587 + b * 0.114
					const darkGray = gray * darkenFactor
					// Blend the original color with the grayscale based on the desaturation factor
					r = r * (1 - desaturationFactor) + darkGray * desaturationFactor
					g = g * (1 - desaturationFactor) + darkGray * desaturationFactor
					b = b * (1 - desaturationFactor) + darkGray * desaturationFactor

					// Final clamp just in case
					noiseData[index] = Math.min(255, Math.max(0, r))
					noiseData[index + 1] = Math.min(255, Math.max(0, g))
					noiseData[index + 2] = Math.min(255, Math.max(0, b))
					noiseData[index + 3] = 255 // Fully opaque
				}
			}

			// Draw the generated noise data onto the canvas
			noiseContext.putImageData(noiseImageData, 0, 0)

			// Create a texture from the canvas
			const noiseTexture = new THREE.CanvasTexture(noiseCanvas)
			// Set the texture to repeat so it covers the entire plane
			noiseTexture.wrapS = THREE.RepeatWrapping
			noiseTexture.wrapT = THREE.RepeatWrapping
			noiseTexture.repeat.set(
				groundPlaneSize / noiseCanvas.width,
				groundPlaneSize / noiseCanvas.height
			)

			// Optionally, use NearestFilter to keep the blocky noise effect
			noiseTexture.minFilter = THREE.NearestFilter
			noiseTexture.magFilter = THREE.NearestFilter

			// Create your plane geometry and material using the noise texture
			const planeGeometry = new THREE.PlaneGeometry(
				groundPlaneSize,
				groundPlaneSize
			)
			const planeMaterial = new THREE.MeshLambertMaterial({
				map: noiseTexture,
				side: THREE.DoubleSide,
			})

			// Create the mesh, rotate it to lay flat, and add to the scene
			this.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial)
			this.groundPlane.rotation.x = -Math.PI / 2
			this.groundPlane.receiveShadow = true
			this.scene.add(this.groundPlane)
		}

		this.selectionBox = new SelectionBox(this.camera, this.scene)
		this.helper = new SelectionHelper(this.renderer, "selectBox")
		this.selectedUnits = []
		this.selectableObjects = []
		// Grid
		const totalSize = groundPlaneSize
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

		this.setupLights()

		window.addEventListener("resize", this.onWindowResize.bind(this))
		this.container.addEventListener("mousedown", this.onMouseDown.bind(this))
		this.container.addEventListener("mousemove", this.onMouseMove.bind(this))
		this.container.addEventListener("mouseup", this.onMouseUp.bind(this))
	}

	/* Add all lights to the scene */
	setupLights() {
		const lights = [
			new THREE.AmbientLight(0xffffff, 0),
			new THREE.DirectionalLight(0xffffff, 3),
			new THREE.DirectionalLight(0xffffff, 0.5),
			new THREE.DirectionalLight(0xffffff, 0.2),
		]

		const d = 200
		lights[1].position.set(1 * d, 1 * d, -1 * d)
		lights[2].position.set(1 * d, 1 * d, 0)
		lights[3].position.set(0, 1 * d, 1 * d)

		lights.forEach((light) => {
			if (light.isDirectionalLight) {
				light.castShadow = true
				light.shadow.mapSize.width = 2048 * 3
				light.shadow.mapSize.height = 2048 * 3

				light.shadow.camera.left = -d
				light.shadow.camera.right = d
				light.shadow.camera.top = d
				light.shadow.camera.bottom = -d
				light.shadow.camera.near = 0.1
				light.shadow.camera.far = 500
				light.shadow.camera.updateProjectionMatrix()
			}
		})

		this.scene.add(...lights)
	}

	onWindowResize() {
		this.camera.aspect = window.innerWidth / window.innerHeight
		this.camera.updateProjectionMatrix()
		this.renderer.setSize(window.innerWidth, window.innerHeight)
	}

	onMouseDown(e) {
		this.handleClick(e.button, this.mouseX, this.mouseY)
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1
		const clickLocation = this.getMouseCoordinatesOnGroundPlane(
			this.mouseX,
			this.mouseY
		)

		if (e.button == 2) {
			for (const selection of this.selectedUnits) {
				console.log(selection)
				if (selection.entityId && selection.isMoveable) {
					this.commandBuffer.push({
						moveUnit: {
							id: selection.entityId,
							type: this.moveType === 0 ? "passive" : "aggressive",
							pos: {
								x: clickLocation.x + Math.random() * 2 - 1,
								y: 0.5,
								z: clickLocation.z + Math.random() * 2 - 1,
							},
						},
					})
				}
			}
			this.helper.isDown = false
		} else if (e.button == 0) {
			this.selectedUnits = []

			this.selectionBox.startPoint.set(mX, mY)
			this.helper.startPoint.set(e.clientX, e.clientY)

			this.helper.isDown = true
		}
	}

	onMouseMove(e) {
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1
		if (this.helper.isDown) {
			this.selectionBox.endPoint.set(mX, mY)
			this.helper.onSelectMove(e)
			// this.selectedUnits = this.selectionBox.select()
			// this.updateSelectedAppearances();
		}
	}

	onMouseUp(e) {
		const DRAG_THRESHOLD = 0.02
		const mX = (e.clientX / window.innerWidth) * 2 - 1
		const mY = -(e.clientY / window.innerHeight) * 2 + 1

		if (e.button == 0) {
			this.selectionBox.endPoint.set(mX, mY)

			const dx = mX - this.selectionBox.startPoint.x
			const dy = mY - this.selectionBox.startPoint.y
			const distance = Math.sqrt(dx * dx + dy * dy)
			this.helper.onSelectOver()
			this.helper.isDown = false

			if (distance < DRAG_THRESHOLD) {
				// Optionally, you can do a raycast here for single object selection.
				// For now, simply clear the selection.
				this.selectedUnits = []
				this.updateSelectedAppearances()
				console.log("Click detected: no drag selection")
			} else {
				// Finalize the selection rectangle.
				this.selectionBox.collection = this.selectableObjects

				this.selectedUnits = this.selectionBox.select()

				this.helper.onSelectOver()
				this.helper.isDown = false
				this.updateSelectedAppearances()
			}

			for (let i = 0; i < this.selectedUnits.length; i++) {
				if (!this.selectedUnits[i].isSelectable) {
					continue
				}
			}
		}
	}

	updateSelectedAppearances() {
		// Reset all
		for (const selection of this.selectableObjects) {
			if (selection.unit && selection.unit.halo) {
				selection.unit.halo.visible = false;
			}
		}
		// Update Selected
		for (let i = 0; i < this.selectedUnits.length; i++) {
			const object = this.selectedUnits[i]
			
			if (object.unit && object.unit.halo) {
				object.unit.halo.visible = true;
			}
		}
	}

	animate() {
		this.renderer.render(this.scene, this.camera)
	}

	addCube(x, y, z, l) {
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

	addUnit(id, pId, type, x, y, z) {
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
			unit.mesh.scale.set(1.15, 1.15, 1.15);
			
			unit.mesh.traverse((child) => {
				if (child.isMesh) {
					//child.position.set(x, y, z)
					child.isSelectable = Number(pId) === Number(this.playerId)
					child.isMoveable = Number(pId) === Number(this.playerId)
					child.entityId = id
					this.selectableObjects.push(child)
				}
			});
			
			this.unitsMap[id] = unit
			this.scene.add(unit.mesh)
			
		} else {
			console.error(`Failed to create unit of type: ${type}`)
		}
	}

	moveUnit(id, x, y, z) {
		const unit = this.unitsMap[id]
		unit.mesh.position.set(x, unit.height / 2, z)
	}

	removeUnit(id) {
		const unit = this.unitsMap[id]

		const building = this.buildings.find((b) => b.id === id)
		if (building) {
			console.log("Removing building", building)
			this.buildings = this.buildings.filter((b) => b.id !== id)
			this.scene.remove(building.model)
		} else {
			this.scene.remove(unit.mesh)
			this.renderer.renderLists.dispose()
		}

		delete this.unitsMap[id]
	}

	startAnimationLoop() {
		this.renderer.setAnimationLoop(this.animate.bind(this))
	}

	rotateCube(x, y) {
		this.cube.rotation.x += x
		this.cube.rotation.y += y
	}

	handleClick(mouseButton, mouseX, mouseY) {
		const clickLocation = this.getMouseCoordinatesOnGroundPlane(mouseX, mouseY)

		if (this.isBuilding) {
			if (this.canBuild) {
				if (mouseButton == 0 && clickLocation) {
					// Left click
					const buildingCoordinates = this.getGridCoordinates(clickLocation)
					this.commandBuffer.push({
						placeBuilding: {
							type: this.currentBuildingType,
							pos: {
								x: buildingCoordinates.x,
								z: buildingCoordinates.z,
							},
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

	createBuilding(id, pId, type, x, z) {
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
		this.buildings.push(newBuilding)
		this.unitsMap[id] = newBuilding
	}
	createResourceNode(id, type, x, z, gold, stone, wood) {
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
		this.buildings.push(newBuilding)
		this.unitsMap[id] = newBuilding
	}

	checkGridCollisions(gridLocation, width, height) {
		var collide = false
		const buildingPositions = []
		this.buildings.forEach((building) => {
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

	getMouseCoordinatesOnGroundPlane(mouseX, mouseY) {
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

	getGridCoordinates(position) {
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

		// Clamp the camera position to stay within 100 and 300 on the x and z axes
		this.camera.position.x = Math.min(
			300,
			Math.max(100, this.camera.position.x)
		)
		this.camera.position.z = Math.min(
			300,
			Math.max(100, this.camera.position.z)
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
