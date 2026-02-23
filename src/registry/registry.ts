import MinecraftData from "minecraft-data";
import type {
	BiomeDefinition,
	BlockDefinition,
	BlockStateProperty,
	Registry,
	VersionInfo,
} from "./types.js";

/**
 * Create a registry for a specific Minecraft version.
 * Loads block, biome, and version data from minecraft-data.
 *
 * @param version - Minecraft version string (e.g. "1.20.4", "1.18")
 * @returns A typed registry with block and biome lookups
 */
export const createRegistry = (version: string): Registry => {
	const mcData = MinecraftData(version);
	if (!mcData) {
		throw new Error(`Unsupported Minecraft version: ${version}`);
	}

	const blocksArray = mcData.blocksArray.map(toBlockDefinition);
	const biomesArray = mcData.biomesArray.map(toBiomeDefinition);

	const blocksById = new Map<number, BlockDefinition>();
	const blocksByName = new Map<string, BlockDefinition>();
	const blocksByStateId = new Map<number, BlockDefinition>();

	for (const block of blocksArray) {
		blocksById.set(block.id, block);
		blocksByName.set(block.name, block);
		for (let s = block.minStateId; s <= block.maxStateId; s++) {
			blocksByStateId.set(s, block);
		}
	}

	const biomesById = new Map<number, BiomeDefinition>();
	const biomesByName = new Map<string, BiomeDefinition>();

	for (const biome of biomesArray) {
		biomesById.set(biome.id, biome);
		biomesByName.set(biome.name, biome);
	}

	const versionInfo: VersionInfo = {
		type: mcData.type as "pc" | "bedrock",
		majorVersion: mcData.version.majorVersion ?? version,
		minecraftVersion: mcData.version.minecraftVersion ?? version,
		version: mcData.version.version ?? 0,
		dataVersion: mcData.version.dataVersion,
	};

	return {
		version: versionInfo,
		blocksById,
		blocksByName,
		blocksByStateId,
		blocksArray,
		biomesById,
		biomesByName,
		biomesArray,
		isNewerOrEqualTo: (v: string) => mcData.isNewerOrEqualTo(v),
		isOlderThan: (v: string) => mcData.isOlderThan(v),
		supportFeature: (f: string) => mcData.supportFeature(f as never) as boolean,
	};
};

const toBlockDefinition = (
	block: MinecraftData.IndexedBlock,
): BlockDefinition => ({
	id: block.id,
	name: block.name,
	displayName: block.displayName,
	hardness: block.hardness,
	resistance: block.resistance ?? null,
	stackSize: block.stackSize,
	diggable: block.diggable,
	boundingBox: block.boundingBox,
	material: block.material,
	transparent: block.transparent,
	emitLight: block.emitLight,
	filterLight: block.filterLight,
	defaultState: block.defaultState,
	minStateId: block.minStateId,
	maxStateId: block.maxStateId,
	states: (block.states ?? []).map(toBlockStateProperty),
	drops: block.drops ?? [],
});

type McBlockState = NonNullable<MinecraftData.Block["states"]>[number];

const toBlockStateProperty = (state: McBlockState): BlockStateProperty => ({
	name: state.name,
	type: state.type as BlockStateProperty["type"],
	num_values: state.num_values,
	values:
		state.values?.map(String) ??
		(state.type === "bool" ? ["true", "false"] : undefined),
});

const toBiomeDefinition = (biome: MinecraftData.Biome): BiomeDefinition => ({
	id: biome.id,
	name: biome.name,
	displayName: biome.displayName,
	category: biome.category,
	temperature: biome.temperature,
	dimension: biome.dimension,
	color: biome.color,
	precipitation: biome.precipitation,
	has_precipitation: biome.has_precipitation,
	rainfall: biome.rainfall,
});
