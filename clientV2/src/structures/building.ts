import * as THREE from "three"
import { BuildingType, ModelsDict } from "../types/models"

export class Building {
	type: BuildingType
	id: number
	pId: number
	gridPosition: THREE.Vector3
	modelsDict: ModelsDict
	resources: number[]
	model: THREE.Object3D
	offset: THREE.Vector3
	width: number
	height: number
	health: number
	materialsColors: THREE.Color[]

	constructor(
		type: BuildingType,
		id: number,
		pId: number,
		x: number,
		y: number,
		z: number,
		scene: THREE.Scene,
		modelsDict: ModelsDict,
		resources?: number[]
	) {
		this.type = type
		this.id = id
		this.pId = pId
		this.gridPosition = new THREE.Vector3(x, y, z)
		this.modelsDict = modelsDict
		this.resources = resources ?? [0, 0, 0]

		const traverseCallback = (child: THREE.Object3D) => {
			if ((child as any).isMesh) {
				const mesh = child as THREE.Mesh
				if (!Array.isArray(mesh.material)) {
					mesh.material = mesh.material.clone()
				}
				mesh.receiveShadow = true
				this.materialsColors.push(
					(mesh.material as THREE.Material & { color: THREE.Color }).color
				)

				if (mesh.userData.outline) {
					if (mesh.getObjectById(mesh.userData.outline.id)) {
						mesh.remove(mesh.userData.outline)
					}
					const edges = new THREE.EdgesGeometry(mesh.geometry)
					const lineMaterial = new THREE.LineBasicMaterial({
						color: 0x000000,
						linewidth: 10,
					})
					const newOutline = new THREE.LineSegments(edges, lineMaterial)
					mesh.userData.outline = newOutline
					mesh.add(newOutline)
				}
			}
		}

		this.materialsColors = []

		switch (this.type) {
			case "house":
				this.model = this.modelsDict.house![this.pId - 1].clone()
				this.offset = new THREE.Vector3(0, 0, 0)
				this.width = 2
				this.height = 2
				break
			case "townhall":
				this.model = this.modelsDict.townhall![this.pId - 1].clone()
				this.offset = new THREE.Vector3(1, 0, 1)
				this.width = 4
				this.height = 4
				break
			case "barracks":
				this.model = this.modelsDict.barracks![this.pId - 1].clone()
				this.offset = new THREE.Vector3(1, 0, 1)
				this.model.rotation.z = Math.PI / 2
				this.width = 4
				this.height = 4
				break
			case "gold":
				this.model = this.modelsDict.gold!.clone()
				this.offset = new THREE.Vector3(-0.5, 0, -0.5)
				this.model.rotation.z = -Math.PI
				this.width = 1
				this.height = 1
				break
			case "stone":
				this.model = this.modelsDict.stone!.clone()
				this.offset = new THREE.Vector3(-0.5, 0, -0.5)
				this.model.rotation.z = Math.PI
				this.width = 1
				this.height = 1
				break
			case "wood":
				this.model = this.modelsDict.wood!.clone()
				this.offset = new THREE.Vector3(-0.5, 0, -0.5)
				this.model.rotation.z = Math.PI / 2
				this.width = 1
				this.height = 1
				break
		}

		this.model.position.set(
			this.gridPosition.x + this.offset.x,
			this.gridPosition.y + this.offset.y,
			this.gridPosition.z + this.offset.z
		)

		this.model.traverse(traverseCallback)
		scene.add(this.model)
		this.health = 100
	}

	async loadModel(type: BuildingType): Promise<void> {}

	moveTo(position: THREE.Vector3): void {
		this.gridPosition = position
		this.model.position.set(
			this.gridPosition.x + this.offset.x,
			this.gridPosition.y + this.offset.y,
			this.gridPosition.z + this.offset.z
		)
	}

	changeHealth(amount: number): boolean {
		if (this.health + amount > 0) {
			this.health += amount
			return true
		}
		return false
	}

	instantiateBuilding(scene: THREE.Scene): void {
		scene.add(this.model)
	}

	setVisible(visible: boolean): void {
		this.model.traverse((child: THREE.Object3D) => {
			if ((child as any).isMesh) {
				;(child as THREE.Mesh).visible = visible
			}
		})
	}

	setAppearance_CanBuild(): void {
		this.changeRenderOrder()
		const color = new THREE.Color(0x00ff00)

		this.model.traverse((child: THREE.Object3D) => {
			if ((child as any).isMesh) {
				const mesh = child as THREE.Mesh
				mesh.castShadow = false
				mesh.receiveShadow = false
				if (!Array.isArray(mesh.material)) {
					;(mesh.material as THREE.MeshStandardMaterial).color = color
					mesh.material.opacity = 0.2
				}
			}
		})
	}

	setAppearance_CantBuild(): void {
		this.changeRenderOrder()
		const color = new THREE.Color(0xff0000)

		this.model.traverse((child: THREE.Object3D) => {
			if ((child as any).isMesh) {
				const mesh = child as THREE.Mesh
				mesh.castShadow = false
				mesh.receiveShadow = false
				if (!Array.isArray(mesh.material)) {
					;(mesh.material as THREE.MeshStandardMaterial).color = color
					mesh.material.opacity = 0.4
				}
			}
		})
	}

	changeRenderOrder(): void {
		this.model.traverse((child: THREE.Object3D) => {
			if ((child as any).isMesh) {
				const mesh = child as THREE.Mesh
				if (!Array.isArray(mesh.material)) {
					mesh.material.transparent = true
				}
				if (mesh.userData.outline) {
					mesh.userData.outline.renderOrder = 1000
					mesh.userData.outline.material.depthTest = false
				}
			}
		})
	}
}
