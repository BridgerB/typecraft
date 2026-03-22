/**
 * Dashboard browser client — renders multiple bots in a grid using a single
 * Three.js WebGLRenderer with viewport/scissor per cell.
 */

import * as THREE from "three";
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
import { type EntityModelDef, setEntityModels, updateEntityEquipment } from "../viewer/entityRenderer.ts";
import {
	addViewerColumn,
	addViewerEntity,
	createViewerScene,
	removeViewerColumn,
	removeViewerEntity,
	setViewerAssets,
	setViewerBlockStateId,
	setViewerCamera,
	setViewerTime,
	type Viewer,
	updateViewerEntity,
} from "../viewer/viewer.ts";

// ── Types ──

type BotCell = {
	name: string;
	viewer: Viewer;
	minY: number;
	worldHeight: number;
	assetsReady: boolean;
	pending: unknown[];
};

// ── State ──

const canvas = document.getElementById("dashboard") as HTMLCanvasElement;
const labelsDiv = document.getElementById("labels")!;
const statusEl = document.getElementById("status")!;

// Single shared renderer — no devicePixelRatio (20 viewports don't need retina)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight, true);

const cells = new Map<string, BotCell>();
let botOrder: string[] = [];

// Shared assets
let sharedAtlas: ReturnType<typeof createTextureAtlas> | null = null;
let sharedBlockStates: ReturnType<typeof prepareBlockStates> | null = null;
let sharedTints: BiomeTints | null = null;
let sharedBlocks: unknown[] = [];
let sharedBiomes: unknown[] = [];
let assetsDecoded = false;

// ── Grid layout ──

const getGrid = () => {
	const n = botOrder.length || 1;
	const cols = Math.ceil(Math.sqrt(n));
	const rows = Math.ceil(n / cols);
	return { cols, rows };
};

// ── Label management ──

const updateLabels = () => {
	labelsDiv.innerHTML = "";
	const { cols, rows } = getGrid();
	const cellW = canvas.clientWidth / cols;
	const cellH = canvas.clientHeight / rows;

	for (let i = 0; i < botOrder.length; i++) {
		const name = botOrder[i];
		const col = i % cols;
		const row = Math.floor(i / cols);
		const label = document.createElement("div");
		label.className = "bot-label";
		label.textContent = name;
		label.style.left = `${col * cellW + 4}px`;
		label.style.top = `${row * cellH + 4}px`;
		labelsDiv.appendChild(label);
	}
};

// ── Texture decoding ──

const decodeTextures = async (
	textureNames: string[],
	textureData: Record<string, string>,
): Promise<Map<string, ImageBitmap>> => {
	const images = new Map<string, ImageBitmap>();
	const batch = 50;
	for (let i = 0; i < textureNames.length; i += batch) {
		const slice = textureNames.slice(i, i + batch);
		const results = await Promise.all(
			slice.map(async (name) => {
				const b64 = textureData[name];
				if (!b64) return null;
				try {
					const blob = await fetch(`data:image/png;base64,${b64}`).then((r) => r.blob());
					const bmp = await createImageBitmap(blob);
					return { name, bmp };
				} catch { return null; }
			}),
		);
		for (const r of results) if (r) images.set(r.name, r.bmp);
	}
	return images;
};

// ── Tint helpers ──

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

const objToMap = (obj: Record<string, readonly [number, number, number]>) => {
	const m = new Map<string, readonly [number, number, number]>();
	for (const [k, v] of Object.entries(obj)) m.set(k, v);
	return m;
};

const deserializeTints = (raw: SerializedTints): BiomeTints => ({
	grass: objToMap(raw.grass), foliage: objToMap(raw.foliage),
	water: objToMap(raw.water), redstone: objToMap(raw.redstone),
	constant: objToMap(raw.constant),
	grassDefault: raw.grassDefault, foliageDefault: raw.foliageDefault,
	waterDefault: raw.waterDefault,
});

// ── Cell management ──

const getOrCreateCell = (botId: string): BotCell => {
	let cell = cells.get(botId);
	if (cell) return cell;

	// Create a scene that shares the single renderer
	const viewer = createViewerScene(renderer, { workerUrl: "/web/clientWorker.js" });

	cell = {
		name: botId,
		viewer,
		minY: -64,
		worldHeight: 384,
		assetsReady: false,
		pending: [],
	};
	cells.set(botId, cell);

	if (!botOrder.includes(botId)) {
		botOrder.push(botId);
		updateLabels();
	}

	// If assets are already decoded, apply them immediately
	if (assetsDecoded) {
		applyAssets(cell);
	}

	return cell;
};

const applyAssets = (cell: BotCell) => {
	if (!sharedAtlas || !sharedBlockStates || !sharedTints) return;
	setViewerAssets(cell.viewer, sharedAtlas, sharedBlockStates, sharedTints);
	for (const worker of cell.viewer.worldRenderer.workers) {
		worker.postMessage({ type: "registryData", blocks: sharedBlocks, biomes: sharedBiomes });
	}
	cell.assetsReady = true;
	for (const msg of cell.pending) processMessage(msg as Record<string, unknown>);
	cell.pending.length = 0;
};

// ── Message processing ──

const processMessage = (msg: Record<string, unknown>) => {
	const botId = msg.botId as string;
	if (!botId) return;
	const cell = cells.get(botId);
	if (!cell) return;

	const type = msg.type as string;
	const { viewer } = cell;

	if (type === "position") {
		setViewerCamera(viewer, vec3(msg.x as number, msg.y as number, msg.z as number), msg.yaw as number, msg.pitch as number);
	} else if (type === "chunk") {
		const col = createChunkColumn({
			minY: cell.minY, worldHeight: cell.worldHeight,
			maxBitsPerBlock: GLOBAL_BITS_PER_BLOCK, maxBitsPerBiome: GLOBAL_BITS_PER_BIOME,
		});
		loadChunkColumn(col, Buffer.from(msg.buf as string, "base64"), true);
		addViewerColumn(viewer, msg.x as number, msg.z as number, col, cell.minY, cell.worldHeight);
	} else if (type === "unloadChunk") {
		removeViewerColumn(viewer, msg.x as number, msg.z as number);
	} else if (type === "blockUpdate") {
		setViewerBlockStateId(viewer, vec3(msg.x as number, msg.y as number, msg.z as number), msg.stateId as number);
	} else if (type === "time") {
		setViewerTime(viewer, msg.time as number);
	} else if (type === "entitySpawn") {
		addViewerEntity(viewer, msg.id as number, (msg.entityName as string) ?? "player", msg.username as string | null, msg.x as number, msg.y as number, msg.z as number, msg.yaw as number, msg.skinUrl as string | undefined);
	} else if (type === "entityMove") {
		updateViewerEntity(viewer, msg.id as number, msg.x as number, msg.y as number, msg.z as number, msg.yaw as number);
	} else if (type === "entityGone") {
		removeViewerEntity(viewer, msg.id as number);
	} else if (type === "entityEquip") {
		updateEntityEquipment(viewer.entityRenderer, msg.id as number, msg.slot as number, msg.itemName as string | null);
	}
};

// ── WebSocket connection ──

const connect = () => {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	const ws = new WebSocket(`${protocol}//${location.host}`);

	ws.onopen = () => { statusEl.textContent = "Connected"; };

	ws.onmessage = async (event) => {
		const msg = JSON.parse(event.data as string) as Record<string, unknown>;
		const type = msg.type as string;

		if (type === "botList") {
			for (const name of msg.bots as string[]) getOrCreateCell(name);
			statusEl.textContent = `${botOrder.length} bots`;
		} else if (type === "botAdd") {
			getOrCreateCell(msg.botId as string);
			statusEl.textContent = `${botOrder.length} bots`;
		} else if (type === "botRemove") {
			cells.delete(msg.botId as string);
			botOrder = botOrder.filter((n) => n !== msg.botId);
			updateLabels();
		} else if (type === "init") {
			const cell = getOrCreateCell(msg.botId as string);
			cell.minY = msg.minY as number;
			cell.worldHeight = msg.height as number;
		} else if (type === "assets" && !assetsDecoded) {
			statusEl.textContent = "Decoding textures...";
			const textureNames = msg.textureNames as string[];
			const textureData = msg.textureData as Record<string, string>;

			const images = await decodeTextures(textureNames, textureData);
			sharedAtlas = createTextureAtlas(textureNames, (name) => images.get(name.replace(".png", ""))!);
			sharedBlockStates = prepareBlockStates(
				msg.blockStates as Record<string, unknown>,
				msg.blockModels as Parameters<typeof prepareBlockStates>[1],
				sharedAtlas.uvMap,
			);
			sharedTints = deserializeTints(msg.tints as SerializedTints);
			sharedBlocks = msg.blocks as unknown[];
			sharedBiomes = msg.biomes as unknown[];
			setEntityModels(msg.entityModels as Record<string, EntityModelDef>);
			assetsDecoded = true;

			// Apply to all existing cells
			for (const cell of cells.values()) {
				if (!cell.assetsReady) applyAssets(cell);
			}
			statusEl.textContent = `${botOrder.length} bots`;
		} else {
			const botId = msg.botId as string;
			if (!botId) return;
			const cell = cells.get(botId);
			if (!cell) return;
			if (!cell.assetsReady) { cell.pending.push(msg); }
			else { processMessage(msg); }
		}
	};

	ws.onclose = () => {
		statusEl.textContent = "Disconnected. Reconnecting in 3s...";
		setTimeout(connect, 3000);
	};
	ws.onerror = () => ws.close();
};

// ── Render loop — single renderer, multiple viewports ──

const _sizeVec = new THREE.Vector2();
const loop = () => {
	requestAnimationFrame(loop);
	if (cells.size === 0) return;

	const { cols, rows } = getGrid();
	renderer.getSize(_sizeVec);
	const w = _sizeVec.x;
	const h = _sizeVec.y;
	const cellW = w / cols;
	const cellH = h / rows;

	renderer.setScissorTest(true);
	renderer.autoClear = false;
	renderer.clear();

	for (let i = 0; i < botOrder.length; i++) {
		const cell = cells.get(botOrder[i]);
		if (!cell || !cell.assetsReady) continue;

		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = col * cellW;
		const y = h - (row + 1) * cellH; // WebGL y is bottom-up

		renderer.setViewport(x, y, cellW, cellH);
		renderer.setScissor(x, y, cellW, cellH);
		cell.viewer.camera.aspect = cellW / cellH;
		cell.viewer.camera.updateProjectionMatrix();
		renderer.render(cell.viewer.scene, cell.viewer.camera);
	}

	renderer.setScissorTest(false);
};

// ── Resize ──

window.addEventListener("resize", () => {
	renderer.setSize(window.innerWidth, window.innerHeight, true);
	updateLabels();
});

// ── Start ──

connect();
requestAnimationFrame(loop);
