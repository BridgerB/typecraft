/**
 * Server-side bridge — serves static files + WebSocket for streaming
 * bot state (chunks, position, assets) to the browser viewer.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bot } from "../bot/types.ts";
import type { BiomeTints } from "../viewer/assets.ts";

// ── Types ──

export type WebViewerOptions = {
	port?: number;
	viewDistance?: number;
};

export type WebViewer = {
	readonly server: ReturnType<typeof createServer>;
	readonly wss: WebSocketServer;
	readonly close: () => void;
};

// ── MIME types ──

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".map": "application/json",
};

// ── Asset loading ──

type RegistryBlock = {
	name: string;
	transparent: boolean;
	boundingBox: string;
	minStateId: number;
	states?: { name: string; values?: string[] }[];
};

type RegistryBiome = {
	id: number;
	name: string;
};

type CachedAssets = {
	blockStates: Record<string, unknown>;
	blockModels: Record<string, unknown>;
	textureNames: string[];
	textureData: Record<string, string>;
	tints: SerializedTints;
	blocks: RegistryBlock[];
	biomes: RegistryBiome[];
};

const require = createRequire(import.meta.url);

const loadMcAssets = (version: string, bot: Bot): CachedAssets => {
	const mcAssets = require("minecraft-assets")(version) as {
		blocksStates: Record<string, unknown>;
		blocksModels: Record<string, unknown>;
		directory: string;
	};

	// Load individual face textures from blocks/ directory (not textureContent,
	// which has composite per-block images). Models reference face textures like
	// "block/grass_block_top" which map to blocks/grass_block_top.png.
	const textureNames: string[] = [];
	const textureData: Record<string, string> = {};
	const blocksDir = join(mcAssets.directory, "blocks");

	for (const file of readdirSync(blocksDir)) {
		if (!file.endsWith(".png")) continue;
		const name = file.replace(".png", "");
		const b64 = readFileSync(join(blocksDir, file)).toString("base64");
		textureNames.push(name);
		textureData[name] = b64;
	}

	const mcData = require("minecraft-data")(version) as {
		tints: {
			grass: {
				default?: number;
				data: { keys: string[]; color: number }[];
			};
			foliage: {
				default?: number;
				data: { keys: string[]; color: number }[];
			};
			water: {
				default?: number;
				data: { keys: string[]; color: number }[];
			};
			redstone: { data: { keys: (string | number)[]; color: number }[] };
			constant: { data: { keys: string[]; color: number }[] };
		};
	};

	const tintToGl = (c: number): readonly [number, number, number] =>
		[
			((c >> 16) & 0xff) / 255,
			((c >> 8) & 0xff) / 255,
			(c & 0xff) / 255,
		] as const;

	const buildMap = (data: { keys: (string | number)[]; color: number }[]) => {
		const m = new Map<string, readonly [number, number, number]>();
		for (const e of data) {
			if (e.color === 0) continue; // 0 = use default colormap color
			for (const k of e.keys) m.set(`${k}`, tintToGl(e.color));
		}
		return m;
	};

	const t = mcData.tints;
	const tints: BiomeTints = {
		grass: buildMap(t.grass.data),
		foliage: buildMap(t.foliage.data),
		water: buildMap(t.water.data),
		redstone: buildMap(t.redstone.data),
		constant: buildMap(t.constant.data),
		grassDefault:
			t.grass.default !== undefined
				? tintToGl(t.grass.default)
				: [0.48, 0.74, 0.31],
		foliageDefault:
			t.foliage.default !== undefined
				? tintToGl(t.foliage.default)
				: [0.48, 0.74, 0.31],
		waterDefault:
			t.water.default !== undefined
				? tintToGl(t.water.default)
				: [0.25, 0.29, 0.98],
	};

	// Extract minimal block/biome data for the browser worker
	const blocks: RegistryBlock[] = [];
	for (const block of bot.registry!.blocksArray) {
		blocks.push({
			name: block.name,
			transparent: block.transparent,
			boundingBox: block.boundingBox,
			minStateId: block.minStateId,
			states: block.states?.map((s) => ({
				name: s.name,
				values: s.values ? [...s.values] : undefined,
			})),
		});
	}

	const biomes: RegistryBiome[] = [];
	for (const biome of bot.registry!.biomesArray) {
		biomes.push({ id: biome.id, name: biome.name });
	}

	return {
		blockStates: mcAssets.blocksStates,
		blockModels: mcAssets.blocksModels,
		textureNames,
		textureData,
		tints: serializeTints(tints),
		blocks,
		biomes,
	};
};

// ── Chunk buffer cache ──

type ChunkCache = Map<string, Buffer>;

const chunkKey = (x: number, z: number) => `${x},${z}`;

// ── Tint serialization (Maps → plain objects for JSON) ──

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

const serializeTints = (tints: BiomeTints): SerializedTints => ({
	grass: Object.fromEntries(tints.grass),
	foliage: Object.fromEntries(tints.foliage),
	water: Object.fromEntries(tints.water),
	redstone: Object.fromEntries(tints.redstone),
	constant: Object.fromEntries(tints.constant),
	grassDefault: tints.grassDefault,
	foliageDefault: tints.foliageDefault,
	waterDefault: tints.waterDefault,
});

// ── Server ──

export const createWebViewer = (
	bot: Bot,
	options?: WebViewerOptions,
): WebViewer => {
	const port = options?.port ?? 3000;
	const viewDistance = options?.viewDistance ?? 6;
	const distDir = resolve(import.meta.dirname, "../../dist");

	const clients = new Set<WebSocket>();
	const chunkCache: ChunkCache = new Map();
	let assets: CachedAssets | null = null;

	// ── Static file server ──

	const threeDir = resolve(
		import.meta.dirname,
		"../../node_modules/three/build",
	);

	const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Typecraft Viewer</title>
<script type="importmap">
{ "imports": { "three": "/vendor/three.module.js" } }
</script>
<script>
// Minimal Buffer polyfill for browser (read-only subset used by chunk code)
class Buffer extends Uint8Array {
  static from(src, enc) {
    if (enc === "base64") {
      const bin = atob(src);
      const arr = new Buffer(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    if (src instanceof ArrayBuffer || src instanceof Uint8Array) return new Buffer(src);
    return new Buffer(0);
  }
  static alloc(n) { return new Buffer(n); }
  readUInt8(o) { return this[o]; }
  readInt16BE(o) { const v = (this[o] << 8) | this[o+1]; return v > 0x7fff ? v - 0x10000 : v; }
  readUInt32BE(o) { return ((this[o] << 24) | (this[o+1] << 16) | (this[o+2] << 8) | this[o+3]) >>> 0; }
  writeUInt8(v, o) { this[o] = v & 0xff; return o + 1; }
  writeInt16BE(v, o) { this[o] = (v >> 8) & 0xff; this[o+1] = v & 0xff; return o + 2; }
  writeUInt32BE(v, o) { this[o]=(v>>>24)&0xff; this[o+1]=(v>>>16)&0xff; this[o+2]=(v>>>8)&0xff; this[o+3]=v&0xff; return o + 4; }
}
globalThis.Buffer = Buffer;
</script>
<style>
body { margin: 0; overflow: hidden; background: #000; }
canvas { display: block; width: 100vw; height: 100vh; }
#status { position: fixed; top: 12px; left: 12px; color: #fff; font: 14px monospace; z-index: 1; }
</style>
</head>
<body>
<div id="status">Connecting...</div>
<canvas id="viewer"></canvas>
<script type="module" src="/web/client.js"></script>
</body>
</html>`;

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(INDEX_HTML);
			return;
		}

		// Serve three.js from node_modules
		if (req.url?.startsWith("/vendor/")) {
			const vendorFile = resolve(threeDir, req.url.slice("/vendor/".length));
			if (!vendorFile.startsWith(threeDir) || !existsSync(vendorFile)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			try {
				const content = readFileSync(vendorFile);
				res.writeHead(200, { "Content-Type": "text/javascript" });
				res.end(content);
			} catch {
				res.writeHead(500);
				res.end("Internal error");
			}
			return;
		}

		const filePath = resolve(distDir, `.${req.url}`);

		if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const ext = extname(filePath);
		const contentType = MIME[ext] ?? "application/octet-stream";

		try {
			const content = readFileSync(filePath);
			res.writeHead(200, { "Content-Type": contentType });
			res.end(content);
		} catch {
			res.writeHead(500);
			res.end("Internal error");
		}
	});

	// ── WebSocket server ──

	const wss = new WebSocketServer({ server });

	const broadcast = (data: unknown) => {
		const json = JSON.stringify(data);
		for (const ws of clients) {
			if (ws.readyState === ws.OPEN) ws.send(json);
		}
	};

	const sendTo = (ws: WebSocket, data: unknown) => {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
	};

	wss.on("connection", (ws) => {
		clients.add(ws);
		ws.on("close", () => clients.delete(ws));

		// Send init
		sendTo(ws, {
			type: "init",
			version: bot.version,
			minY: bot.game.minY,
			height: bot.game.height,
		});

		// Send assets
		if (assets) {
			sendTo(ws, { type: "assets", ...assets });
		}

		// Send current position
		if (bot.entity) {
			sendTo(ws, {
				type: "position",
				x: bot.entity.position.x,
				y: bot.entity.position.y,
				z: bot.entity.position.z,
				yaw: bot.entity.yaw,
				pitch: bot.entity.pitch,
			});
		}

		// Send all loaded chunks
		if (bot.world) {
			const botPos = bot.entity?.position;
			const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
			const botCz = botPos ? Math.floor(botPos.z / 16) : 0;

			for (const [key, buf] of chunkCache) {
				const [x, z] = key.split(",").map(Number) as [number, number];
				if (
					Math.abs(x - botCx) <= viewDistance &&
					Math.abs(z - botCz) <= viewDistance
				) {
					sendTo(ws, { type: "chunk", x, z, buf: buf.toString("base64") });
				}
			}
		}
	});

	// ── Bot event listeners ──

	const onMove = () => {
		if (!bot.entity) return;
		broadcast({
			type: "position",
			x: bot.entity.position.x,
			y: bot.entity.position.y,
			z: bot.entity.position.z,
			yaw: bot.entity.yaw,
			pitch: bot.entity.pitch,
		});
	};

	// Intercept raw chunk data from protocol
	const onMapChunk = (packet: Record<string, unknown>) => {
		const x = packet.x as number;
		const z = packet.z as number;
		const chunkData = packet.chunkData as Buffer;

		// Cache the raw buffer
		chunkCache.set(chunkKey(x, z), chunkData);

		// Forward to clients within view distance
		const botPos = bot.entity?.position;
		const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
		const botCz = botPos ? Math.floor(botPos.z / 16) : 0;

		if (
			Math.abs(x - botCx) <= viewDistance &&
			Math.abs(z - botCz) <= viewDistance
		) {
			broadcast({
				type: "chunk",
				x,
				z,
				buf: chunkData.toString("base64"),
			});
		}
	};

	const onUnloadChunk = (packet: Record<string, unknown>) => {
		const x = packet.chunkX as number;
		const z = packet.chunkZ as number;
		chunkCache.delete(chunkKey(x, z));
		broadcast({ type: "unloadChunk", x, z });
	};

	const onBlockChange = (packet: Record<string, unknown>) => {
		const loc = packet.location as Record<string, number>;
		if (!loc) return;
		broadcast({
			type: "blockUpdate",
			x: loc.x,
			y: loc.y,
			z: loc.z,
			stateId: packet.type as number,
		});
	};

	const onTimeUpdate = (packet: Record<string, unknown>) => {
		const timeOfDay = Number(packet.time) % 24000;
		broadcast({ type: "time", time: timeOfDay < 0 ? timeOfDay + 24000 : timeOfDay });
	};

	// ── Load assets + wire events ──

	const setup = () => {
		if (!bot.registry) return;
		assets = loadMcAssets(bot.version, bot);
		console.log(
			`[web] Assets loaded: ${assets.textureNames.length} textures, ${Object.keys(assets.blockStates).length} block states`,
		);
	};

	// If already spawned, set up immediately
	if (bot.registry && bot.entity) {
		setup();
	} else {
		bot.once("spawn", setup);
	}

	bot.on("move", onMove);
	bot.client.on("map_chunk", onMapChunk);
	bot.client.on("unload_chunk", onUnloadChunk);
	bot.client.on("block_change", onBlockChange);
	bot.client.on("update_time", onTimeUpdate);

	server.listen(port, () => {
		console.log(`[web] Viewer at http://localhost:${port}`);
	});

	// ── Cleanup ──

	const close = () => {
		bot.removeListener("move", onMove);
		bot.client.removeListener("map_chunk", onMapChunk);
		bot.client.removeListener("unload_chunk", onUnloadChunk);
		bot.client.removeListener("block_change", onBlockChange);
		bot.client.removeListener("update_time", onTimeUpdate);
		for (const ws of clients) ws.close();
		clients.clear();
		wss.close();
		server.close();
	};

	return { server, wss, close };
};

export const closeWebViewer = (viewer: WebViewer): void => {
	viewer.close();
};
