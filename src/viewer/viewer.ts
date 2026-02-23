/**
 * Top-level Viewer API — creates a Three.js scene with camera, lights,
 * and a WorldRenderer for rendering Minecraft chunks.
 */

import * as THREE from "three";
import type { Vec3 } from "../vec3/index.js";
import type {
	BiomeTints,
	ResolvedBlockStates,
	TextureAtlas,
} from "./assets.js";
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
} from "./worldRenderer.js";

// ── Types ──

export type Viewer = {
	readonly scene: THREE.Scene;
	readonly camera: THREE.PerspectiveCamera;
	readonly renderer: THREE.WebGLRenderer;
	readonly worldRenderer: WorldRenderer;
};

export type ViewerOptions = {
	readonly numWorkers?: number;
	readonly workerUrl: string | URL;
};

// ── Lifecycle ──

export const createViewer = (
	canvas: HTMLCanvasElement,
	options: ViewerOptions,
): Viewer => {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(canvas.clientWidth, canvas.clientHeight);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x87ceeb);

	const ambientLight = new THREE.AmbientLight(0xcccccc);
	scene.add(ambientLight);

	const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
	directionalLight.position.set(1, 1, 0.5).normalize();
	scene.add(directionalLight);

	const aspect = canvas.clientWidth / canvas.clientHeight;
	const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

	const worldRenderer = createWorldRenderer(
		scene,
		options.workerUrl,
		options.numWorkers,
	);

	return { scene, camera, renderer, worldRenderer };
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

// ── Camera ──

export const setViewerCamera = (
	viewer: Viewer,
	pos: Vec3,
	yaw: number,
	pitch: number,
): void => {
	viewer.camera.position.set(pos.x, pos.y + 1.6, pos.z);
	viewer.camera.rotation.set(pitch, yaw, 0, "ZYX");
};

export const resizeViewer = (
	viewer: Viewer,
	width: number,
	height: number,
): void => {
	viewer.camera.aspect = width / height;
	viewer.camera.updateProjectionMatrix();
	viewer.renderer.setSize(width, height);
};

// ── Render loop ──

export const renderViewer = (viewer: Viewer): void => {
	viewer.renderer.render(viewer.scene, viewer.camera);
};

// ── Waiting ──

export const waitForViewerRender = (viewer: Viewer): Promise<void> => {
	return waitForRender(viewer.worldRenderer);
};

// ── Cleanup ──

export const disposeViewer = (viewer: Viewer): void => {
	disposeWorldRenderer(viewer.worldRenderer);
	viewer.renderer.dispose();
};
