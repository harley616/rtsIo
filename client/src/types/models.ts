import * as THREE from "three";

export type BuildingType = "house" | "townhall" | "barracks" | "gold" | "stone" | "wood";

export interface ModelsDict {
	house?: THREE.Object3D[];
	townhall?: THREE.Object3D[];
	barracks?: THREE.Object3D[];
	gold?: THREE.Object3D;
	stone?: THREE.Object3D;
	wood?: THREE.Object3D;
	knight_attack?: THREE.Object3D[]; // TODO: make these types more fleshed out, include limbs, attachments, etc
	knight_idle?: THREE.Object3D[];
	worker?: THREE.Object3D[];
}


