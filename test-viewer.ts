/**
 * Minimal viewer test — connects a bot, starts the web viewer.
 * Use MCP Playwright tools to browse http://localhost:3456 and take screenshots.
 *
 * Usage: npx tsx test-viewer.ts
 *        Then use Playwright MCP to navigate to http://localhost:3456
 */

import { createBot } from "./src/bot/createBot.ts";
import { createWebViewer } from "./src/web/serve.ts";

const PORT = 3456;
const MC_HOST = "localhost";
const MC_PORT = 8973;

const main = async () => {
	console.log("[test] Connecting bot to", MC_HOST + ":" + MC_PORT);

	const bot = createBot({
		host: MC_HOST,
		port: MC_PORT,
		username: "ViewerTest",
		version: "1.21.11",
		auth: "offline",
	});

	bot.on("error", (err) => console.error("[bot error]", err.message));

	await new Promise<void>((resolve, reject) => {
		bot.once("spawn", () => {
			console.log("[test] Bot spawned at", bot.entity?.position);
			resolve();
		});
		bot.once("end", (reason) => reject(new Error("Bot ended: " + reason)));
	});

	console.log("[test] Starting web viewer on port", PORT);
	createWebViewer(bot, { port: PORT, viewDistance: 6 });

	console.log("[test] Viewer running at http://localhost:" + PORT);
	console.log("[test] Press Ctrl+C to stop");
};

main().catch((err) => {
	console.error("[test] Fatal:", err);
	process.exit(1);
});
