/**
 * Entity renderer — builds proper Steve-model player meshes using
 * Bedrock geometry format (bones + UV-mapped cubes) and the Steve skin texture.
 */

import * as THREE from "three";

// ── Player geometry (from upstream entities.json "player" default) ──

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
): void => {
	for (const face of FACES) {
		const ndx = geo.positions.length / 3;
		const inflate = cube.inflate ?? 0;

		for (const corner of face.corners) {
			const u = (cube.uv[0] + dot3(corner[3] ? face.u1 : face.u0, cube.size)) / TEX_W;
			const v = (cube.uv[1] + dot3(corner[4] ? face.v1 : face.v0, cube.size)) / TEX_H;

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

const buildPlayerGeometry = (): THREE.BufferGeometry => {
	const geo: GeoData = { positions: [], normals: [], uvs: [], indices: [], skinIndices: [], skinWeights: [] };
	const boneMap = new Map<string, { idx: number; pos: THREE.Vector3; rot: THREE.Euler }>();

	let idx = 0;
	for (const bone of PLAYER_BONES) {
		const pos = bone.pivot
			? new THREE.Vector3(bone.pivot[0], bone.pivot[1], bone.pivot[2])
			: new THREE.Vector3();
		const rot = new THREE.Euler(0, 0, 0);
		boneMap.set(bone.name, { idx, pos, rot });

		if (bone.cubes) {
			for (const cube of bone.cubes) {
				addCube(geo, idx, pos, rot, cube);
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

const buildPlayerSkeleton = (): { skeleton: THREE.Skeleton; rootBones: THREE.Bone[] } => {
	const boneMap = new Map<string, THREE.Bone>();
	const pivotMap = new Map<string, THREE.Vector3>();
	const rootBones: THREE.Bone[] = [];

	for (const def of PLAYER_BONES) {
		const bone = new THREE.Bone();
		const pivot = def.pivot
			? new THREE.Vector3(def.pivot[0], def.pivot[1], def.pivot[2])
			: new THREE.Vector3();
		pivotMap.set(def.name, pivot);
		boneMap.set(def.name, bone);
	}

	// Use positions relative to parent so rotation pivots are correct
	for (const def of PLAYER_BONES) {
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

// ── Animation ──

// Bone indices in PLAYER_BONES array
const BONE_LEFT_ARM = 5;
const BONE_RIGHT_ARM = 7;
const BONE_LEFT_LEG = 9;
const BONE_RIGHT_LEG = 11;

type AnimState = {
	skeleton: THREE.Skeleton;
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
	username: string | null,
	x: number,
	y: number,
	z: number,
	yaw: number,
	skinUrl?: string,
): void => {
	if (er.entities.has(id)) removeEntity(er, id);

	const group = new THREE.Group();

	// Use per-player material if skin URL provided, otherwise shared Steve material
	const material = skinUrl
		? new THREE.MeshLambertMaterial({ transparent: true, alphaTest: 0.1 })
		: er.material;
	if (skinUrl) loadSkinTexture(skinUrl, material);

	// Build skinned mesh
	const { skeleton, rootBones } = buildPlayerSkeleton();
	const mesh = new THREE.SkinnedMesh(er.geometry, material);
	mesh.add(...rootBones);
	mesh.bind(skeleton);
	// Bedrock geometry is 32px tall (2 blocks at 1/16). Real Steve is 1.8 blocks.
	// Scale factor: 1.8/32 = 0.05625
	const s = 1.8 / 32;
	mesh.scale.set(s, s, s);
	group.add(mesh);

	// Username label
	if (username) {
		const label = createTextSprite(username);
		label.position.y = 2.1;
		group.add(label);
	}

	group.position.set(x, y, z);
	group.rotation.y = yaw;

	er.scene.add(group);
	er.entities.set(id, group);
	er.animStates.set(id, { skeleton, lastX: x, lastZ: z, distanceMoved: 0 });
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

	// Walk animation
	const anim = er.animStates.get(id);
	if (!anim) return;

	const dx = x - anim.lastX;
	const dz = z - anim.lastZ;
	const dist = Math.sqrt(dx * dx + dz * dz);
	anim.lastX = x;
	anim.lastZ = z;

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
			// Dispose per-player material (not the shared Steve one)
			if (child.material !== er.material) {
				(child.material as THREE.MeshLambertMaterial).map?.dispose();
				(child.material as THREE.MeshLambertMaterial).dispose();
			}
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
