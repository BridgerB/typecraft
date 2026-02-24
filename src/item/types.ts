import type { NbtCompound } from "../nbt/types.ts";

/** A Minecraft item stack. */
export type Item = {
	readonly type: number;
	readonly count: number;
	readonly metadata: number;
	readonly nbt: NbtCompound | null;
	readonly name: string;
	readonly displayName: string;
	readonly stackSize: number;
	readonly maxDurability: number | null;
};

/** An enchantment applied to an item. */
export type Enchant = {
	readonly name: string;
	readonly level: number;
};

/** Pre-1.13 network item format (uses blockId). */
export type NotchItemBlockId = {
	readonly blockId: number;
	readonly itemCount: number;
	readonly itemDamage: number;
	readonly nbtData?: NbtCompound;
};

/** 1.13+ network item format (uses present flag). */
export type NotchItemPresent = {
	readonly present: boolean;
	readonly itemId?: number;
	readonly itemCount?: number;
	readonly nbtData?: NbtCompound;
};

/** Network item format — discriminated by era. */
export type NotchItem = NotchItemBlockId | NotchItemPresent;
