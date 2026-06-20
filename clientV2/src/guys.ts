import * as THREE from "three"

// Define color constants
//const p1BuilderColor = 0x307c91;
//const p2BuilderColor = 0xb83232;
//const p1KnightColor = 0x2c3e91;
//const p2KnightColor = 0x800000;

// Define interfaces for the expected scene structure
interface GameScene {
	modelsDict: {
		knight_idle: THREE.Object3D[]
		worker: THREE.Object3D[]
	}
}

// Extend THREE.Object3D to allow `unit` property on meshes
interface MeshWithUnit extends THREE.Mesh {
	unit?: Unit
}

class Unit {
	id: number
	pId: number
	isSelectable?: boolean
	isMoveable?: boolean
	entityId?: number
	height: number
	model: THREE.Object3D
	mesh: THREE.Object3D
	halo: THREE.Mesh

	constructor(
		id: number,
		height: number,
		//color: number,
		pId: number,
		knight: boolean,
		scene: GameScene
	) {
		this.id = id
		this.pId = pId
		this.height = height

		if (knight) {
			this.model = scene.modelsDict.knight_idle[this.pId - 1].clone()
		} else {
			this.model = scene.modelsDict.worker[this.pId - 1].clone()
		}

		this.model.traverse((child: THREE.Object3D) => {
			if ((child as THREE.Mesh).isMesh) {
				const mesh = child as MeshWithUnit
				mesh.material = (mesh.material as THREE.Material).clone()
				mesh.receiveShadow = true
				mesh.unit = this
			}
		})

		// Create halo ring
		const haloGeometry = new THREE.RingGeometry(0.1, 0.2, 32)
		const haloMaterial = new THREE.MeshLambertMaterial({
			color: 0xffff00,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.4,
		})

		const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial)
		haloMesh.rotation.x = -Math.PI
		haloMesh.position.y = 0.1
		haloMesh.position.z -= 0.1
		haloMesh.visible = false

		this.halo = haloMesh
		this.model.add(haloMesh)
		this.mesh = this.model
	}
}

export class Knight extends Unit {
	constructor(id: number, playerId: number, scene: GameScene) {
		//const color = playerId === 1 ? p1KnightColor : p2KnightColor;
		super(id, 0.5, playerId, true, scene)
	}
}

export class Builder extends Unit {
	constructor(id: number, playerId: number, scene: GameScene) {
		//const color = playerId === 1 ? p1BuilderColor : p2BuilderColor;
		super(id, 0.25, playerId, false, scene)
	}
}
