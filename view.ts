import { ping } from "./src/protocol/index.ts";
import { createBot } from "./src/bot/index.ts";
import { createWebViewer } from "./src/web/index.ts";

const info = await ping({ host: "localhost", port: 25565 });
console.log("Server:", info.version.name, "protocol:", info.version.protocol);

const bot = createBot({
	host: "localhost",
	port: 25565,
	username: "ViewerBot",
	version: info.version.name,
	auth: "offline",
});

bot.on("error", (err: Error) => console.error("[error]", err.message));
bot.on("login", () => console.log("[bot] Logged in, version:", bot.version));

bot.on("spawn", () => {
	console.log("[bot] Spawned at", bot.entity.position);
	createWebViewer(bot, { port: 3000, viewDistance: 6 });
});

let chunks = 0;
bot.on("chunkColumnLoad", () => {
	chunks++;
	if (chunks % 50 === 0) console.log(`[bot] ${chunks} chunks loaded`);
});

bot.on("kicked", (reason: string) => console.log("[bot] Kicked:", reason));
bot.on("end", (reason: string) => {
	console.log("[bot] Disconnected:", reason);
	process.exit(0);
});

console.log("Joining server...");
process.on("SIGINT", () => {
	console.log("\nDisconnecting...");
	bot.quit();
});
