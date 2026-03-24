/**
 * Server-side bridge — serves static files + WebSocket for streaming
 * bot state (chunks, position, assets) to the browser viewer.
 * Assets loaded from src/data/assets/ (extracted from client JAR by datagen).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bot } from "../bot/types.ts";
import { dumpChunkColumn } from "../chunk/index.ts";
import type { Entity } from "../entity/types.ts";
import type { BiomeTints } from "../viewer/assets.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

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

type EntityModelDef = {
	texturewidth: number;
	textureheight: number;
	bones: unknown[];
};

type CachedAssets = {
	blockStates: Record<string, unknown>;
	blockModels: Record<string, unknown>;
	textureNames: string[];
	textureData: Record<string, string>;
	tints: SerializedTints;
	blocks: RegistryBlock[];
	biomes: RegistryBiome[];
	entityModels: Record<string, EntityModelDef>;
};

/** Parse a hex color string like "#3f76e4" to an integer. */
const hexToInt = (hex: string): number => parseInt(hex.replace("#", ""), 16);

/** Convert an integer color to GL [r, g, b] tuple. */
const tintToGl = (c: number): readonly [number, number, number] =>
	[
		((c >> 16) & 0xff) / 255,
		((c >> 8) & 0xff) / 255,
		(c & 0xff) / 255,
	] as const;

/** Compute redstone power level → color. */
const redstoneTint = (power: number): readonly [number, number, number] => {
	const f = power / 15;
	return [f * 0.6 + (f > 0 ? 0.4 : 0.3), f * f * 0.7 - 0.5, f * f * 0.6 - 0.7].map(
		(v) => Math.max(0, Math.min(1, v)),
	) as unknown as readonly [number, number, number];
};

type BiomeJson = {
	effects?: {
		water_color?: string;
		foliage_color?: string;
		grass_color_modifier?: string;
	};
	temperature?: number;
	downfall?: number;
};

/** Build tints from extracted biome data in src/data/biomes-raw/. */
const buildTints = (): BiomeTints => {
	const grass = new Map<string, readonly [number, number, number]>();
	const foliage = new Map<string, readonly [number, number, number]>();
	const water = new Map<string, readonly [number, number, number]>();

	const biomesDir = join(DATA_DIR, "biomes-raw");
	if (existsSync(biomesDir)) {
		for (const file of readdirSync(biomesDir)) {
			if (!file.endsWith(".json")) continue;
			const biomeName = file.replace(".json", "");
			const biome = JSON.parse(readFileSync(join(biomesDir, file), "utf8")) as BiomeJson;
			const effects = biome.effects;
			if (!effects) continue;

			if (effects.water_color) {
				water.set(biomeName, tintToGl(hexToInt(effects.water_color)));
			}
			if (effects.foliage_color) {
				foliage.set(biomeName, tintToGl(hexToInt(effects.foliage_color)));
			}
		}
	}

	// Redstone: power levels 0–15
	const redstone = new Map<string, readonly [number, number, number]>();
	for (let i = 0; i <= 15; i++) {
		redstone.set(`${i}`, redstoneTint(i));
	}

	// Constant tints (lily pad, etc.)
	const constant = new Map<string, readonly [number, number, number]>();
	constant.set("attached_stem", [0.9, 0.9, 0.1]);
	constant.set("lily_pad", [0.135, 0.522, 0.18]);

	return {
		grass,
		foliage,
		water,
		redstone,
		constant,
		grassDefault: [0.48, 0.74, 0.31],
		foliageDefault: [0.48, 0.74, 0.31],
		waterDefault: [0.25, 0.29, 0.98],
	};
};

export const loadMcAssets = (_version: string, bot: Bot): CachedAssets => {
	// Load blockstates from individual JSON files
	const blockStates: Record<string, unknown> = {};
	const blockStatesDir = join(DATA_DIR, "assets/blockstates");
	if (existsSync(blockStatesDir)) {
		for (const file of readdirSync(blockStatesDir)) {
			if (!file.endsWith(".json")) continue;
			const name = file.replace(".json", "");
			blockStates[name] = JSON.parse(readFileSync(join(blockStatesDir, file), "utf8"));
		}
	}

	// Load block models from individual JSON files
	const blockModels: Record<string, unknown> = {};
	const modelsDir = join(DATA_DIR, "assets/models/block");
	if (existsSync(modelsDir)) {
		for (const file of readdirSync(modelsDir)) {
			if (!file.endsWith(".json")) continue;
			const name = file.replace(".json", "");
			blockModels[name] = JSON.parse(readFileSync(join(modelsDir, file), "utf8"));
		}
	}

	// Load block textures as base64
	const textureNames: string[] = [];
	const textureData: Record<string, string> = {};
	const texturesDir = join(DATA_DIR, "assets/textures/block");
	if (existsSync(texturesDir)) {
		for (const file of readdirSync(texturesDir)) {
			if (!file.endsWith(".png")) continue;
			const name = file.replace(".png", "");
			const b64 = readFileSync(join(texturesDir, file)).toString("base64");
			textureNames.push(name);
			textureData[name] = b64;
		}
	}

	const tints = buildTints();

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

	// Load entity model geometry from upstream entities.json
	const entityModels: Record<string, EntityModelDef> = {};
	try {
		const entitiesJsonPath = resolve(import.meta.dirname, "../../upstream/prismarine-viewer/viewer/lib/entity/entities.json");
		const raw = JSON.parse(readFileSync(entitiesJsonPath, "utf8")) as Record<string, {
			geometry?: { default?: { texturewidth?: number; textureheight?: number; bones?: unknown[] } };
		}>;
		for (const [name, def] of Object.entries(raw)) {
			if (def.geometry?.default) {
				entityModels[name] = {
					texturewidth: def.geometry.default.texturewidth ?? 64,
					textureheight: def.geometry.default.textureheight ?? 64,
					bones: def.geometry.default.bones ?? [],
				};
			}
		}
	} catch { /* entity models unavailable — non-player entities will use fallback box */ }

	return {
		blockStates,
		blockModels,
		textureNames,
		textureData,
		tints: serializeTints(tints),
		blocks,
		biomes,
		entityModels,
	};
};

// Global asset cache — computed once, shared across all viewer instances
let _cachedAssets: CachedAssets | null = null;
let _cachedAssetsJson: string | null = null;

const getCachedAssets = (bot: Bot): { assets: CachedAssets; json: string } => {
	if (!_cachedAssets) {
		_cachedAssets = loadMcAssets(bot.version, bot);
		_cachedAssetsJson = JSON.stringify({ type: "assets", ..._cachedAssets });
	}
	return { assets: _cachedAssets, json: _cachedAssetsJson! };
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

	// Disk-backed skin cache
	const skinCacheDir = resolve(import.meta.dirname, "../../.cache/skins");
	mkdirSync(skinCacheDir, { recursive: true });

	const getSkinCache = (uuid: string): Buffer | null => {
		const p = join(skinCacheDir, `${uuid}.png`);
		return existsSync(p) ? readFileSync(p) : null;
	};

	const setSkinCache = (uuid: string, buf: Buffer): void => {
		writeFileSync(join(skinCacheDir, `${uuid}.png`), buf);
	};

	// ── Static file server ──

	const threeDir = resolve(
		import.meta.dirname,
		"../../node_modules/three/build",
	);

	// Steve skin texture from extracted client JAR assets
	const steveTexturePath = (() => {
		const p = join(DATA_DIR, "assets/textures/entity/player/wide/steve.png");
		return existsSync(p) ? p : null;
	})();

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

	const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(INDEX_HTML);
			return;
		}

		// Serve player skins (proxy from Mojang to avoid CORS)
		if (req.url?.startsWith("/skins/") && req.url.endsWith(".png")) {
			const uuid = req.url.slice("/skins/".length, -".png".length);
			const skinHeaders = { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" };

			// Check disk cache first
			const cached = getSkinCache(uuid);
			if (cached) {
				res.writeHead(200, skinHeaders);
				res.end(cached);
				return;
			}

			// Resolve skin URL: bot.players → Mojang session API
			let skinUrl: string | undefined;
			const uname = bot.uuidToUsername[uuid];
			if (uname) skinUrl = bot.players[uname]?.skinData?.url;
			if (!skinUrl) {
				try {
					const profileRes = await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, "")}`);
					if (profileRes.ok) {
						const profile = await profileRes.json() as { properties: { name: string; value: string }[] };
						const texProp = profile.properties.find((p: { name: string }) => p.name === "textures");
						if (texProp) {
							const decoded = JSON.parse(Buffer.from(texProp.value, "base64").toString("utf8"));
							skinUrl = decoded?.textures?.SKIN?.url;
						}
					}
				} catch { /* fall through to steve */ }
			}

			// Fetch skin PNG and cache it
			if (skinUrl) {
				try {
					const skinRes = await fetch(skinUrl);
					if (skinRes.ok) {
						const buf = Buffer.from(await skinRes.arrayBuffer());
						setSkinCache(uuid, buf);
						res.writeHead(200, skinHeaders);
						res.end(buf);
						return;
					}
				} catch { /* fall through to steve */ }
			}

			// Fallback: cache steve under this UUID so we don't re-fetch
			if (steveTexturePath) {
				const buf = readFileSync(steveTexturePath);
				setSkinCache(uuid, buf);
				res.writeHead(200, skinHeaders);
				res.end(buf);
				return;
			}
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		// Serve Steve skin texture
		if (req.url === "/textures/steve.png" && steveTexturePath) {
			const content = readFileSync(steveTexturePath);
			res.writeHead(200, { "Content-Type": "image/png" });
			res.end(content);
			return;
		}

		// Serve item textures from extracted assets
		if (req.url?.startsWith("/textures/item/") && req.url.endsWith(".png")) {
			const itemName = req.url.slice("/textures/item/".length, -".png".length);
			const itemPath = join(DATA_DIR, "assets/textures/item", `${itemName}.png`);
			if (existsSync(itemPath)) {
				res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
				res.end(readFileSync(itemPath));
				return;
			}
			res.writeHead(404);
			res.end("Not found");
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

		// Send assets (pre-serialized JSON — avoids re-serializing ~15MB per connection)
		if (assets && _cachedAssetsJson) {
			if (ws.readyState === ws.OPEN) ws.send(_cachedAssetsJson);
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

		// Send all currently tracked entities
		for (const entity of Object.values(bot.entities)) {
			if (entity.id === bot.entity?.id) continue;
			const username = entity.type === "player"
				? (entity.username ?? (entity.uuid ? bot.uuidToUsername[entity.uuid] : null))
				: null;
			const skinUrl = entity.type === "player" && entity.uuid ? `/skins/${entity.uuid}.png` : undefined;
			sendTo(ws, {
				type: "entitySpawn",
				id: entity.id,
				entityName: entity.name ?? "unknown",
				username: username ?? entity.username,
				skinUrl,
				x: entity.position.x,
				y: entity.position.y,
				z: entity.position.z,
				yaw: entity.yaw,
			});
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

	// ── Entity events ──

	const onEntitySpawn = (entity: Entity) => {
		if (entity.id === bot.entity?.id) return;
		const username = entity.type === "player"
			? (entity.username ?? (entity.uuid ? bot.uuidToUsername[entity.uuid] : null))
			: null;
		// Serve skin through our proxy to avoid CORS (players only)
		const skinUrl = entity.type === "player" && entity.uuid ? `/skins/${entity.uuid}.png` : undefined;
		broadcast({
			type: "entitySpawn",
			id: entity.id,
			entityName: entity.name ?? "unknown",
			username: username ?? entity.username,
			skinUrl,
			x: entity.position.x,
			y: entity.position.y,
			z: entity.position.z,
			yaw: entity.yaw,
		});
	};

	const onEntityMoved = (entity: Entity) => {
		if (entity.id === bot.entity?.id) return;
		broadcast({
			type: "entityMove",
			id: entity.id,
			x: entity.position.x,
			y: entity.position.y,
			z: entity.position.z,
			yaw: entity.yaw,
		});
	};

	const onEntityGone = (entity: Entity) => {
		broadcast({ type: "entityGone", id: entity.id });
	};

	const onEntityEquip = (entity: Entity) => {
		if (entity.id === bot.entity?.id) return;
		const mainHand = (entity as unknown as Record<string, unknown>).equipment as
			| Array<{ type?: number; name?: string } | null>
			| undefined;
		const item = mainHand?.[0];
		broadcast({
			type: "entityEquip",
			id: entity.id,
			slot: 0,
			itemName: item?.name ?? null,
		});
	};

	// ── Load assets + wire events ──

	const setup = () => {
		if (!bot.registry) return;
		const cached = getCachedAssets(bot);
		assets = cached.assets;
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
	bot.on("forcedMove", onMove);
	bot.on("entitySpawn", onEntitySpawn);
	bot.on("entityMoved", onEntityMoved);
	bot.on("entityGone", onEntityGone);
	bot.on("entityEquip", onEntityEquip);
	bot.client.on("level_chunk_with_light", onMapChunk);
	bot.client.on("forget_level_chunk", onUnloadChunk);
	bot.client.on("block_update", onBlockChange);
	bot.client.on("set_time", onTimeUpdate);

	// Pre-populate chunkCache from chunks already in bot.world
	// (these arrived before createWebViewer was called)
	if (bot.world) {
		for (const [key, column] of bot.world.columns) {
			if (!chunkCache.has(key)) {
				const [cx, cz] = key.split(",").map(Number) as [number, number];
				chunkCache.set(chunkKey(cx, cz), dumpChunkColumn(column, true));
			}
		}
	}

	server.listen(port, () => {
		console.log(`[web] Viewer at http://localhost:${port}`);
	});

	// ── Cleanup ──

	const close = () => {
		bot.removeListener("move", onMove);
		bot.removeListener("forcedMove", onMove);
		bot.removeListener("entitySpawn", onEntitySpawn);
		bot.removeListener("entityMoved", onEntityMoved);
		bot.removeListener("entityGone", onEntityGone);
		bot.removeListener("entityEquip", onEntityEquip);
		bot.client.removeListener("level_chunk_with_light", onMapChunk);
		bot.client.removeListener("forget_level_chunk", onUnloadChunk);
		bot.client.removeListener("block_update", onBlockChange);
		bot.client.removeListener("set_time", onTimeUpdate);
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
