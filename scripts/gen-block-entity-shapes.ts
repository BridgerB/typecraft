/**
 * Generates src/data/blockEntityShapes.json — real geometry + texture mapping
 * for block entities (signs, chests, banners, beds, shulkers, …) that have no
 * block-model `elements`.
 *
 * Input: src/data/blockEntityModels.json — baked model geometry extracted from
 * Minecraft (quads of [x,y,z,u,v], u/v normalized to each model's texture sheet).
 *
 * For each block-entity block we pick the matching model layer(s), normalize
 * the geometry into block space (0-16, centered, scaled to fit, Y/Z-flipped to
 * undo the entity-render convention), and record which entity texture sheet it
 * uses. Output per block: { sheet, quads: [[x,y,z,u,v] x4] }.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Vert = number[]; // [x,y,z,u,v]
type Quad = Vert[]; // 4 verts
type RawModels = Record<string, Quad[]>;

const root = resolve(import.meta.dirname, "..");
const models: RawModels = JSON.parse(
	readFileSync(resolve(root, "src/data/blockEntityModels.json"), "utf8"),
);
const blocks: { name: string }[] = JSON.parse(
	readFileSync(resolve(root, "src/data/blocks.json"), "utf8"),
);

const woodTypes = [
	"oak",
	"spruce",
	"birch",
	"acacia",
	"cherry",
	"jungle",
	"dark_oak",
	"pale_oak",
	"mangrove",
	"bamboo",
	"crimson",
	"warped",
];
const dyeColors = [
	"white",
	"orange",
	"magenta",
	"light_blue",
	"yellow",
	"lime",
	"pink",
	"gray",
	"light_gray",
	"cyan",
	"purple",
	"blue",
	"brown",
	"green",
	"red",
	"black",
];

const startsWithColor = (name: string): string | undefined =>
	dyeColors.find((c) => name.startsWith(`${c}_`));

/** Map a block name to { layers, sheet }. layers are concatenated for geometry. */
const mapBlock = (name: string): { layers: string[]; sheet: string } | null => {
	const wood = woodTypes.find((t) => name.startsWith(`${t}_`));

	if (name.endsWith("_wall_hanging_sign") && wood)
		return {
			layers: [`minecraft:hanging_sign/${wood}/wall#main`],
			sheet: `signs/hanging/${wood}`,
		};
	if (name.endsWith("_hanging_sign") && wood)
		return {
			layers: [`minecraft:hanging_sign/${wood}/ceiling#main`],
			sheet: `signs/hanging/${wood}`,
		};
	if (name.endsWith("_wall_sign") && wood)
		return {
			layers: [`minecraft:sign/wall/${wood}#main`],
			sheet: `signs/${wood}`,
		};
	if (name.endsWith("_sign") && wood)
		return {
			layers: [`minecraft:sign/standing/${wood}#main`],
			sheet: `signs/${wood}`,
		};

	if (name.endsWith("_wall_banner"))
		return {
			layers: ["minecraft:wall_banner#main", "minecraft:wall_banner#flag"],
			sheet: "banner/base",
		};
	if (name.endsWith("_banner"))
		return {
			layers: [
				"minecraft:standing_banner#main",
				"minecraft:standing_banner#flag",
			],
			sheet: "banner/base",
		};

	if (name === "chest" || name === "trapped_chest")
		return { layers: ["minecraft:chest#main"], sheet: "chest/normal" };
	if (name === "ender_chest")
		return { layers: ["minecraft:chest#main"], sheet: "chest/ender" };
	if (name.endsWith("_chest"))
		// copper chest variants
		return { layers: ["minecraft:chest#main"], sheet: "chest/normal" };

	if (name.endsWith("_bed")) {
		const color = startsWithColor(name) ?? "red";
		return {
			layers: ["minecraft:bed_head#main", "minecraft:bed_foot#main"],
			sheet: `bed/${color}`,
		};
	}

	if (name.endsWith("shulker_box")) {
		const color = startsWithColor(name);
		return {
			layers: ["minecraft:shulker#main"],
			sheet: color ? `shulker/shulker_${color}` : "shulker/shulker",
		};
	}

	// Skulls / mob heads (standing + wall variants).
	if (
		name.endsWith("_skull") ||
		name.endsWith("_wall_skull") ||
		name.endsWith("_head") ||
		name.endsWith("_wall_head")
	) {
		if (name.includes("wither_skeleton"))
			return {
				layers: ["minecraft:wither_skeleton_skull#main"],
				sheet: "skeleton/wither_skeleton",
			};
		if (name.includes("skeleton"))
			return {
				layers: ["minecraft:skeleton_skull#main"],
				sheet: "skeleton/skeleton",
			};
		if (name.includes("zombie"))
			return { layers: ["minecraft:zombie_head#main"], sheet: "zombie/zombie" };
		if (name.includes("creeper"))
			return {
				layers: ["minecraft:creeper_head#main"],
				sheet: "creeper/creeper",
			};
		if (name.includes("piglin"))
			return { layers: ["minecraft:piglin_head#main"], sheet: "piglin/piglin" };
		if (name.includes("dragon"))
			return {
				layers: ["minecraft:dragon_skull#main"],
				sheet: "enderdragon/dragon",
			};
		if (name.includes("player"))
			return {
				layers: ["minecraft:player_head#main"],
				sheet: "player/wide/steve",
			};
	}

	// Copper golem statue — pose 'standing', oxidation-stage texture.
	if (name.includes("copper_golem_statue")) {
		let ox = "copper_golem";
		if (name.includes("exposed")) ox = "exposed_copper_golem";
		else if (name.includes("weathered")) ox = "weathered_copper_golem";
		else if (name.includes("oxidized")) ox = "oxidized_copper_golem";
		return {
			layers: ["minecraft:copper_golem#main"],
			sheet: `copper_golem/${ox}`,
		};
	}

	if (name === "conduit")
		return { layers: ["minecraft:conduit#shell"], sheet: "conduit/base" };
	if (name === "bell")
		return { layers: ["minecraft:bell#main"], sheet: "bell/bell_body" };
	if (name === "decorated_pot")
		return {
			layers: ["minecraft:decorated_pot_base#main"],
			sheet: "decorated_pot/decorated_pot_base",
		};

	return null;
};

/** Normalize geometry: flip Y/Z (undo entity render), centre + scale to 0-16. */
const normalize = (quads: Quad[]): Quad[] => {
	// Flip Y and Z — block-entity renderers apply scale(1,-1,-1) before drawing.
	const flipped = quads.map((q) =>
		q.map((v) => [v[0]!, -v[1]!, -v[2]!, v[3]!, v[4]!]),
	);

	const mn = [1e9, 1e9, 1e9];
	const mx = [-1e9, -1e9, -1e9];
	for (const q of flipped)
		for (const v of q)
			for (let i = 0; i < 3; i++) {
				mn[i] = Math.min(mn[i]!, v[i]!);
				mx[i] = Math.max(mx[i]!, v[i]!);
			}
	const center = [
		(mn[0]! + mx[0]!) / 2,
		(mn[1]! + mx[1]!) / 2,
		(mn[2]! + mx[2]!) / 2,
	];
	const maxDim = Math.max(
		mx[0]! - mn[0]!,
		mx[1]! - mn[1]!,
		mx[2]! - mn[2]!,
		1e-6,
	);
	const scale = 15 / maxDim; // fit within 15px, leave a margin

	return flipped.map((q) =>
		q.map((v) => [
			(v[0]! - center[0]!) * scale + 8,
			(v[1]! - center[1]!) * scale + 8,
			(v[2]! - center[2]!) * scale + 8,
			v[3]!,
			v[4]!,
		]),
	);
};

const out: Record<string, { sheet: string; quads: Quad[] }> = {};
let matched = 0;
const missing = new Set<string>();

for (const { name } of blocks) {
	const m = mapBlock(name);
	if (!m) continue;
	const quads: Quad[] = [];
	for (const layer of m.layers) {
		const lq = models[layer];
		if (!lq) {
			missing.add(layer);
			continue;
		}
		quads.push(...lq);
	}
	if (quads.length === 0) continue;
	out[name] = { sheet: m.sheet, quads: normalize(quads) };
	matched++;
}

writeFileSync(
	resolve(root, "src/data/blockEntityShapes.json"),
	JSON.stringify(out),
);
console.log(`block-entity shapes: ${matched} blocks`);
if (missing.size > 0) console.log("missing layers:", [...missing].join(", "));
