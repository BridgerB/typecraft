/**
 * Crafting recipes — lookup and craft execution.
 * Uses src/recipe/ for recipe data.
 */

import { findRecipes, type Recipe } from "../recipe/index.ts";
import { findInventoryItem, type Window } from "../window/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import type { Bot, BotOptions } from "./types.ts";
import { once } from "./utils.ts";

export const initCrafting = (bot: Bot, _options: BotOptions): void => {
	bot.recipesFor = (
		itemType: number,
		metadata: number | null,
		minResultCount: number | null,
		craftingTable: boolean | null,
	): Recipe[] => {
		if (!bot.registry) return [];

		const recipes = findRecipes(bot.registry, itemType, metadata ?? undefined);

		return recipes.filter((recipe) => {
			// Filter by minimum result count
			if (minResultCount != null && recipe.result.count < minResultCount) {
				return false;
			}
			// Filter by crafting table requirement
			if (!craftingTable && recipe.requiresTable) return false;
			return true;
		});
	};

	bot.recipesAll = (
		itemType: number,
		metadata: number | null,
		craftingTable: boolean | null,
	): Recipe[] => bot.recipesFor(itemType, metadata, null, craftingTable);

	bot.craft = async (
		recipe: Recipe,
		count?: number,
		craftingTable?: unknown,
	): Promise<void> => {
		if (recipe.requiresTable && !craftingTable) {
			throw new Error("Recipe requires crafting table");
		}

		const times = count ?? 1;
		let windowCraftingTable: Window | null = null;

		try {
			console.log(`[craft-debug] Starting craft loop, times=${times} requiresTable=${recipe.requiresTable} hasCraftingTable=${!!craftingTable} inShape=${!!recipe.inShape} ingredients=${!!recipe.ingredients}`);
			if (recipe.inShape) {
				for (let y = 0; y < recipe.inShape.length; y++) {
					console.log(`[craft-debug] row ${y}: ${recipe.inShape[y].map(i => i.id).join(",")}`);
				}
			}
			for (let i = 0; i < times; i++) {
				let window: Window;
				let w: number;
				let h: number;

				if (craftingTable) {
					if (!windowCraftingTable) {
						// Reuse already-open crafting window if available
						if (bot.currentWindow && String(bot.currentWindow.type).startsWith("minecraft:crafting")) {
							windowCraftingTable = bot.currentWindow;
						} else {
							const block = craftingTable as { position: Vec3 };
							await bot.activateBlock(block.position);
							const [win] = await once<[Window]>(bot, "windowOpen", 5000);
							windowCraftingTable = win;
							// Wait for window_items to sync player inventory into the crafting window
							await new Promise((r) => setTimeout(r, 500));
						}
					}
					if (
						!windowCraftingTable.type.toString().startsWith("minecraft:crafting")
					) {
						throw new Error(
							"Non-crafting table block used: " + windowCraftingTable.type,
						);
					}
					window = windowCraftingTable;
					w = 3;
					h = 3;
				} else {
					window = bot.inventory;
					w = 2;
					h = 2;
				}

				// Convert grid x,y to slot index (slot 0 is result, 1+ is grid)
				const slot = (x: number, y: number) => 1 + x + w * y;

				// Compute unused recipe slots (for shapeless ingredient placement)
				const unusedSlots: number[] = [];
				if (recipe.inShape) {
					for (let y = 0; y < recipe.inShape.length; y++) {
						const row = recipe.inShape[y];
						for (let x = 0; x < row.length; x++) {
							if (row[x].id === -1) unusedSlots.push(slot(x, y));
						}
						for (let x = row.length; x < w; x++) {
							unusedSlots.push(slot(x, y));
						}
					}
					for (let y = recipe.inShape.length; y < h; y++) {
						for (let x = 0; x < w; x++) {
							unusedSlots.push(slot(x, y));
						}
					}
				} else {
					for (let y = 0; y < h; y++) {
						for (let x = 0; x < w; x++) {
							unusedSlots.push(slot(x, y));
						}
					}
				}

				let originalSourceSlot: number | null = null;

				// Place shaped ingredients
				console.log(`[craft-debug] Placing ingredients, window=${window.type} invStart=${window.inventoryStart} slots=${window.slots.length}`);
				const invItems = window.slots.map((s, i) => s && s.count > 0 ? `${i}:${s.name}(${s.type})` : null).filter(Boolean);
				console.log(`[craft-debug] Window contents: ${invItems.join(", ") || "empty"}`);
				// Full slot dump with counts
				for (let si = window.inventoryStart; si < window.inventoryEnd; si++) {
					const s = window.slots[si];
					if (s) console.log(`[craft-debug]   slot ${si}: ${s.name} type=${s.type} count=${s.count} meta=${s.metadata}`);
				}
				if (recipe.inShape) {
					for (let y = 0; y < recipe.inShape.length; y++) {
						const row = recipe.inShape[y];
						for (let x = 0; x < row.length; x++) {
							const ingredient = row[x];
							if (ingredient.id === -1) continue;
							console.log(`[craft-debug] ingredient id=${ingredient.id} at grid (${x},${y}) stateId=${(window as any).stateId}`);

							if (
								!window.selectedItem ||
								window.selectedItem.type !== ingredient.id ||
								(ingredient.metadata != null &&
									window.selectedItem.metadata !== ingredient.metadata)
							) {
								const sourceSlot = findInventoryItem(
									window,
									ingredient.id,
									ingredient.metadata,
								);
								if (sourceSlot === null)
									throw new Error("Missing ingredient");
								if (originalSourceSlot === null)
									originalSourceSlot = sourceSlot;
								await bot.clickWindow(sourceSlot, 0, 0);
							}

							await bot.clickWindow(slot(x, y), 1, 0);
						}
					}
				}

				// Place shapeless ingredients (into unused slots)
				if (recipe.ingredients) {
					for (const ingredient of recipe.ingredients) {
						const destSlot = unusedSlots.pop();
						if (destSlot === undefined)
							throw new Error("No free craft slots");

						if (
							!window.selectedItem ||
							window.selectedItem.type !== ingredient.id ||
							(ingredient.metadata != null &&
								window.selectedItem.metadata !== ingredient.metadata)
						) {
							const sourceSlot = findInventoryItem(
								window,
								ingredient.id,
								ingredient.metadata,
							);
							if (sourceSlot === null) {
								const allItems = window.slots.filter(s => s).map((s, i) => `${s!.name}(${s!.type})@${i}`);
								throw new Error(`Missing ingredient id=${ingredient.id} meta=${ingredient.metadata} inv=[${allItems}]`);
							}
							console.log(`[craft-debug] Found ingredient ${ingredient.id} at slot ${sourceSlot}, item=${window.slots[sourceSlot]?.name}(${window.slots[sourceSlot]?.type})`)
							if (originalSourceSlot === null)
								originalSourceSlot = sourceSlot;
							await bot.clickWindow(sourceSlot, 0, 0);
						}

						await bot.clickWindow(destSlot, 1, 0);
					}
				}

				// Put back any remaining held items
				await bot.putSelectedItemRange(
					window.inventoryStart,
					window.inventoryEnd,
					window,
					originalSourceSlot ?? 0,
				);

				// Take the result from slot 0
				await bot.putAway(0);

				// Handle outShape leftovers (e.g. buckets from cake recipe)
				if (recipe.outShape) {
					for (let y = 0; y < recipe.outShape.length; y++) {
						const row = recipe.outShape[y];
						for (let x = 0; x < row.length; x++) {
							if (row[x].id !== -1) {
								await bot.putAway(slot(x, y));
							}
						}
					}
				}
			}
		} finally {
			if (windowCraftingTable) {
				bot.closeWindow(windowCraftingTable);
			}
		}
	};
};
