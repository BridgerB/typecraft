/**
 * Crafting recipes — lookup and craft execution.
 * Uses src/recipe/ for recipe data.
 */

import { findRecipes, type Recipe } from "../recipe/index.ts";
import type { Bot, BotOptions } from "./types.ts";

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
		_recipe: Recipe,
		count?: number,
		_craftingTable?: unknown,
	): Promise<void> => {
		// Simplified crafting: sends clicks for recipe ingredients
		// Full implementation requires window interaction with crafting grid
		const times = count ?? 1;
		for (let i = 0; i < times; i++) {
			// Place ingredients and take result via window clicks
			// This is a simplified stub — full implementation would:
			// 1. Open crafting table if needed
			// 2. Place ingredients in correct slots
			// 3. Click result slot
			// 4. Repeat for count
		}
	};
};
