import {
	Color3,
	Color4,
	Engine,
	FreeCamera,
	HemisphericLight,
	Quaternion,
	Scene,
	Vector3,
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
	light.intensity = 1.0;
	light.diffuse = new Color3(1, 1, 1);
	light.groundColor = new Color3(1, 1, 1);

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

	return { engine, scene, camera, light, worldRenderer, entityRenderer };
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
	const raw = Math.cos(angle);
	const brightness = Math.max(0.15, raw * 0.5 + 0.5);

	viewer.light.intensity = brightness;

	const r = NIGHT_SKY.r + (DAY_SKY.r - NIGHT_SKY.r) * brightness;
	const g = NIGHT_SKY.g + (DAY_SKY.g - NIGHT_SKY.g) * brightness;
	const b = NIGHT_SKY.b + (DAY_SKY.b - NIGHT_SKY.b) * brightness;
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
