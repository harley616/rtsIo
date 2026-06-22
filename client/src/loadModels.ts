import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { ModelsDict } from "./types/models"

// Loads every GLB the renderer needs and returns the populated ModelsDict.
// Shared by the game entry (index.ts) and the map editor (editor/editor.ts) so
// neither has to duplicate the asset list or run the other's side effects.
export async function loadModels(): Promise<ModelsDict> {
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
