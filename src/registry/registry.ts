import MinecraftData from "minecraft-data";
import type {
	AttributeDefinition,
	BiomeDefinition,
	BlockCollisionShapes,
	BlockDefinition,
	BlockStateProperty,
	EffectDefinition,
	EnchantmentDefinition,
	EntityDefinition,
	FoodDefinition,
	ItemDefinition,
	RawRecipe,
	Registry,
	VersionInfo,
} from "./types.ts";

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
	const itemsArray = mcData.itemsArray.map(toItemDefinition);
	const enchantmentsArray = mcData.enchantmentsArray.map(
		toEnchantmentDefinition,
	);
	const foodsArray = mcData.foodsArray.map(toFoodDefinition);
	const entitiesArray = mcData.entitiesArray.map(toEntityDefinition);

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

	const itemsById = new Map<number, ItemDefinition>();
	const itemsByName = new Map<string, ItemDefinition>();

	for (const item of itemsArray) {
		itemsById.set(item.id, item);
		itemsByName.set(item.name, item);
	}

	const enchantmentsById = new Map<number, EnchantmentDefinition>();
	const enchantmentsByName = new Map<string, EnchantmentDefinition>();

	for (const ench of enchantmentsArray) {
		enchantmentsById.set(ench.id, ench);
		enchantmentsByName.set(ench.name, ench);
	}

	const foodsById = new Map<number, FoodDefinition>();
	const foodsByName = new Map<string, FoodDefinition>();

	for (const food of foodsArray) {
		foodsById.set(food.id, food);
		foodsByName.set(food.name, food);
	}

	const entitiesById = new Map<number, EntityDefinition>();
	const entitiesByName = new Map<string, EntityDefinition>();

	for (const ent of entitiesArray) {
		entitiesById.set(ent.id, ent);
		entitiesByName.set(ent.name, ent);
	}

	const effectsArray = (mcData.effectsArray ?? []).map(toEffectDefinition);
	const attributesArray = (mcData.attributesArray ?? []).map(
		toAttributeDefinition,
	);

	const effectsById = new Map<number, EffectDefinition>();
	const effectsByName = new Map<string, EffectDefinition>();

	for (const eff of effectsArray) {
		effectsById.set(eff.id, eff);
		effectsByName.set(eff.name, eff);
	}

	const attributesByName = new Map<string, AttributeDefinition>();

	for (const attr of attributesArray) {
		attributesByName.set(attr.name, attr);
	}

	const blockCollisionShapes = (mcData.blockCollisionShapes ??
		{}) as BlockCollisionShapes;

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
		itemsById,
		itemsByName,
		itemsArray,
		enchantmentsById,
		enchantmentsByName,
		enchantmentsArray,
		foodsById,
		foodsByName,
		foodsArray,
		entitiesById,
		entitiesByName,
		entitiesArray,
		effectsById,
		effectsByName,
		effectsArray,
		attributesByName,
		attributesArray,
		blockCollisionShapes,
		recipes: ((mcData as unknown as Record<string, unknown>).recipes ??
			{}) as Readonly<Record<number, readonly RawRecipe[]>>,
		language: (mcData.language as Record<string, string>) ?? {},
		isNewerOrEqualTo: (v: string) => mcData.isNewerOrEqualTo(v),
		isOlderThan: (v: string) => mcData.isOlderThan(v),
		supportFeature: (f: string) => mcData.supportFeature(f as never),
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

const toItemDefinition = (item: MinecraftData.Item): ItemDefinition => ({
	id: item.id,
	name: item.name,
	displayName: item.displayName,
	stackSize: item.stackSize,
	enchantCategories: item.enchantCategories,
	repairWith: item.repairWith,
	maxDurability: item.maxDurability,
});

const toEnchantmentDefinition = (
	ench: MinecraftData.Enchantment,
): EnchantmentDefinition => ({
	id: ench.id,
	name: ench.name,
	displayName: ench.displayName,
	maxLevel: ench.maxLevel,
	minCost: { a: ench.minCost.a ?? 0, b: ench.minCost.b ?? 0 },
	maxCost: { a: ench.maxCost.a ?? 0, b: ench.maxCost.b ?? 0 },
	treasureOnly: ench.treasureOnly,
	curse: ench.curse,
	exclude: ench.exclude,
	category: ench.category,
	weight: ench.weight,
	tradeable: ench.tradeable,
	discoverable: ench.discoverable,
});

const toFoodDefinition = (food: MinecraftData.Food): FoodDefinition => ({
	id: food.id,
	name: food.name,
	displayName: food.displayName,
	stackSize: food.stackSize,
	foodPoints: food.foodPoints,
	saturation: food.saturation,
	effectiveQuality: food.effectiveQuality,
	saturationRatio: food.saturationRatio,
});

const toEntityDefinition = (
	entity: MinecraftData.Entity,
): EntityDefinition => ({
	id: entity.id,
	name: entity.name,
	displayName: entity.displayName,
	width: entity.width ?? 0,
	height: entity.height ?? 0,
	type: entity.type,
	category: entity.category ?? "UNKNOWN",
});

const toEffectDefinition = (
	effect: MinecraftData.Effect,
): EffectDefinition => ({
	id: effect.id,
	name: effect.name,
	displayName: effect.displayName,
	type: effect.type as "good" | "bad",
});

const toAttributeDefinition = (
	attr: MinecraftData.Attribute,
): AttributeDefinition => ({
	resource: attr.resource,
	name: attr.name,
	min: attr.min,
	max: attr.max,
	default: attr.default,
});
