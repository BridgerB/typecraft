import {
	Color3,
	Color4,
	Engine,
	FreeCamera,
	HemisphericLight,
	Mesh,
	Quaternion,
	Scene,
	StandardMaterial,
	Vector3,
	VertexData,
} from "@babylonjs/core";
import type { Vec3 } from "../vec3/index.ts";
import type {
	BiomeTints,
	ResolvedBlockStates,
	TextureAtlas,
} from "./assets.ts";
import {
	addEntity,
	clearEntities,
	createEntityRenderer,
	type EntityRenderer,
	removeEntity,
	updateEntity,
} from "./entityRenderer.ts";
import {
	addRendererColumn,
	createWorldRenderer,
	disposeWorldRenderer,
	removeRendererColumn,
	setRendererBlockStateId,
	setWorldRendererBlockStates,
	setWorldRendererTexture,
	setWorldRendererTints,
	setWorldRendererVersion,
	type WorldRenderer,
	waitForRender,
} from "./worldRenderer.ts";

// ── Types ──

export type Viewer = {
	readonly engine: Engine;
	readonly scene: Scene;
	readonly camera: FreeCamera;
	readonly light: HemisphericLight;
	readonly worldRenderer: WorldRenderer;
	readonly entityRenderer: EntityRenderer;
	readonly cloudMat: StandardMaterial;
};

export type ViewerOptions = {
	readonly numWorkers?: number;
	readonly workerUrl: string | URL;
	readonly textureUrl?: string;
};

// ── Lifecycle ──

export const createViewer = (
	canvas: HTMLCanvasElement,
	options: ViewerOptions,
): Viewer => {
	const engine = new Engine(canvas, false);
	engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
	engine.setSize(canvas.clientWidth, canvas.clientHeight);

	return createViewerScene(engine, options);
};

export const createViewerScene = (
	engine: Engine,
	options: ViewerOptions,
): Viewer => {
	const scene = new Scene(engine);
	scene.useRightHandedSystem = true;
	scene.clearColor = new Color4(0x87 / 255, 0xce / 255, 0xeb / 255, 1);

	scene.ambientColor = new Color3(1, 1, 1);

	const light = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
	light.intensity = 1.4;
	light.diffuse = new Color3(1, 1, 1);
	light.groundColor = new Color3(0.85, 0.85, 0.85);

	const camera = new FreeCamera("camera", Vector3.Zero(), scene);
	camera.fov = (75 * Math.PI) / 180;
	camera.minZ = 0.1;
	camera.maxZ = 1000;
	camera.inputs.clear();
	camera.detachControl();

	const worldRenderer = createWorldRenderer(
		scene,
		options.workerUrl,
		options.numWorkers,
	);

	const entityRenderer = createEntityRenderer(
		scene,
		options.textureUrl ?? "/textures/steve.png",
	);

	const cloudMat = addClouds(scene, camera);

	return { engine, scene, camera, light, worldRenderer, entityRenderer, cloudMat };
};

// ── Clouds — real vanilla pattern, extruded into thick 3D boxes at y=192 ──
// Reads Minecraft's actual clouds.png (256×256): each opaque pixel is a 12-block
// cloud cell, extruded 4 blocks tall (vanilla geometry). A patch around the
// camera is rebuilt only when the camera crosses a cell, so it's cheap.

const CLOUDS_URL =
	"https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures/environment/clouds.png";
const CLOUD_CELL = 12; // blocks per cloud pixel
const CLOUD_Y = 192; // vanilla cloud height
const CLOUD_THICK = 4; // vanilla cloud thickness
const CLOUD_PATCH = 40; // cells across the rendered patch (×12 ≈ 480 blocks)

const addClouds = (scene: Scene, camera: FreeCamera): StandardMaterial => {
	const mat = new StandardMaterial("cloudMat", scene);
	mat.diffuseColor = new Color3(0.95, 0.95, 0.97);
	mat.specularColor = new Color3(0, 0, 0);
	mat.emissiveColor = new Color3(0.12, 0.12, 0.14); // small floor → visible at night
	mat.backFaceCulling = false;

	let pattern: Uint8Array | null = null;
	let texSize = 0;
	let mesh: Mesh | null = null;
	let lastKey = "";

	const isCloud = (wx: number, wz: number): boolean => {
		if (!pattern) return false;
		const px = ((wx % texSize) + texSize) % texSize;
		const pz = ((wz % texSize) + texSize) % texSize;
		return pattern[pz * texSize + px] === 1;
	};

	const rebuild = (camCx: number, camCz: number): void => {
		if (!pattern) return;
		if (mesh) {
			mesh.dispose();
			mesh = null;
		}
		const positions: number[] = [];
		const indices: number[] = [];
		const normals: number[] = [];
		let vi = 0;
		const quad = (
			a: number[],
			b: number[],
			c: number[],
			d: number[],
			n: number[],
		): void => {
			positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!);
			for (let k = 0; k < 4; k++) normals.push(n[0]!, n[1]!, n[2]!);
			indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
			vi += 4;
		};
		const C = CLOUD_CELL;
		const yT = CLOUD_Y + CLOUD_THICK / 2;
		const yB = CLOUD_Y - CLOUD_THICK / 2;
		const half = Math.floor(CLOUD_PATCH / 2);
		// Emit a face only where it's on the OUTSIDE of the cloud mass → one solid
		// shape with no visible internal cell edges (vanilla "fancy" cloud hull).
		for (let i = 0; i < CLOUD_PATCH; i++) {
			for (let j = 0; j < CLOUD_PATCH; j++) {
				const wx = camCx - half + i;
				const wz = camCz - half + j;
				if (!isCloud(wx, wz)) continue;
				const x0 = wx * C;
				const x1 = x0 + C;
				const z0 = wz * C;
				const z1 = z0 + C;
				quad([x0, yT, z0], [x1, yT, z0], [x1, yT, z1], [x0, yT, z1], [0, 1, 0]);
				quad([x0, yB, z1], [x1, yB, z1], [x1, yB, z0], [x0, yB, z0], [0, -1, 0]);
				if (!isCloud(wx - 1, wz))
					quad([x0, yB, z0], [x0, yB, z1], [x0, yT, z1], [x0, yT, z0], [-1, 0, 0]);
				if (!isCloud(wx + 1, wz))
					quad([x1, yB, z1], [x1, yB, z0], [x1, yT, z0], [x1, yT, z1], [1, 0, 0]);
				if (!isCloud(wx, wz - 1))
					quad([x1, yB, z0], [x0, yB, z0], [x0, yT, z0], [x1, yT, z0], [0, 0, -1]);
				if (!isCloud(wx, wz + 1))
					quad([x0, yB, z1], [x1, yB, z1], [x1, yT, z1], [x0, yT, z1], [0, 0, 1]);
			}
		}
		if (indices.length === 0) return;
		const vd = new VertexData();
		vd.positions = positions;
		vd.indices = indices;
		vd.normals = normals;
		mesh = new Mesh("clouds", scene);
		vd.applyToMesh(mesh);
		mesh.material = mat;
		mesh.isPickable = false;
	};

	scene.onBeforeRenderObservable.add(() => {
		if (!pattern) return;
		const cx = Math.round(camera.position.x / CLOUD_CELL);
		const cz = Math.round(camera.position.z / CLOUD_CELL);
		const key = `${cx},${cz}`;
		if (key !== lastKey) {
			lastKey = key;
			rebuild(cx, cz);
		}
	});

	const img = new Image();
	img.crossOrigin = "anonymous";
	img.onload = () => {
		texSize = img.width;
		const cv = document.createElement("canvas");
		cv.width = texSize;
		cv.height = texSize;
		const c = cv.getContext("2d");
		if (!c) return;
		c.drawImage(img, 0, 0);
		const d = c.getImageData(0, 0, texSize, texSize).data;
		pattern = new Uint8Array(texSize * texSize);
		for (let k = 0; k < texSize * texSize; k++) {
			pattern[k] = (d[k * 4 + 3] ?? 0) > 128 ? 1 : 0; // alpha → cloud cell
		}
		lastKey = ""; // force first rebuild
	};
	img.src = CLOUDS_URL;

	return mat;
};

// ── Version & assets ──

export const setViewerVersion = (viewer: Viewer, version: string): void => {
	setWorldRendererVersion(viewer.worldRenderer, version);
};

export const setViewerAssets = (
	viewer: Viewer,
	atlas: TextureAtlas,
	blockStates: ResolvedBlockStates,
	tints: BiomeTints,
): void => {
	setWorldRendererTexture(viewer.worldRenderer, atlas);
	setWorldRendererBlockStates(viewer.worldRenderer, blockStates);
	setWorldRendererTints(viewer.worldRenderer, tints);
};

// ── Column management ──

export const addViewerColumn = (
	viewer: Viewer,
	chunkX: number,
	chunkZ: number,
	chunkData: unknown,
	minY: number,
	worldHeight: number,
): void => {
	addRendererColumn(
		viewer.worldRenderer,
		chunkX,
		chunkZ,
		chunkData,
		minY,
		worldHeight,
	);
};

export const removeViewerColumn = (
	viewer: Viewer,
	chunkX: number,
	chunkZ: number,
): void => {
	removeRendererColumn(viewer.worldRenderer, chunkX, chunkZ);
};

// ── Block updates ──

export const setViewerBlockStateId = (
	viewer: Viewer,
	pos: Vec3,
	stateId: number,
): void => {
	setRendererBlockStateId(viewer.worldRenderer, pos, stateId);
};

// ── Entities ──

export const addViewerEntity = (
	viewer: Viewer,
	id: number,
	entityName: string,
	username: string | null,
	x: number,
	y: number,
	z: number,
	yaw: number,
	skinUrl?: string,
): void =>
	addEntity(
		viewer.entityRenderer,
		id,
		entityName,
		username,
		x,
		y,
		z,
		yaw,
		skinUrl,
	);

export const updateViewerEntity = (
	viewer: Viewer,
	id: number,
	x: number,
	y: number,
	z: number,
	yaw: number,
): void => updateEntity(viewer.entityRenderer, id, x, y, z, yaw);

export const removeViewerEntity = (viewer: Viewer, id: number): void =>
	removeEntity(viewer.entityRenderer, id);

export const clearViewerEntities = (viewer: Viewer): void =>
	clearEntities(viewer.entityRenderer);

// ── Camera ──

export const setViewerCamera = (
	viewer: Viewer,
	pos: Vec3,
	yaw: number,
	pitch: number,
): void => {
	viewer.camera.position.set(pos.x, pos.y + 1.6, pos.z);
	viewer.camera.rotationQuaternion = Quaternion.RotationYawPitchRoll(
		yaw,
		pitch,
		0,
	);
};

export const resizeViewer = (
	viewer: Viewer,
	width: number,
	height: number,
): void => {
	viewer.engine.setSize(width, height);
};

// ── Day/night cycle ──

const DAY_SKY = new Color3(0x87 / 255, 0xce / 255, 0xeb / 255);
const NIGHT_SKY = new Color3(0x0c / 255, 0x14 / 255, 0x45 / 255);

export const setViewerTime = (viewer: Viewer, time: number): void => {
	const angle = (time / 24000 - 0.25) * 2 * Math.PI;
	const raw = Math.cos(angle); // 1 at noon, -1 at midnight
	// Full daylight across most of the day, quick twilight, dark at night (vanilla-ish).
	const day = Math.min(1, Math.max(0, (raw + 0.2) / 0.5));

	// Bright day, dark night.
	viewer.light.intensity = 0.3 + day * 1.15; // night ≈ 0.3, day ≈ 1.45

	const r = NIGHT_SKY.r + (DAY_SKY.r - NIGHT_SKY.r) * day;
	const g = NIGHT_SKY.g + (DAY_SKY.g - NIGHT_SKY.g) * day;
	const b = NIGHT_SKY.b + (DAY_SKY.b - NIGHT_SKY.b) * day;
	viewer.scene.clearColor = new Color4(r, g, b, 1);
};

// ── Render loop ──

export const renderViewer = (viewer: Viewer): void => {
	viewer.scene.render();
};

// ── Waiting ──

export const waitForViewerRender = (viewer: Viewer): Promise<void> =>
	waitForRender(viewer.worldRenderer);

// ── Cleanup ──

export const disposeViewer = (viewer: Viewer): void => {
	disposeWorldRenderer(viewer.worldRenderer);
	viewer.engine.dispose();
};
