import { cpSync, mkdirSync } from "node:fs";
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

const buildAll = async () => {
	// Client bundle
	const clientBuild = build({
		...shared,
		entryPoints: [resolve(root, "src/web/client.ts")],
		outfile: resolve(outdir, "client.js"),
	});

	// Worker bundle
	const workerBuild = build({
		...shared,
		entryPoints: [resolve(root, "src/web/clientWorker.ts")],
		outfile: resolve(outdir, "worker.js"),
	});

	await Promise.all([clientBuild, workerBuild]);

	cpSync(resolve(root, "src/web/client.html"), resolve(outdir, "index.html"));
	console.log("Built dist/web/ (client.js, worker.js, index.html)");
};

if (watch) {
	const ctx = await context({
		...shared,
		entryPoints: [
			resolve(root, "src/web/client.ts"),
			resolve(root, "src/web/clientWorker.ts"),
		],
		outdir,
		splitting: false,
	});
	cpSync(resolve(root, "src/web/client.html"), resolve(outdir, "index.html"));
	await ctx.watch();
	console.log("Watching for changes...");
} else {
	await buildAll();
}
