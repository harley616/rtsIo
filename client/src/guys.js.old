import * as THREE from "three"

const p1BuilderColor = 0x307c91
const p2BuilderColor = 0xb83232
const p1KnightColor = 0x2c3e91
const p2KnightColor = 0x800000

class Unit {
	constructor(id, height, color, pId, knight, scene) {
		this.id = id
		this.pId = pId;
		this.height = height

		if(knight) {
			this.model = scene.modelsDict.knight_idle[this.pId - 1].clone()

			this.model.traverse((child) => {
				if (child.isMesh) {
					child.material = child.material.clone()
					child.receiveShadow = true

					child.unit = this;
				}
			});

			this.mesh = this.model;
		} else {
			this.model = scene.modelsDict.worker[this.pId - 1].clone()
			this.model.traverse((child) => {
				if (child.isMesh) {
					child.material = child.material.clone()
					child.receiveShadow = true

					child.unit = this;
				}
			});

			
		}

		const haloInnerRadius = 0.1;
		const haloOuterRadius = 0.2;
		const haloSegments = 32;
		const haloGeometry = new THREE.RingGeometry(haloInnerRadius, haloOuterRadius, haloSegments);
		// Use a basic material with transparency.
		const haloMaterial = new THREE.MeshLambertMaterial({
			color: 0xffff00,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.4,
		});
		const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
		// Rotate the halo so that it lies flat (facing upward).
		haloMesh.rotation.x = -Math.PI;
		// Position it at y=0.1 (or y=0 if that's what you prefer).
		haloMesh.position.y = 0.1;
		haloMesh.position.z -= 0.1;
		// Initially, you might want it hidden.
		haloMesh.visible = false;
		this.halo = haloMesh;

		// Attach the halo to the unit's mesh.
		this.model.add(haloMesh);

		this.mesh = this.model;
	}
}

export class Knight extends Unit {
	constructor(id, playerId, scene) {
		if (playerId == 1) {
			super(id, 0.5, p1KnightColor, playerId, true, scene)
		}
		if (playerId == 2) {
			super(id, 0.5, p2KnightColor, playerId, true, scene)
		}
	}
}

export class Builder extends Unit {
	constructor(id, playerId, scene) {
		if (playerId == 1) {
			super(id, 0.25, p1BuilderColor, playerId, false, scene)
		}
		if (playerId == 2) {
			super(id, 0.25, p2BuilderColor, playerId, false, scene)
		}
	}
}
