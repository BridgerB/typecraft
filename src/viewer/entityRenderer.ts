/**
 * Entity renderer — builds Bedrock-format entity meshes (bones + UV-mapped cubes).
 * Supports all entity types from entities.json, with Steve-model players as a special case.
 */

import * as THREE from "three";

// ── Bedrock geometry types ──

type Cube = {
	readonly origin: readonly [number, number, number];
	readonly size: readonly [number, number, number];
	readonly uv: readonly [number, number];
	readonly inflate?: number;
};

type Bone = {
	readonly name: string;
	readonly parent?: string;
	readonly pivot?: readonly [number, number, number];
	readonly cubes?: readonly Cube[];
};

// ── Entity model definitions (populated by setEntityModels) ──

export type EntityModelDef = {
	readonly texturewidth: number;
	readonly textureheight: number;
	readonly bones: readonly Bone[];
};

let entityModels: Record<string, EntityModelDef> = {};

export const setEntityModels = (data: Record<string, EntityModelDef>): void => {
	entityModels = data;
};

const getEntityModel = (name: string): EntityModelDef | null =>
	entityModels[name] ?? null;

const PLAYER_BONES: readonly Bone[] = [
	{ name: "root", pivot: [0, 0, 0] },
	{ name: "waist", parent: "root", pivot: [0, 12, 0] },
	{ name: "body", parent: "waist", pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
	{ name: "head", parent: "body", pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] },
	{ name: "hat", parent: "head", pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }] },
	{ name: "leftArm", parent: "body", pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }] },
	{ name: "leftSleeve", parent: "leftArm", pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25 }] },
	{ name: "rightArm", parent: "body", pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
	{ name: "rightSleeve", parent: "rightArm", pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 32], inflate: 0.25 }] },
	{ name: "leftLeg", parent: "root", pivot: [1.9, 12, 0], cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [16, 48] }] },
	{ name: "leftPants", parent: "leftLeg", pivot: [1.9, 12, 0], cubes: [{ origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 }] },
	{ name: "rightLeg", parent: "root", pivot: [-1.9, 12, 0], cubes: [{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] }] },
	{ name: "rightPants", parent: "rightLeg", pivot: [-1.9, 12, 0], cubes: [{ origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 }] },
	{ name: "jacket", parent: "body", pivot: [0, 24, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 }] },
];

const TEX_W = 64;
const TEX_H = 64;

// ── Face definitions for box geometry (Bedrock format UV layout) ──

type FaceDef = {
	readonly corners: readonly (readonly [number, number, number, number, number])[];
	readonly u0: readonly [number, number, number];
	readonly v0: readonly [number, number, number];
	readonly u1: readonly [number, number, number];
	readonly v1: readonly [number, number, number];
	readonly dir: readonly [number, number, number];
};

const FACES: readonly FaceDef[] = [
	{ dir: [0, 1, 0], u0: [0, 0, 1], v0: [0, 0, 0], u1: [1, 0, 1], v1: [0, 0, 1], corners: [[0, 1, 1, 0, 0], [1, 1, 1, 1, 0], [0, 1, 0, 0, 1], [1, 1, 0, 1, 1]] },
	{ dir: [0, -1, 0], u0: [1, 0, 1], v0: [0, 0, 0], u1: [2, 0, 1], v1: [0, 0, 1], corners: [[1, 0, 1, 0, 0], [0, 0, 1, 1, 0], [1, 0, 0, 0, 1], [0, 0, 0, 1, 1]] },
	{ dir: [1, 0, 0], u0: [0, 0, 0], v0: [0, 0, 1], u1: [0, 0, 1], v1: [0, 1, 1], corners: [[1, 1, 1, 0, 0], [1, 0, 1, 0, 1], [1, 1, 0, 1, 0], [1, 0, 0, 1, 1]] },
	{ dir: [-1, 0, 0], u0: [1, 0, 1], v0: [0, 0, 1], u1: [1, 0, 2], v1: [0, 1, 1], corners: [[0, 1, 0, 0, 0], [0, 0, 0, 0, 1], [0, 1, 1, 1, 0], [0, 0, 1, 1, 1]] },
	{ dir: [0, 0, -1], u0: [0, 0, 1], v0: [0, 0, 1], u1: [1, 0, 1], v1: [0, 1, 1], corners: [[1, 0, 0, 0, 1], [0, 0, 0, 1, 1], [1, 1, 0, 0, 0], [0, 1, 0, 1, 0]] },
	{ dir: [0, 0, 1], u0: [1, 0, 2], v0: [0, 0, 1], u1: [2, 0, 2], v1: [0, 1, 1], corners: [[0, 0, 1, 0, 1], [1, 0, 1, 1, 1], [0, 1, 1, 0, 0], [1, 1, 1, 1, 0]] },
];

const dot3 = (a: readonly [number, number, number], b: readonly [number, number, number]): number =>
	a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── Geometry building ──

type GeoData = {
	positions: number[];
	normals: number[];
	uvs: number[];
	indices: number[];
	skinIndices: number[];
	skinWeights: number[];
};

const addCube = (
	geo: GeoData,
	boneId: number,
	bonePos: THREE.Vector3,
	boneRot: THREE.Euler,
	cube: Cube,
	texW: number,
	texH: number,
): void => {
	for (const face of FACES) {
		const ndx = geo.positions.length / 3;
		const inflate = cube.inflate ?? 0;

		for (const corner of face.corners) {
			const u = (cube.uv[0] + dot3(corner[3] ? face.u1 : face.u0, cube.size)) / texW;
			const v = (cube.uv[1] + dot3(corner[4] ? face.v1 : face.v0, cube.size)) / texH;

			const p = new THREE.Vector3(
				cube.origin[0] + corner[0] * cube.size[0] + (corner[0] ? inflate : -inflate),
				cube.origin[1] + corner[1] * cube.size[1] + (corner[1] ? inflate : -inflate),
				cube.origin[2] + corner[2] * cube.size[2] + (corner[2] ? inflate : -inflate),
			);

			// Transform to bone-local space
			p.sub(bonePos).applyEuler(boneRot).add(bonePos);

			geo.positions.push(p.x, p.y, p.z);
			geo.normals.push(face.dir[0], face.dir[1], face.dir[2]);
			geo.uvs.push(u, v);
			geo.skinIndices.push(boneId, 0, 0, 0);
			geo.skinWeights.push(1, 0, 0, 0);
		}

		geo.indices.push(ndx, ndx + 1, ndx + 2, ndx + 2, ndx + 1, ndx + 3);
	}
};

const buildEntityGeometry = (bones: readonly Bone[], texW: number, texH: number): THREE.BufferGeometry => {
	const geo: GeoData = { positions: [], normals: [], uvs: [], indices: [], skinIndices: [], skinWeights: [] };
	const boneMap = new Map<string, { idx: number; pos: THREE.Vector3; rot: THREE.Euler }>();

	let idx = 0;
	for (const bone of bones) {
		const pos = bone.pivot
			? new THREE.Vector3(bone.pivot[0], bone.pivot[1], bone.pivot[2])
			: new THREE.Vector3();
		const rot = new THREE.Euler(0, 0, 0);
		boneMap.set(bone.name, { idx, pos, rot });

		if (bone.cubes) {
			for (const cube of bone.cubes) {
				addCube(geo, idx, pos, rot, cube, texW, texH);
			}
		}
		idx++;
	}

	const bufGeo = new THREE.BufferGeometry();
	bufGeo.setAttribute("position", new THREE.Float32BufferAttribute(geo.positions, 3));
	bufGeo.setAttribute("normal", new THREE.Float32BufferAttribute(geo.normals, 3));
	bufGeo.setAttribute("uv", new THREE.Float32BufferAttribute(geo.uvs, 2));
	bufGeo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(geo.skinIndices, 4));
	bufGeo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(geo.skinWeights, 4));
	bufGeo.setIndex(geo.indices);
	return bufGeo;
};

const buildPlayerGeometry = (): THREE.BufferGeometry =>
	buildEntityGeometry(PLAYER_BONES, TEX_W, TEX_H);

const buildEntitySkeleton = (bones: readonly Bone[]): { skeleton: THREE.Skeleton; rootBones: THREE.Bone[] } => {
	const boneMap = new Map<string, THREE.Bone>();
	const pivotMap = new Map<string, THREE.Vector3>();
	const rootBones: THREE.Bone[] = [];

	for (const def of bones) {
		const bone = new THREE.Bone();
		const pivot = def.pivot
			? new THREE.Vector3(def.pivot[0], def.pivot[1], def.pivot[2])
			: new THREE.Vector3();
		pivotMap.set(def.name, pivot);
		boneMap.set(def.name, bone);
	}

	// Use positions relative to parent so rotation pivots are correct
	for (const def of bones) {
		const bone = boneMap.get(def.name)!;
		const pivot = pivotMap.get(def.name)!;
		if (def.parent) {
			const parentPivot = pivotMap.get(def.parent)!;
			bone.position.copy(pivot).sub(parentPivot);
			boneMap.get(def.parent)!.add(bone);
		} else {
			bone.position.copy(pivot);
			rootBones.push(bone);
		}
	}

	return { skeleton: new THREE.Skeleton([...boneMap.values()]), rootBones };
};

const buildPlayerSkeleton = (): { skeleton: THREE.Skeleton; rootBones: THREE.Bone[] } =>
	buildEntitySkeleton(PLAYER_BONES);

// ── Animation ──

// Bone indices in PLAYER_BONES array (used for player walk animation)
const BONE_LEFT_ARM = 5;
const BONE_RIGHT_ARM = 7;
const BONE_LEFT_LEG = 9;
const BONE_RIGHT_LEG = 11;

type AnimState = {
	skeleton: THREE.Skeleton;
	isPlayer: boolean;
	lastX: number;
	lastZ: number;
	distanceMoved: number;
};

// ── Public API ──

export type EntityRenderer = {
	readonly scene: THREE.Scene;
	readonly entities: Map<number, THREE.Group>;
	readonly animStates: Map<number, AnimState>;
	readonly geometry: THREE.BufferGeometry;
	readonly material: THREE.MeshLambertMaterial;
};

export const createEntityRenderer = (scene: THREE.Scene, textureUrl: string): EntityRenderer => {
	const geometry = buildPlayerGeometry();
	const material = new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.1 });

	// Load Steve texture
	new THREE.TextureLoader().load(textureUrl, (tex) => {
		tex.magFilter = THREE.NearestFilter;
		tex.minFilter = THREE.NearestFilter;
		tex.flipY = false;
		material.map = tex;
		material.needsUpdate = true;
	});

	return { scene, entities: new Map(), animStates: new Map(), geometry, material };
};

const loadSkinTexture = (url: string, material: THREE.MeshLambertMaterial): void => {
	const loader = new THREE.TextureLoader();
	loader.crossOrigin = "anonymous";
	loader.load(url, (tex) => {
		tex.magFilter = THREE.NearestFilter;
		tex.minFilter = THREE.NearestFilter;
		tex.flipY = false;
		material.map = tex;
		material.needsUpdate = true;
	});
};

export const addEntity = (
	er: EntityRenderer,
	id: number,
	entityName: string,
	username: string | null,
	x: number,
	y: number,
	z: number,
	yaw: number,
	skinUrl?: string,
): void => {
	if (er.entities.has(id)) removeEntity(er, id);

	const group = new THREE.Group();

	let geometry: THREE.BufferGeometry;
	let skeletonResult: { skeleton: THREE.Skeleton; rootBones: THREE.Bone[] };
	let scale: number;

	if (entityName === "player") {
		geometry = er.geometry; // shared player geometry
		skeletonResult = buildPlayerSkeleton();
		// Bedrock geometry is 32px tall (2 blocks at 1/16). Real Steve is 1.8 blocks.
		scale = 1.8 / 32;
	} else {
		const model = getEntityModel(entityName);
		if (model) {
			geometry = buildEntityGeometry(model.bones, model.texturewidth, model.textureheight);
			skeletonResult = buildEntitySkeleton(model.bones);
			// Bedrock geometry uses 1/16 scale (pixels to blocks)
			scale = 1 / 16;
		} else {
			// Fallback: colored box for unknown entities
			const boxGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
			const boxMat = new THREE.MeshLambertMaterial({ color: 0xff6600 });
			const box = new THREE.Mesh(boxGeo, boxMat);
			box.position.y = 0.25;
			group.add(box);
			group.position.set(x, y, z);
			group.rotation.y = yaw;
			er.scene.add(group);
			er.entities.set(id, group);
			return;
		}
	}

	// Use per-entity material when a skin/texture URL is provided, otherwise shared Steve for players
	const material = skinUrl
		? new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.1 })
		: entityName === "player"
			? er.material
			: new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.1 });
	if (skinUrl) loadSkinTexture(skinUrl, material);

	// Build skinned mesh
	const mesh = new THREE.SkinnedMesh(geometry, material);
	mesh.add(...skeletonResult.rootBones);
	mesh.bind(skeletonResult.skeleton);
	mesh.scale.set(scale, scale, scale);
	group.add(mesh);

	// Username label (players only)
	if (username) {
		const label = createTextSprite(username);
		label.position.y = 2.1;
		group.add(label);
	}

	group.position.set(x, y, z);
	group.rotation.y = yaw;

	er.scene.add(group);
	er.entities.set(id, group);
	er.animStates.set(id, { skeleton: skeletonResult.skeleton, isPlayer: entityName === "player", lastX: x, lastZ: z, distanceMoved: 0 });
};

export const updateEntity = (
	er: EntityRenderer,
	id: number,
	x: number,
	y: number,
	z: number,
	yaw: number,
): void => {
	const group = er.entities.get(id);
	if (!group) return;
	group.position.set(x, y, z);
	group.rotation.y = yaw;

	// Walk animation (player entities only)
	const anim = er.animStates.get(id);
	if (!anim) return;

	const dx = x - anim.lastX;
	const dz = z - anim.lastZ;
	const dist = Math.sqrt(dx * dx + dz * dz);
	anim.lastX = x;
	anim.lastZ = z;

	if (!anim.isPlayer) return;

	if (dist > 0.001 && dist < 1) {
		// Accumulate distance and compute swing
		anim.distanceMoved += dist;
		const speed = Math.min(dist * 20, 1); // scale by ~tick rate, cap at 1
		const tcos0 = Math.cos(anim.distanceMoved * 38.17) * speed * 57.3;
		const rad = tcos0 * (Math.PI / 180);

		anim.skeleton.bones[BONE_LEFT_ARM]!.rotation.x = rad;
		anim.skeleton.bones[BONE_RIGHT_ARM]!.rotation.x = -rad;
		anim.skeleton.bones[BONE_LEFT_LEG]!.rotation.x = -rad * 1.4;
		anim.skeleton.bones[BONE_RIGHT_LEG]!.rotation.x = rad * 1.4;
	} else {
		// Standing still — reset to bind pose
		anim.skeleton.bones[BONE_LEFT_ARM]!.rotation.x = 0;
		anim.skeleton.bones[BONE_RIGHT_ARM]!.rotation.x = 0;
		anim.skeleton.bones[BONE_LEFT_LEG]!.rotation.x = 0;
		anim.skeleton.bones[BONE_RIGHT_LEG]!.rotation.x = 0;
	}
};

export const removeEntity = (er: EntityRenderer, id: number): void => {
	const group = er.entities.get(id);
	if (!group) return;
	er.scene.remove(group);
	for (const child of group.children) {
		if (child instanceof THREE.SkinnedMesh) {
			child.skeleton.dispose();
			// Dispose per-entity geometry (not the shared player one)
			if (child.geometry !== er.geometry) child.geometry.dispose();
			// Dispose per-entity material (not the shared Steve one)
			if (child.material !== er.material) {
				(child.material as THREE.MeshLambertMaterial).map?.dispose();
				(child.material as THREE.MeshLambertMaterial).dispose();
			}
		} else if (child instanceof THREE.Mesh) {
			// Fallback box or other plain meshes
			child.geometry.dispose();
			(child.material as THREE.MeshLambertMaterial).dispose();
		}
		if (child instanceof THREE.Sprite) {
			child.material.map?.dispose();
			child.material.dispose();
		}
	}
	er.entities.delete(id);
	er.animStates.delete(id);
};

export const clearEntities = (er: EntityRenderer): void => {
	for (const id of er.entities.keys()) {
		removeEntity(er, id);
	}
};

// ── Text sprite ──

const createTextSprite = (text: string): THREE.Sprite => {
	const canvas = new OffscreenCanvas(256, 64);
	const ctx = canvas.getContext("2d")!;

	ctx.font = "bold 32px monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const metrics = ctx.measureText(text);
	const pad = 10;
	const w = metrics.width + pad * 2;
	const h = 40;
	const cx = 128;
	const cy = 32;
	ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
	ctx.roundRect(cx - w / 2, cy - h / 2, w, h, 6);
	ctx.fill();

	ctx.fillStyle = "#ffffff";
	ctx.fillText(text, cx, cy);

	const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;

	const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(3, 0.75, 1);

	return sprite;
};
