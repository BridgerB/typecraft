import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build, context } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "dist/web");
const watch = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });

const shared = {
	bundle: true,
	platform: "browser" as const,
	format: "esm" as const,
	sourcemap: true,
	treeShaking: true,
	inject: [resolve(root, "scripts/buffer-shim.ts")],
	define: { "process.env.NODE_ENV": '"production"' },
	loader: { ".ts": "ts" as const },
};

// Two browser bundles, both consumed by the eye-of-steve dashboard:
//   viewer.js — embeddable Babylon viewer (mountViewer, from web/embed.ts)
//   worker.js — chunk-mesher web worker (from web/clientWorker.ts)
// The viewer's HTTP server (web/serve.ts) is separate and runs in the bot.

const buildAll = async () => {
	await Promise.all([
		build({
			...shared,
			entryPoints: [resolve(root, "src/web/embed.ts")],
			outfile: resolve(outdir, "viewer.js"),
		}),
		build({
			...shared,
			entryPoints: [resolve(root, "src/web/clientWorker.ts")],
			outfile: resolve(outdir, "worker.js"),
		}),
	]);
	console.log("Built dist/web/ (viewer.js, worker.js)");
};

if (watch) {
	const ctx = await context({
		...shared,
		entryPoints: [
			resolve(root, "src/web/embed.ts"),
			resolve(root, "src/web/clientWorker.ts"),
		],
		outdir,
		splitting: false,
	});
	await ctx.watch();
	console.log("Watching for changes...");
} else {
	await buildAll();
}
