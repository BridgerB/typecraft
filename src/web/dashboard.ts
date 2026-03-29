/**
 * Multi-bot dashboard server — single HTTP + WebSocket server that streams
 * data from multiple bots to a grid-view browser client.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname, extname, join as pathJoin, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bot } from "../bot/types.ts";
import { dumpChunkColumn } from "../chunk/index.ts";
import type { Entity } from "../entity/types.ts";
import { loadMcAssets } from "./serve.ts";

const DASHBOARD_DATA_DIR = pathJoin(
	dirname(fileURLToPath(import.meta.url)),
	"../data",
);

// ── Types ──

export type DashboardOptions = {
	readonly port?: number;
	readonly viewDistance?: number;
};

export type Dashboard = {
	readonly server: ReturnType<typeof createServer>;
	readonly wss: WebSocketServer;
	readonly close: () => void;
};

type BotEntry = {
	readonly bot: Bot;
	readonly name: string;
	readonly chunkCache: Map<string, Buffer>;
	readonly cleanups: (() => void)[];
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

// ── Dashboard factory ──

/** Create a multi-bot dashboard. Add bots with addBotToDashboard(). */
export const createDashboard = (options?: DashboardOptions): Dashboard => {
	const port = options?.port ?? 3000;
	const viewDistance = options?.viewDistance ?? 2;
	const distDir = resolve(import.meta.dirname, "../../dist");

	// Offline skin selection — matches Minecraft's built-in skin assignment
	const BUILTIN_SKINS = [
		"alex",
		"ari",
		"efe",
		"kai",
		"makena",
		"noor",
		"steve",
		"sunny",
		"zuri",
	];
	const getOfflineSkin = (uuid: string): string => {
		// Java UUID.hashCode(): (int)(msb ^ (msb >>> 32)) ^ (int)(lsb ^ (lsb >>> 32))
		const hex = uuid.replace(/-/g, "");
		const msb = BigInt(`0x${hex.slice(0, 16)}`);
		const lsb = BigInt(`0x${hex.slice(16)}`);
		const toInt = (x: bigint): number => Number(BigInt.asIntN(32, x));
		const hash =
			toInt(BigInt.asIntN(64, msb) ^ (BigInt.asIntN(64, msb) >> 32n)) ^
			toInt(BigInt.asIntN(64, lsb) ^ (BigInt.asIntN(64, lsb) >> 32n));
		return BUILTIN_SKINS[Math.abs(hash) % BUILTIN_SKINS.length]!;
	};

	const clients = new Set<WebSocket>();
	const bots = new Map<string, BotEntry>();
	const chunkKey = (x: number, z: number) => `${x},${z}`;

	// Disk-backed skin cache
	const skinCacheDir = resolve(import.meta.dirname, "../../.cache/skins");
	mkdirSync(skinCacheDir, { recursive: true });
	const getSkinCache = (uuid: string): Buffer | null => {
		const p = pathJoin(skinCacheDir, `${uuid}.png`);
		return existsSync(p) ? readFileSync(p) : null;
	};
	const setSkinCache = (uuid: string, buf: Buffer): void => {
		writeFileSync(pathJoin(skinCacheDir, `${uuid}.png`), buf);
	};

	// ── Broadcasting ──

	const broadcast = (data: unknown) => {
		const json = JSON.stringify(data);
		for (const ws of clients) {
			if (ws.readyState === ws.OPEN) ws.send(json);
		}
	};

	const sendTo = (ws: WebSocket, data: unknown) => {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
	};

	// ── Asset loading (once, shared across bots) ──

	let cachedAssets: Record<string, unknown> | null = null;

	const getAssets = (bot: Bot): Record<string, unknown> => {
		if (cachedAssets) return cachedAssets;
		const assets = loadMcAssets(bot.version, bot);
		cachedAssets = { type: "assets", ...assets };
		return cachedAssets;
	};

	// ── HTML page ──

	const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Typecraft Dashboard</title>
<script>
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
body { margin: 0; overflow: hidden; background: #111; font-family: monospace; }
canvas { display: block; width: 100vw; height: 100vh; }
#labels { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
.bot-label {
  position: absolute; color: #fff; font-size: 11px; padding: 2px 6px;
  background: rgba(0,0,0,0.6); border-radius: 2px;
}
#status { position: fixed; bottom: 12px; right: 12px; color: #888; font-size: 12px; z-index: 2; }
</style>
</head>
<body>
<canvas id="dashboard"></canvas>
<div id="labels"></div>
<div id="status">Connecting...</div>
<script type="module" src="/web/dashboardClient.js"></script>
</body>
</html>`;

	// ── HTTP server ──

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (req.url === "/" || req.url === "/index.html") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(INDEX_HTML);
			return;
		}

		// Serve Steve skin texture
		if (req.url === "/textures/steve.png") {
			const stevePath = pathJoin(
				DASHBOARD_DATA_DIR,
				"assets/textures/entity/player/wide/steve.png",
			);
			if (existsSync(stevePath)) {
				res.writeHead(200, { "Content-Type": "image/png" });
				res.end(readFileSync(stevePath));
				return;
			}
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		// Serve player skins (proxy from Mojang to avoid CORS)
		if (req.url?.startsWith("/skins/") && req.url.endsWith(".png")) {
			const uuid = req.url.slice("/skins/".length, -".png".length);
			const skinHeaders = {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=3600",
			};

			const cached = getSkinCache(uuid);
			if (cached) {
				res.writeHead(200, skinHeaders);
				res.end(cached);
				return;
			}

			// Fetch from Mojang session server
			(async () => {
				try {
					const serveFallback = () => {
						const skinName = getOfflineSkin(uuid);
						const fallbackPath = pathJoin(
							DASHBOARD_DATA_DIR,
							`assets/textures/entity/player/wide/${skinName}.png`,
						);
						if (existsSync(fallbackPath)) {
							const buf = readFileSync(fallbackPath);
							setSkinCache(uuid, buf);
							res.writeHead(200, skinHeaders);
							res.end(buf);
						} else {
							res.writeHead(404);
							res.end("Not found");
						}
					};

					const profileRes = await fetch(
						`https://sessionserver.mojang.com/session/minecraft/profile/${uuid.replace(/-/g, "")}`,
					);
					if (!profileRes.ok) {
						serveFallback();
						return;
					}
					const profile = (await profileRes.json()) as {
						properties: { name: string; value: string }[];
					};
					const texProp = profile.properties.find(
						(p: { name: string }) => p.name === "textures",
					);
					if (!texProp) {
						serveFallback();
						return;
					}
					const decoded = JSON.parse(
						Buffer.from(texProp.value, "base64").toString("utf8"),
					);
					const skinUrl = decoded?.textures?.SKIN?.url;
					if (!skinUrl) {
						serveFallback();
						return;
					}

					const skinRes = await fetch(skinUrl);
					if (!skinRes.ok) {
						serveFallback();
						return;
					}
					const buf = Buffer.from(await skinRes.arrayBuffer());
					setSkinCache(uuid, buf);
					res.writeHead(200, skinHeaders);
					res.end(buf);
				} catch {
					// Fallback to offline skin selection
					const skinName = getOfflineSkin(uuid);
					const fallbackPath = pathJoin(
						DASHBOARD_DATA_DIR,
						`assets/textures/entity/player/wide/${skinName}.png`,
					);
					if (existsSync(fallbackPath)) {
						res.writeHead(200, skinHeaders);
						res.end(readFileSync(fallbackPath));
					} else {
						res.writeHead(404);
						res.end("Not found");
					}
				}
			})();
			return;
		}

		// Serve item textures
		if (req.url?.startsWith("/textures/item/") && req.url.endsWith(".png")) {
			const itemName = req.url.slice("/textures/item/".length, -".png".length);
			const itemPath = pathJoin(
				DASHBOARD_DATA_DIR,
				"assets/textures/item",
				`${itemName}.png`,
			);
			if (existsSync(itemPath)) {
				res.writeHead(200, {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=86400",
				});
				res.end(readFileSync(itemPath));
				return;
			}
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const filePath = resolve(distDir, `.${req.url}`);
		if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
			console.error(`[dashboard] 404: ${req.url} → ${filePath}`);
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const ext = extname(filePath);
		res.writeHead(200, {
			"Content-Type": MIME[ext] ?? "application/octet-stream",
		});
		res.end(readFileSync(filePath));
	});

	// ── WebSocket server ──

	const wss = new WebSocketServer({ server });

	wss.on("connection", (ws) => {
		clients.add(ws);
		ws.on("close", () => clients.delete(ws));

		// Send bot list
		sendTo(ws, {
			type: "botList",
			bots: [...bots.keys()],
		});

		// Send assets (once, from any bot that has a registry)
		for (const entry of bots.values()) {
			if (entry.bot.registry) {
				sendTo(ws, getAssets(entry.bot));
				break;
			}
		}

		// Send current state for each bot
		for (const [name, entry] of bots) {
			const { bot } = entry;

			sendTo(ws, {
				type: "init",
				botId: name,
				version: bot.version,
				minY: bot.game.minY,
				height: bot.game.height,
			});

			// Send position
			if (bot.entity) {
				sendTo(ws, {
					type: "position",
					botId: name,
					x: bot.entity.position.x,
					y: bot.entity.position.y,
					z: bot.entity.position.z,
					yaw: bot.entity.yaw,
					pitch: bot.entity.pitch,
				});
			}

			// Send cached chunks
			const botPos = bot.entity?.position;
			const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
			const botCz = botPos ? Math.floor(botPos.z / 16) : 0;
			for (const [key, buf] of entry.chunkCache) {
				const [x, z] = key.split(",").map(Number) as [number, number];
				if (
					Math.abs(x - botCx) <= viewDistance &&
					Math.abs(z - botCz) <= viewDistance
				) {
					sendTo(ws, {
						type: "chunk",
						botId: name,
						x,
						z,
						buf: buf.toString("base64"),
					});
				}
			}
		}
	});

	// ── Bot management ──

	const addBot = (bot: Bot, name: string) => {
		const chunkCache = new Map<string, Buffer>();
		const cleanups: (() => void)[] = [];

		const onMove = () => {
			if (!bot.entity) return;
			broadcast({
				type: "position",
				botId: name,
				x: bot.entity.position.x,
				y: bot.entity.position.y,
				z: bot.entity.position.z,
				yaw: bot.entity.yaw,
				pitch: bot.entity.pitch,
			});
		};

		const onMapChunk = (packet: Record<string, unknown>) => {
			const x = packet.x as number;
			const z = packet.z as number;
			const chunkData = packet.chunkData as Buffer;
			chunkCache.set(chunkKey(x, z), chunkData);

			const botPos = bot.entity?.position;
			const botCx = botPos ? Math.floor(botPos.x / 16) : 0;
			const botCz = botPos ? Math.floor(botPos.z / 16) : 0;
			if (
				Math.abs(x - botCx) <= viewDistance &&
				Math.abs(z - botCz) <= viewDistance
			) {
				broadcast({
					type: "chunk",
					botId: name,
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
			broadcast({ type: "unloadChunk", botId: name, x, z });
		};

		const onBlockChange = (packet: Record<string, unknown>) => {
			const loc = packet.location as Record<string, number>;
			if (!loc) return;
			broadcast({
				type: "blockUpdate",
				botId: name,
				x: loc.x,
				y: loc.y,
				z: loc.z,
				stateId: packet.type as number,
			});
		};

		const onEntitySpawn = (entity: Entity) => {
			if (entity.id === bot.entity?.id) return;
			const skinUrl =
				entity.type === "player" && entity.uuid
					? `/skins/${entity.uuid}.png`
					: undefined;
			broadcast({
				type: "entitySpawn",
				botId: name,
				id: entity.id,
				entityName: entity.name ?? "unknown",
				username: entity.username ?? null,
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
				botId: name,
				id: entity.id,
				x: entity.position.x,
				y: entity.position.y,
				z: entity.position.z,
				yaw: entity.yaw,
			});
		};

		const onEntityGone = (entity: Entity) => {
			broadcast({ type: "entityGone", botId: name, id: entity.id });
		};

		const onEntityEquip = (entity: Entity) => {
			if (entity.id === bot.entity?.id) return;
			const equipment = (entity as unknown as Record<string, unknown>)
				.equipment as Array<{ name?: string } | null> | undefined;
			broadcast({
				type: "entityEquip",
				botId: name,
				id: entity.id,
				slot: 0,
				itemName: equipment?.[0]?.name ?? null,
			});
		};

		bot.on("move", onMove);
		bot.on("forcedMove", onMove);

		// Position heartbeat — poll bot position every 500ms regardless of events.
		// Events (move/forcedMove) may not fire for spectator bots or between tp's.
		const positionHeartbeat = setInterval(() => {
			if (bot.entity) onMove();
		}, 500);

		bot.on("entitySpawn", onEntitySpawn);
		bot.on("entityMoved", onEntityMoved);
		bot.on("entityGone", onEntityGone);
		bot.on("entityEquip", onEntityEquip);
		bot.client.on("level_chunk_with_light", onMapChunk);
		bot.client.on("forget_level_chunk", onUnloadChunk);
		bot.client.on("block_update", onBlockChange);

		// Pre-populate chunkCache from chunks already in bot.world
		if (bot.world) {
			for (const [key, column] of bot.world.columns) {
				if (!chunkCache.has(key)) {
					const [cx, cz] = key.split(",").map(Number) as [number, number];
					chunkCache.set(chunkKey(cx, cz), dumpChunkColumn(column, true));
				}
			}
		}

		cleanups.push(() => {
			clearInterval(positionHeartbeat);
			bot.removeListener("move", onMove);
			bot.removeListener("forcedMove", onMove);
			bot.removeListener("entitySpawn", onEntitySpawn);
			bot.removeListener("entityMoved", onEntityMoved);
			bot.removeListener("entityGone", onEntityGone);
			bot.removeListener("entityEquip", onEntityEquip);
			bot.client.removeListener("level_chunk_with_light", onMapChunk);
			bot.client.removeListener("forget_level_chunk", onUnloadChunk);
			bot.client.removeListener("block_update", onBlockChange);
		});

		bots.set(name, { bot, name, chunkCache, cleanups });
		broadcast({ type: "botAdd", botId: name });

		// Send assets to browser when the first bot with a registry is added
		const trySendAssets = () => {
			if (cachedAssets) return; // already sent
			if (!bot.registry) return;
			const assets = getAssets(bot);
			for (const ws of clients) {
				if (ws.readyState === ws.OPEN) sendTo(ws, assets);
			}
		};

		if (bot.registry) {
			trySendAssets();
		} else {
			bot.once("spawn", trySendAssets);
			cleanups.push(() => bot.removeListener("spawn", trySendAssets));
		}

		// Send init + current state for this bot to all connected clients
		const sendBotState = () => {
			broadcast({
				type: "init",
				botId: name,
				version: bot.version,
				minY: bot.game.minY,
				height: bot.game.height,
			});
			if (bot.entity) {
				broadcast({
					type: "position",
					botId: name,
					x: bot.entity.position.x,
					y: bot.entity.position.y,
					z: bot.entity.position.z,
					yaw: bot.entity.yaw,
					pitch: bot.entity.pitch,
				});
			}
		};

		if (bot.entity) {
			sendBotState();
		} else {
			bot.once("spawn", sendBotState);
			cleanups.push(() => bot.removeListener("spawn", sendBotState));
		}
	};

	const removeBot = (name: string) => {
		const entry = bots.get(name);
		if (!entry) return;
		for (const cleanup of entry.cleanups) cleanup();
		bots.delete(name);
		broadcast({ type: "botRemove", botId: name });
	};

	// ── Start ──

	server.listen(port, () => {
		console.log(`[dashboard] http://localhost:${port} (${bots.size} bots)`);
	});

	const close = () => {
		for (const [name] of bots) removeBot(name);
		for (const ws of clients) ws.close();
		clients.clear();
		wss.close();
		server.close();
	};

	// Expose addBot/removeBot via the returned object
	const dashboard: Dashboard & {
		addBot: (bot: Bot, name: string) => void;
		removeBot: (name: string) => void;
	} = { server, wss, close, addBot, removeBot };

	return dashboard;
};

/** Add a bot to the dashboard. */
export const addBotToDashboard = (
	dashboard: Dashboard,
	bot: Bot,
	name: string,
): void => {
	(dashboard as unknown as { addBot: (b: Bot, n: string) => void }).addBot(
		bot,
		name,
	);
};

/** Remove a bot from the dashboard. */
export const removeBotFromDashboard = (
	dashboard: Dashboard,
	name: string,
): void => {
	(dashboard as unknown as { removeBot: (n: string) => void }).removeBot(name);
};

/** Close the dashboard server. */
export const closeDashboard = (dashboard: Dashboard): void => {
	dashboard.close();
};
