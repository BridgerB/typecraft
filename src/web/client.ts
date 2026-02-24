/**
 * Browser entry point — connects to the Node.js WebSocket server,
 * receives chunk data and assets, renders the bot's perspective via src/viewer/.
 */

import {
	createChunkColumn,
	GLOBAL_BITS_PER_BIOME,
	GLOBAL_BITS_PER_BLOCK,
	loadChunkColumn,
} from "../chunk/index.ts";
import { vec3 } from "../vec3/index.ts";
import {
	type BiomeTints,
	createTextureAtlas,
	prepareBlockStates,
} from "../viewer/assets.ts";
import {
	addViewerColumn,
	addViewerEntity,
	clearViewerEntities,
	createViewer,
	removeViewerColumn,
	removeViewerEntity,
	renderViewer,
	resizeViewer,
	setViewerAssets,
	setViewerBlockStateId,
	setViewerCamera,
	setViewerTime,
	type Viewer,
	updateViewerEntity,
} from "../viewer/viewer.ts";

// ── Types for WS messages ──

type BlockDef = {
	name: string;
	transparent: boolean;
	boundingBox: string;
	minStateId: number;
	states?: { name: string; values?: string[] }[];
};

type BiomeDef = {
	id: number;
	name: string;
};

type InitMessage = {
	type: "init";
	version: string;
	minY: number;
	height: number;
};

type SerializedTints = {
	grass: Record<string, readonly [number, number, number]>;
	foliage: Record<string, readonly [number, number, number]>;
	water: Record<string, readonly [number, number, number]>;
	redstone: Record<string, readonly [number, number, number]>;
	constant: Record<string, readonly [number, number, number]>;
	grassDefault: readonly [number, number, number];
	foliageDefault: readonly [number, number, number];
	waterDefault: readonly [number, number, number];
};

type AssetsMessage = {
	type: "assets";
	blockStates: Record<string, unknown>;
	blockModels: Record<string, unknown>;
	textureNames: string[];
	textureData: Record<string, string>;
	tints: SerializedTints;
	blocks: BlockDef[];
	biomes: BiomeDef[];
};

type PositionMessage = {
	type: "position";
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
};

type ChunkMessage = {
	type: "chunk";
	x: number;
	z: number;
	buf: string;
};

type UnloadChunkMessage = {
	type: "unloadChunk";
	x: number;
	z: number;
};

type BlockUpdateMessage = {
	type: "blockUpdate";
	x: number;
	y: number;
	z: number;
	stateId: number;
};

type TimeMessage = {
	type: "time";
	time: number;
};

type EntitySpawnMessage = {
	type: "entitySpawn";
	id: number;
	username: string | null;
	skinUrl?: string;
	x: number;
	y: number;
	z: number;
	yaw: number;
};

type EntityMoveMessage = {
	type: "entityMove";
	id: number;
	x: number;
	y: number;
	z: number;
	yaw: number;
};

type EntityGoneMessage = {
	type: "entityGone";
	id: number;
};

type ServerMessage =
	| InitMessage
	| AssetsMessage
	| PositionMessage
	| ChunkMessage
	| UnloadChunkMessage
	| BlockUpdateMessage
	| TimeMessage
	| EntitySpawnMessage
	| EntityMoveMessage
	| EntityGoneMessage;

// ── State ──

let viewer: Viewer | null = null;
let assetsReady = false;
let minY = -64;
let worldHeight = 384;
let chunkCount = 0;
const pendingMessages: ServerMessage[] = [];

const statusEl = document.getElementById("status")!;
const canvas = document.getElementById("viewer") as HTMLCanvasElement;

const setStatus = (text: string) => {
	statusEl.textContent = text;
};

// ── Tint deserialization (plain objects → Maps) ──

const objToMap = (
	obj: Record<string, readonly [number, number, number]>,
): Map<string, readonly [number, number, number]> => {
	const m = new Map<string, readonly [number, number, number]>();
	for (const [k, v] of Object.entries(obj)) m.set(k, v);
	return m;
};

const deserializeTints = (raw: SerializedTints): BiomeTints => ({
	grass: objToMap(raw.grass),
	foliage: objToMap(raw.foliage),
	water: objToMap(raw.water),
	redstone: objToMap(raw.redstone),
	constant: objToMap(raw.constant),
	grassDefault: raw.grassDefault,
	foliageDefault: raw.foliageDefault,
	waterDefault: raw.waterDefault,
});

// ── Asset decoding ──

const decodeTextures = async (
	textureNames: string[],
	textureData: Record<string, string>,
): Promise<Map<string, ImageBitmap>> => {
	const images = new Map<string, ImageBitmap>();
	const promises: Promise<void>[] = [];

	for (const name of textureNames) {
		const b64 = textureData[name];
		if (!b64) continue;
		promises.push(
			fetch(`data:image/png;base64,${b64}`)
				.then((r) => r.blob())
				.then((blob) => createImageBitmap(blob))
				.then((bmp) => {
					images.set(name, bmp);
				}),
		);
	}

	await Promise.all(promises);
	return images;
};

// ── Message processing ──

const processMessage = (msg: ServerMessage): void => {
	if (msg.type === "position") {
		if (!viewer) return;
		setViewerCamera(viewer, vec3(msg.x, msg.y, msg.z), msg.yaw, msg.pitch);
	} else if (msg.type === "chunk") {
		if (!viewer) return;
		const raw = Buffer.from(msg.buf, "base64");
		const col = createChunkColumn({
			minY,
			worldHeight,
			maxBitsPerBlock: GLOBAL_BITS_PER_BLOCK,
			maxBitsPerBiome: GLOBAL_BITS_PER_BIOME,
		});
		loadChunkColumn(col, raw, true);
		addViewerColumn(viewer, msg.x, msg.z, col, minY, worldHeight);
		chunkCount++;
		setStatus(`Chunks: ${chunkCount}`);
	} else if (msg.type === "unloadChunk") {
		if (!viewer) return;
		removeViewerColumn(viewer, msg.x, msg.z);
		chunkCount--;
		setStatus(`Chunks: ${chunkCount}`);
	} else if (msg.type === "blockUpdate") {
		if (!viewer) return;
		setViewerBlockStateId(viewer, vec3(msg.x, msg.y, msg.z), msg.stateId);
	} else if (msg.type === "time") {
		if (!viewer) return;
		setViewerTime(viewer, msg.time);
	} else if (msg.type === "entitySpawn") {
		if (!viewer) return;
		addViewerEntity(viewer, msg.id, msg.username, msg.x, msg.y, msg.z, msg.yaw, msg.skinUrl);
	} else if (msg.type === "entityMove") {
		if (!viewer) return;
		updateViewerEntity(viewer, msg.id, msg.x, msg.y, msg.z, msg.yaw);
	} else if (msg.type === "entityGone") {
		if (!viewer) return;
		removeViewerEntity(viewer, msg.id);
	}
};

// ── WebSocket connection ──

const connect = () => {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const ws = new WebSocket(`${protocol}//${location.host}`);
	assetsReady = false;
	chunkCount = 0;
	pendingMessages.length = 0;
	if (viewer) clearViewerEntities(viewer);

	ws.onopen = () => setStatus("Connected, waiting for assets...");

	ws.onmessage = async (event) => {
		const msg: ServerMessage = JSON.parse(event.data as string);

		if (msg.type === "init") {
			minY = msg.minY;
			worldHeight = msg.height;

			if (!viewer) {
				canvas.width = window.innerWidth;
				canvas.height = window.innerHeight;
				viewer = createViewer(canvas, { workerUrl: "/web/clientWorker.js" });
			}

			setStatus("Waiting for assets...");
		} else if (msg.type === "assets") {
			if (!viewer) return;

			setStatus("Decoding textures...");
			const images = await decodeTextures(msg.textureNames, msg.textureData);

			const atlas = createTextureAtlas(msg.textureNames, (name) => {
				const clean = name.replace(".png", "");
				return images.get(clean)!;
			});

			const blockStates = prepareBlockStates(
				msg.blockStates,
				msg.blockModels as Parameters<typeof prepareBlockStates>[1],
				atlas.uvMap,
			);

			// Send registry data to workers (custom message for browser worker)
			for (const worker of viewer.worldRenderer.workers) {
				worker.postMessage({
					type: "registryData",
					blocks: msg.blocks,
					biomes: msg.biomes,
				});
			}

			setViewerAssets(viewer, atlas, blockStates, deserializeTints(msg.tints));
			assetsReady = true;

			// Replay messages that arrived during async texture decoding
			setStatus(`Processing ${pendingMessages.length} queued chunks...`);
			for (const queued of pendingMessages) {
				processMessage(queued);
			}
			pendingMessages.length = 0;
		} else if (!assetsReady) {
			// Buffer messages until workers are initialized
			pendingMessages.push(msg);
		} else {
			processMessage(msg);
		}
	};

	ws.onclose = () => {
		setStatus("Disconnected. Reconnecting in 3s...");
		setTimeout(connect, 3000);
	};

	ws.onerror = () => ws.close();
};

// ── Render loop ──

const loop = () => {
	if (viewer) renderViewer(viewer);
	requestAnimationFrame(loop);
};

// ── Resize ──

window.addEventListener("resize", () => {
	if (!viewer) return;
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	resizeViewer(viewer, window.innerWidth, window.innerHeight);
});

// ── Debug ──

(window as unknown as Record<string, unknown>)._getViewer = () => viewer;

// ── Start ──

connect();
requestAnimationFrame(loop);
