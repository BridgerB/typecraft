/**
 * Specialized container interactions — chest, furnace, anvil, enchantment table,
 * villager, creative mode, command blocks.
 */

import type { Entity } from "../entity/index.ts";
import type { Item } from "../item/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import type { Window } from "../window/index.ts";
import type { Bot, BotOptions } from "./types.ts";

/** Writable version of Vec3 for entity position mutation. */
type MutableVec3 = { x: number; y: number; z: number };

export const initContainers = (bot: Bot, _options: BotOptions): void => {
	bot.openChest = async (
		chestBlock: unknown,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<Window> => {
		const block = chestBlock as { position: Vec3 };
		return bot.openBlock(block.position, direction, cursorPos);
	};

	bot.openFurnace = async (furnaceBlock: unknown): Promise<Window> => {
		const block = furnaceBlock as { position: Vec3 };
		return bot.openBlock(block.position);
	};

	bot.openAnvil = async (anvilBlock: unknown): Promise<Window> => {
		const block = anvilBlock as { position: Vec3 };
		return bot.openBlock(block.position);
	};

	bot.openEnchantmentTable = async (tableBlock: unknown): Promise<Window> => {
		const block = tableBlock as { position: Vec3 };
		return bot.openBlock(block.position);
	};

	bot.openVillager = async (villagerEntity: Entity): Promise<Window> =>
		bot.openEntity(villagerEntity);

	// ── Creative mode ──

	bot.creative = {
		setInventorySlot: async (
			slot: number,
			item: Item | null,
		): Promise<void> => {
			bot.client.write("set_creative_slot", {
				slot,
				item: item
					? {
							present: true,
							itemId: item.type,
							itemCount: item.count,
							nbtData: item.nbt ?? undefined,
						}
					: { present: false },
			});
		},

		clearSlot: async (slot: number): Promise<void> => {
			await bot.creative.setInventorySlot(slot, null);
		},

		clearInventory: async (): Promise<void> => {
			for (let i = 0; i < 46; i++) {
				await bot.creative.setInventorySlot(i, null);
			}
		},

		flyTo: async (destination: Vec3): Promise<void> => {
			bot.creative.startFlying();
			const pos = bot.entity.position as MutableVec3;
			pos.x = destination.x;
			pos.y = destination.y;
			pos.z = destination.z;
		},

		startFlying: () => {
			bot.client.write("abilities", {
				flags: 0x06, // flying + allow flying
				flyingSpeed: 0.05,
				walkingSpeed: 0.1,
			});
		},

		stopFlying: () => {
			bot.client.write("abilities", {
				flags: 0x04, // allow flying but not flying
				flyingSpeed: 0.05,
				walkingSpeed: 0.1,
			});
		},
	};
};
