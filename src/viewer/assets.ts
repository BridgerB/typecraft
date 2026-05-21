/**
 * Asset pipeline: load block models, textures, and block states from src/data/assets/.
 * Builds a texture atlas and resolves all model references for use by the mesher.
 */

import type { Registry } from "../registry/index.ts";

// ── Types ──

export type TextureUV = {
	readonly u: number;
	readonly v: number;
	readonly su: number;
	readonly sv: number;
};

export type TextureAtlas = {
	readonly canvas: OffscreenCanvas;
	readonly uvMap: Readonly<Record<string, TextureUV>>;
	readonly tileSize: number;
	readonly atlasSize: number;
};

export type BlockModelFace = {
	texture: TextureUV;
	cullface?: string;
	tintindex?: number;
	rotation?: number;
};

export type BlockModelElement = {
	readonly from: readonly [number, number, number];
	readonly to: readonly [number, number, number];
	readonly rotation?: {
		readonly origin: readonly [number, number, number];
		readonly axis: "x" | "y" | "z";
		readonly angle: number;
	};
	readonly faces: Readonly<Record<string, BlockModelFace>>;
};

/** A block-entity quad: 4 vertices, each [x, y, z, atlasU, atlasV]. */
export type BeQuad = readonly (readonly number[])[];

export type BlockModel = {
	readonly elements: readonly BlockModelElement[];
	readonly ao: boolean;
	readonly textures: Readonly<Record<string, unknown>>;
	/** Block-entity geometry (signs/chests/…) — pre-resolved atlas-space quads. */
	beQuads?: readonly BeQuad[];
};

export type BlockModelVariant = {
	readonly model: BlockModel;
	readonly x?: number;
	readonly y?: number;
	readonly z?: number;
	readonly uvlock?: boolean;
};

export type MultipartCase = {
	readonly when?:
		| Readonly<Record<string, string>>
		| { readonly OR: readonly Record<string, string>[] };
	readonly apply: BlockModelVariant | readonly BlockModelVariant[];
};

export type BlockStateDefinition = {
	readonly variants?: Readonly<
		Record<string, BlockModelVariant | readonly BlockModelVariant[]>
	>;
	readonly multipart?: readonly MultipartCase[];
};

export type ResolvedBlockStates = Readonly<
	Record<string, BlockStateDefinition>
>;

export type BiomeTints = {
	readonly grass: ReadonlyMap<string, readonly [number, number, number]>;
	readonly foliage: ReadonlyMap<string, readonly [number, number, number]>;
	readonly water: ReadonlyMap<string, readonly [number, number, number]>;
	readonly redstone: ReadonlyMap<string, readonly [number, number, number]>;
	readonly constant: ReadonlyMap<string, readonly [number, number, number]>;
	readonly grassDefault: readonly [number, number, number];
	readonly foliageDefault: readonly [number, number, number];
	readonly waterDefault: readonly [number, number, number];
};

// ── Helpers ──

const nextPowerOfTwo = (n: number): number => {
	if (n === 0) return 1;
	let v = n - 1;
	v |= v >> 1;
	v |= v >> 2;
	v |= v >> 4;
	v |= v >> 8;
	v |= v >> 16;
	return v + 1;
};

const cleanupBlockName = (name: string): string => {
	if (name.startsWith("minecraft:block/"))
		return name.slice("minecraft:block/".length);
	if (name.startsWith("block/")) return name.slice("block/".length);
	return name;
};

const tintToGl = (color: number): readonly [number, number, number] => {
	const r = (color >> 16) & 0xff;
	const g = (color >> 8) & 0xff;
	const b = color & 0xff;
	return [r / 255, g / 255, b / 255] as const;
};

// ── Texture atlas ──

/** A non-16x16 texture (block-entity sheet) packed into the atlas. */
export type EntitySheet = {
	readonly name: string;
	readonly width: number;
	readonly height: number;
};

type AtlasPlacement = {
	uvMap: Record<string, TextureUV>;
	atlasSize: number;
	texSize: number;
	/** Pixel placement for each entity sheet, keyed by name. */
	sheetPlacements: Record<string, { x: number; y: number }>;
};

/**
 * Lay out the atlas: block textures fill a 16x16-cell grid row-major; entity
 * sheets (variable size) are shelf-packed into the cells after them.
 */
const layoutAtlas = (
	blockTextures: readonly string[],
	entitySheets: readonly EntitySheet[],
): AtlasPlacement => {
	const tileSize = 16;
	const blockCells = blockTextures.length;
	// Cell footprint of every entity sheet.
	const sheetCells = entitySheets.reduce(
		(sum, s) => sum + Math.ceil(s.width / 16) * Math.ceil(s.height / 16),
		0,
	);
	const texSize = nextPowerOfTwo(
		Math.ceil(Math.sqrt(blockCells + sheetCells * 1.4)),
	);
	const uvMap: Record<string, TextureUV> = {};
	const sheetPlacements: Record<string, { x: number; y: number }> = {};

	// Block textures: one 16x16 cell each, row-major.
	for (let i = 0; i < blockTextures.length; i++) {
		const cx = i % texSize;
		const cy = Math.floor(i / texSize);
		const name = blockTextures[i]!.replace(".png", "");
		uvMap[name] = { u: cx, v: cy, su: 1, sv: 1 };
	}

	// Entity sheets: shelf-pack into cell rows below the block grid.
	let shelfRow = Math.ceil(blockCells / texSize);
	let shelfCol = 0;
	let shelfH = 0;
	for (const sheet of entitySheets) {
		const cw = Math.ceil(sheet.width / 16);
		const ch = Math.ceil(sheet.height / 16);
		if (shelfCol + cw > texSize) {
			shelfRow += shelfH;
			shelfCol = 0;
			shelfH = 0;
		}
		uvMap[sheet.name] = { u: shelfCol, v: shelfRow, su: cw, sv: ch };
		sheetPlacements[sheet.name] = {
			x: shelfCol * tileSize,
			y: shelfRow * tileSize,
		};
		shelfCol += cw;
		shelfH = Math.max(shelfH, ch);
	}
	const neededRows = shelfRow + shelfH;
	const atlasSize = nextPowerOfTwo(Math.max(texSize, neededRows)) * tileSize;

	// Convert cell coords to normalized UVs now that atlasSize is known.
	for (const [name, uv] of Object.entries(uvMap)) {
		uvMap[name] = {
			u: (uv.u * tileSize) / atlasSize,
			v: (uv.v * tileSize) / atlasSize,
			su: (uv.su * tileSize) / atlasSize,
			sv: (uv.sv * tileSize) / atlasSize,
		};
	}

	return { uvMap, atlasSize, texSize, sheetPlacements };
};

/** Compute UV map without a canvas — pure math, works on server. */
export const computeUvMap = (
	textureFiles: readonly string[],
	entitySheets: readonly EntitySheet[] = [],
): {
	uvMap: Record<string, TextureUV>;
	tileSize: number;
	atlasSize: number;
	texSize: number;
} => {
	const { uvMap, atlasSize, texSize } = layoutAtlas(textureFiles, entitySheets);
	return { uvMap, tileSize: 16, atlasSize, texSize };
};

export const createTextureAtlas = (
	textureFiles: readonly string[],
	loadImage: (name: string) => ImageBitmap | HTMLImageElement,
	entitySheets: readonly EntitySheet[] = [],
	loadSheet?: (name: string) => ImageBitmap | HTMLImageElement,
): TextureAtlas => {
	const { uvMap, atlasSize, texSize, sheetPlacements } = layoutAtlas(
		textureFiles,
		entitySheets,
	);

	const canvas = new OffscreenCanvas(atlasSize, atlasSize);
	const ctx = canvas.getContext("2d")!;

	for (let i = 0; i < textureFiles.length; i++) {
		const x = (i % texSize) * 16;
		const y = Math.floor(i / texSize) * 16;
		const img = loadImage(textureFiles[i]!);
		ctx.drawImage(img, 0, 0, 16, 16, x, y, 16, 16);
	}

	if (loadSheet) {
		for (const sheet of entitySheets) {
			const place = sheetPlacements[sheet.name];
			if (!place) continue;
			const img = loadSheet(sheet.name);
			ctx.drawImage(img, place.x, place.y, sheet.width, sheet.height);
		}
	}

	return { canvas, uvMap, tileSize: 16, atlasSize };
};

// ── Model resolution ──

type RawBlockModels = Readonly<
	Record<
		string,
		{
			parent?: string;
			textures?: Record<string, string>;
			elements?: readonly RawElement[];
			ambientocclusion?: boolean;
		}
	>
>;

type RawElement = {
	from: [number, number, number];
	to: [number, number, number];
	rotation?: { origin: [number, number, number]; axis: string; angle: number };
	faces: Record<
		string,
		{
			texture: string;
			cullface?: string;
			tintindex?: number;
			rotation?: number;
			uv?: number[];
		}
	>;
};

type MutableModel = {
	textures: Record<string, string>;
	elements: RawElement[];
	ao: boolean;
};

const getModel = (
	name: string,
	blocksModels: RawBlockModels,
): MutableModel | null => {
	const cleanName = cleanupBlockName(name);
	const data = blocksModels[cleanName];
	if (!data) return null;

	let model: MutableModel = { textures: {}, elements: [], ao: true };

	if (data.parent) {
		const parentModel = getModel(data.parent, blocksModels);
		if (parentModel) model = parentModel;
	}

	if (data.textures) {
		Object.assign(model.textures, JSON.parse(JSON.stringify(data.textures)));
	}
	if (data.elements) {
		model.elements = JSON.parse(JSON.stringify(data.elements));
	}
	if (data.ambientocclusion !== undefined) {
		model.ao = data.ambientocclusion;
	}

	return model;
};

const prepareModel = (
	model: MutableModel,
	uvMap: Readonly<Record<string, TextureUV>>,
): void => {
	// Resolve texture name references (e.g. #all → stone)
	for (const tex in model.textures) {
		let root = model.textures[tex]!;
		while (root.charAt(0) === "#") {
			root = model.textures[root.slice(1)]!;
			if (!root) break;
		}
		if (root) model.textures[tex] = root;
	}

	// Replace texture names with atlas UV coords
	for (const tex in model.textures) {
		const name = cleanupBlockName(model.textures[tex]!);
		const uv = uvMap[name];
		if (uv) {
			(model.textures as Record<string, unknown>)[tex] = uv;
		}
	}

	// Resolve element face textures
	for (const elem of model.elements) {
		for (const sideName of Object.keys(elem.faces)) {
			const face = elem.faces[sideName]!;
			let resolvedTexture: TextureUV | undefined;

			if (face.texture.charAt(0) === "#") {
				const ref = model.textures[face.texture.slice(1)];
				// Only accept resolved TextureUV objects (not leftover strings)
				if (ref && typeof ref === "object") {
					resolvedTexture = ref as unknown as TextureUV;
				}
			} else {
				const name = cleanupBlockName(face.texture);
				resolvedTexture = uvMap[name];
				// Fallback: some non-standard models reference textures-map keys
				// without the `#` prefix (e.g. heavy_core uses "all" not "#all").
				if (!resolvedTexture) {
					const ref = model.textures[face.texture];
					if (ref && typeof ref === "object") {
						resolvedTexture = ref as unknown as TextureUV;
					}
				}
			}

			if (!resolvedTexture || !Number.isFinite(resolvedTexture.u)) continue;

			// Compute sub-UV from element bounds
			let uv = face.uv;
			if (!uv) {
				const _from = elem.from;
				const _to = elem.to;
				uv = (
					{
						north: [_to[0], 16 - _to[1], _from[0], 16 - _from[1]],
						east: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
						south: [_from[0], 16 - _to[1], _to[0], 16 - _from[1]],
						west: [_from[2], 16 - _to[1], _to[2], 16 - _from[1]],
						up: [_from[0], _from[2], _to[0], _to[2]],
						down: [_to[0], _from[2], _from[0], _to[2]],
					} as Record<string, number[]>
				)[sideName]!;
			}

			const baseTexture = { ...resolvedTexture };
			const su = ((uv[2]! - uv[0]!) * baseTexture.su) / 16;
			const sv = ((uv[3]! - uv[1]!) * baseTexture.sv) / 16;
			const finalTexture: TextureUV = {
				u: baseTexture.u + (uv[0]! * baseTexture.su) / 16,
				v: baseTexture.v + (uv[1]! * baseTexture.sv) / 16,
				su,
				sv,
			};

			(face as Record<string, unknown>).texture = finalTexture;
		}
	}
};

const resolveModel = (
	name: string,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
): BlockModel | null => {
	const model = getModel(name, blocksModels);
	if (!model) return null;
	prepareModel(model, uvMap);
	return model as unknown as BlockModel;
};

// ── Block states preparation ──

export const prepareBlockStates = (
	blocksStates: Record<string, unknown>,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
	blockEntityShapes?: Record<string, { sheet: string; quads: number[][][] }>,
): ResolvedBlockStates => {
	const result: Record<string, BlockStateDefinition> = {};

	for (const [blockName, stateDef] of Object.entries(blocksStates)) {
		if (!stateDef || typeof stateDef !== "object") continue;

		const def = stateDef as Record<string, unknown>;

		if (def.variants && typeof def.variants === "object") {
			const variants: Record<string, BlockModelVariant | BlockModelVariant[]> =
				{};

			for (const [props, variant] of Object.entries(
				def.variants as Record<string, unknown>,
			)) {
				if (Array.isArray(variant)) {
					const resolved: BlockModelVariant[] = [];
					for (const v of variant) {
						const rv = resolveVariant(
							v as Record<string, unknown>,
							blocksModels,
							uvMap,
						);
						if (rv) resolved.push(rv);
					}
					if (resolved.length > 0) variants[props] = resolved;
				} else {
					const rv = resolveVariant(
						variant as Record<string, unknown>,
						blocksModels,
						uvMap,
					);
					if (rv) variants[props] = rv;
				}
			}

			result[blockName] = { variants };
		}

		if (def.multipart && Array.isArray(def.multipart)) {
			const parts: MultipartCase[] = [];

			for (const part of def.multipart) {
				const p = part as { when?: unknown; apply: unknown };
				let apply: BlockModelVariant | BlockModelVariant[];

				if (Array.isArray(p.apply)) {
					const resolved: BlockModelVariant[] = [];
					for (const v of p.apply) {
						const rv = resolveVariant(
							v as Record<string, unknown>,
							blocksModels,
							uvMap,
						);
						if (rv) resolved.push(rv);
					}
					apply = resolved;
				} else {
					const rv = resolveVariant(
						p.apply as Record<string, unknown>,
						blocksModels,
						uvMap,
					);
					if (!rv) continue;
					apply = rv;
				}

				parts.push({
					when: p.when as MultipartCase["when"],
					apply,
				});
			}

			result[blockName] = { ...result[blockName], multipart: parts };
		}
	}

	// Inject block-entity geometry (signs/chests/banners/…) for blocks whose
	// block model has no `elements`. Their real shape was baked from Minecraft's
	// block-entity renderers into blockEntityShapes (quads with sheet-normalized
	// UVs). We resolve each quad's UV into the atlas region of its texture sheet
	// and attach the result to the model as `beQuads` for the mesher.
	if (blockEntityShapes) {
		for (const [blockName, shape] of Object.entries(blockEntityShapes)) {
			const def = result[blockName];
			if (!def?.variants) continue;
			const first = Object.values(def.variants)[0];
			const variant = Array.isArray(first) ? first[0] : first;
			const model = variant?.model as
				| { elements?: unknown[]; beQuads?: unknown }
				| undefined;
			if (!model) continue;

			const region = uvMap[shape.sheet];
			if (!region || !Number.isFinite(region.u)) continue;

			// quad vert [x,y,z,u,v] → [x,y,z, atlasU, atlasV]
			model.beQuads = shape.quads.map((quad) =>
				quad.map((vt) => [
					vt[0]!,
					vt[1]!,
					vt[2]!,
					region.u + vt[3]! * region.su,
					region.v + vt[4]! * region.sv,
				]),
			);
		}
	}

	return result;
};

const resolveVariant = (
	v: Record<string, unknown>,
	blocksModels: RawBlockModels,
	uvMap: Readonly<Record<string, TextureUV>>,
): BlockModelVariant | null => {
	const modelName = v.model as string;
	if (!modelName) return null;
	const model = resolveModel(modelName, blocksModels, uvMap);
	if (!model) return null;

	return {
		model,
		...(v.x !== undefined ? { x: v.x as number } : {}),
		...(v.y !== undefined ? { y: v.y as number } : {}),
		...(v.z !== undefined ? { z: v.z as number } : {}),
		...(v.uvlock !== undefined ? { uvlock: v.uvlock as boolean } : {}),
	};
};

// ── Biome tints ──

export const prepareBiomeTints = (registry: Registry): BiomeTints => {
	const tints = (registry as unknown as { raw: { tints: RawTints } }).raw
		?.tints;
	if (!tints) {
		// Fallback: build from minecraft-data directly
		return prepareBiomeTintsFromMcData(registry.version.minecraftVersion);
	}
	return buildTints(tints);
};

type RawTints = {
	grass: { default?: number; data: { keys: string[]; color: number }[] };
	foliage: { default?: number; data: { keys: string[]; color: number }[] };
	water: { default?: number; data: { keys: string[]; color: number }[] };
	redstone: { data: { keys: (string | number)[]; color: number }[] };
	constant: { data: { keys: string[]; color: number }[] };
};

const prepareBiomeTintsFromMcData = (_version: string): BiomeTints => {
	// Fallback — return defaults when registry has no tints
	return {
		grass: new Map(),
		foliage: new Map(),
		water: new Map(),
		redstone: new Map(),
		constant: new Map(),
		grassDefault: [0.48, 0.74, 0.31],
		foliageDefault: [0.48, 0.74, 0.31],
		waterDefault: [0.25, 0.29, 0.98],
	};
};

const buildTints = (tints: RawTints): BiomeTints => {
	const buildMap = (
		data: { keys: (string | number)[]; color: number }[],
	): Map<string, readonly [number, number, number]> => {
		const map = new Map<string, readonly [number, number, number]>();
		for (const entry of data) {
			if (entry.color === 0) continue; // 0 = use default colormap color
			const color = tintToGl(entry.color);
			for (const key of entry.keys) {
				map.set(`${key}`, color);
			}
		}
		return map;
	};

	return {
		grass: buildMap(tints.grass.data),
		foliage: buildMap(tints.foliage.data),
		water: buildMap(tints.water.data),
		redstone: buildMap(tints.redstone.data),
		constant: buildMap(tints.constant.data),
		grassDefault:
			tints.grass.default !== undefined
				? tintToGl(tints.grass.default)
				: [0.48, 0.74, 0.31],
		foliageDefault:
			tints.foliage.default !== undefined
				? tintToGl(tints.foliage.default)
				: [0.48, 0.74, 0.31],
		waterDefault:
			tints.water.default !== undefined
				? tintToGl(tints.water.default)
				: [0.25, 0.29, 0.98],
	};
};

// ── High-level loader ──

export type McAssets = {
	blocksStates: Record<string, unknown>;
	blocksModels: RawBlockModels;
	directory: string;
};

/** Load all viewer assets for a given minecraft version. */
export const loadAssets = (
	mcAssets: McAssets,
	textureFileNames: readonly string[],
	loadImage: (name: string) => ImageBitmap | HTMLImageElement,
): { atlas: TextureAtlas; blockStates: ResolvedBlockStates } => {
	const atlas = createTextureAtlas(textureFileNames, loadImage);
	const blockStates = prepareBlockStates(
		mcAssets.blocksStates,
		mcAssets.blocksModels,
		atlas.uvMap,
	);
	return { atlas, blockStates };
};
