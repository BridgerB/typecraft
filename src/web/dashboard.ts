/**
 * Multi-bot dashboard server — single HTTP + WebSocket server that streams
 * data from multiple bots to a grid-view browser client.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { extname, resolve } from "node:path";
import { type WebSocket, WebSocketServer } from "ws";
import type { Bot } from "../bot/types.ts";
import type { Entity } from "../entity/types.ts";
import { loadMcAssets } from "./serve.ts";

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
	const viewDistance = options?.viewDistance ?? 4;
	const distDir = resolve(import.meta.dirname, "../../dist");
	const threeDir = resolve(import.meta.dirname, "../../node_modules/three/build");

	const clients = new Set<WebSocket>();
	const bots = new Map<string, BotEntry>();
	const chunkKey = (x: number, z: number) => `${x},${z}`;

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
<script type="importmap">
{ "imports": { "three": "/vendor/three.module.js" } }
</script>
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

		if (req.url?.startsWith("/vendor/")) {
			const vendorFile = resolve(threeDir, req.url.slice("/vendor/".length));
			if (!vendorFile.startsWith(threeDir) || !existsSync(vendorFile)) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}
			res.writeHead(200, { "Content-Type": "text/javascript" });
			res.end(readFileSync(vendorFile));
			return;
		}

		const filePath = resolve(distDir, `.${req.url}`);
		if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}

		const ext = extname(filePath);
		res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
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
				if (Math.abs(x - botCx) <= viewDistance && Math.abs(z - botCz) <= viewDistance) {
					sendTo(ws, { type: "chunk", botId: name, x, z, buf: buf.toString("base64") });
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
			if (Math.abs(x - botCx) <= viewDistance && Math.abs(z - botCz) <= viewDistance) {
				broadcast({ type: "chunk", botId: name, x, z, buf: chunkData.toString("base64") });
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
			broadcast({
				type: "entitySpawn",
				botId: name,
				id: entity.id,
				entityName: entity.name ?? "unknown",
				username: entity.username ?? null,
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

		bot.on("move", onMove);
		bot.on("entitySpawn", onEntitySpawn);
		bot.on("entityMoved", onEntityMoved);
		bot.on("entityGone", onEntityGone);
		bot.client.on("level_chunk_with_light", onMapChunk);
		bot.client.on("forget_level_chunk", onUnloadChunk);
		bot.client.on("block_update", onBlockChange);

		cleanups.push(() => {
			bot.removeListener("move", onMove);
			bot.removeListener("entitySpawn", onEntitySpawn);
			bot.removeListener("entityMoved", onEntityMoved);
			bot.removeListener("entityGone", onEntityGone);
			bot.client.removeListener("level_chunk_with_light", onMapChunk);
			bot.client.removeListener("forget_level_chunk", onUnloadChunk);
			bot.client.removeListener("block_update", onBlockChange);
		});

		bots.set(name, { bot, name, chunkCache, cleanups });
		broadcast({ type: "botAdd", botId: name });
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
	(dashboard as unknown as { addBot: (b: Bot, n: string) => void }).addBot(bot, name);
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
