/** Block definition from the Minecraft data registry. */
export type BlockDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly hardness: number | null;
	readonly resistance: number | null;
	readonly stackSize: number;
	readonly diggable: boolean;
	readonly boundingBox: "block" | "empty";
	readonly material?: string;
	readonly transparent: boolean;
	readonly emitLight: number;
	readonly filterLight: number;
	readonly defaultState: number;
	readonly minStateId: number;
	readonly maxStateId: number;
	readonly states: readonly BlockStateProperty[];
	readonly drops: readonly unknown[];
};

/** A block state property (e.g. facing, powered, waterlogged). */
export type BlockStateProperty = {
	readonly name: string;
	readonly type: "enum" | "bool" | "int" | "direction";
	readonly num_values: number;
	readonly values?: readonly string[];
};

/** Biome definition from the Minecraft data registry. */
export type BiomeDefinition = {
	readonly id: number;
	readonly name: string;
	readonly displayName: string;
	readonly category: string;
	readonly temperature: number;
	readonly dimension: string;
	readonly color: number;
	readonly precipitation?: "none" | "rain" | "snow";
	readonly has_precipitation?: boolean;
	readonly rainfall?: number;
};

/** Version info with comparison operators. */
export type VersionInfo = {
	readonly type: "pc" | "bedrock";
	readonly majorVersion: string;
	readonly minecraftVersion: string;
	readonly version: number;
	readonly dataVersion?: number;
};

/** The loaded Minecraft data registry for a specific version. */
export type Registry = {
	readonly version: VersionInfo;
	readonly blocksById: ReadonlyMap<number, BlockDefinition>;
	readonly blocksByName: ReadonlyMap<string, BlockDefinition>;
	readonly blocksByStateId: ReadonlyMap<number, BlockDefinition>;
	readonly blocksArray: readonly BlockDefinition[];
	readonly biomesById: ReadonlyMap<number, BiomeDefinition>;
	readonly biomesByName: ReadonlyMap<string, BiomeDefinition>;
	readonly biomesArray: readonly BiomeDefinition[];
	readonly isNewerOrEqualTo: (version: string) => boolean;
	readonly isOlderThan: (version: string) => boolean;
	readonly supportFeature: (feature: string) => boolean;
};
