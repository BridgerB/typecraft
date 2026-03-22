/**
 * Inventory and window management — slot updates, clicking, item transfer.
 * Combines upstream inventory.js and simple_inventory.js.
 */

import type { Entity } from "../entity/index.ts";
import { fromNotch, type Item } from "../item/index.ts";
import type { Vec3 } from "../vec3/index.ts";
import {
	acceptClick,
	createWindow,
	getWindowTypes,
	updateSlot,
	type Window,
} from "../window/index.ts";
import { toNotch } from "../item/index.ts";
import type {
	Bot,
	BotOptions,
	EquipmentDestination,
	TransferOptions,
} from "./types.ts";
import { once } from "./utils.ts";

const WINDOW_TIMEOUT = 5000;

export const initInventory = (bot: Bot, _options: BotOptions): void => {
	let nextActionId = 0;

	// ── Create inventory on login ──

	bot.client.on("login", () => {
		if (!bot.registry) return;
		const windowTypes = getWindowTypes(bot.registry);
		const invInfo = windowTypes["minecraft:inventory"];
		if (invInfo) {
			bot.inventory = createWindow(
				0,
				invInfo.type,
				"Inventory",
				invInfo.slots,
				invInfo.inventory,
				invInfo.craft,
				invInfo.requireConfirmation,
			);
		}
	});

	// ── Window items (bulk slot update) ──

	bot.client.on("window_items", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const windowId = packet.windowId as number;
		const items = packet.items as unknown[];

		const window =
			windowId === 0
				? bot.inventory
				: bot.currentWindow?.id === windowId
					? bot.currentWindow
					: null;
		if (!window) return;

		for (let i = 0; i < items.length; i++) {
			const item = fromNotch(bot.registry, items[i] as never);
			updateSlot(window, i, item);
		}

		// State ID tracking (1.17+)
		if (packet.stateId != null) {
			(window as Record<string, unknown>).stateId = packet.stateId as number;
		}
	});

	// ── Set slot (single slot update) ──

	bot.client.on("set_slot", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const windowId = packet.windowId as number;
		const slot = packet.slot as number;
		const item = fromNotch(bot.registry, packet.item as never);

		const window =
			windowId === -1
				? bot.inventory
				: windowId === 0
					? bot.inventory
					: bot.currentWindow?.id === windowId
						? bot.currentWindow
						: null;

		if (window) {
			updateSlot(window, slot, item);
			// Track stateId for window_click
			if (packet.stateId != null) {
				(window as Record<string, unknown>).stateId =
					packet.stateId as number;
			}
		}

		// Update held item if main hand slot changed
		if (windowId === 0 && slot === bot.quickBarSlot + 36) {
			bot.heldItem = item;
		}
	});

	// ── Set player inventory (1.21.11+) ──

	bot.client.on(
		"set_player_inventory",
		(packet: Record<string, unknown>) => {
			if (!bot.registry) return;
			const slotId = packet.slotId as number;
			const item = fromNotch(bot.registry, packet.contents as never);
			updateSlot(bot.inventory, slotId, item);

			if (slotId === bot.quickBarSlot + 36) {
				bot.heldItem = item;
			}
		},
	);

	// ── Open window ──

	bot.client.on("open_window", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const windowId = packet.windowId as number;
		const windowType = packet.inventoryType as string | number;
		const title = (packet.windowTitle as string) ?? "";

		const windowTypes = getWindowTypes(bot.registry);
		const info =
			typeof windowType === "string" ? windowTypes[windowType] : null;

		if (info) {
			bot.currentWindow = createWindow(
				windowId,
				info.type,
				title,
				info.slots,
				info.inventory,
				info.craft,
				info.requireConfirmation,
			);
		}

		if (bot.currentWindow) {
			bot.emit("windowOpen", bot.currentWindow);
		}
	});

	// ── Close window ──

	bot.client.on("close_window", (_packet: Record<string, unknown>) => {
		if (bot.currentWindow) {
			const w = bot.currentWindow;
			bot.currentWindow = null;
			bot.emit("windowClose", w);
		}
	});

	// ── Held item slot ──

	bot.client.on("held_item_slot", (packet: Record<string, unknown>) => {
		bot.quickBarSlot = packet.slot as number;
		bot.updateHeldItem();
	});

	// ── Click window ──

	bot.clickWindow = async (
		slot: number,
		mouseButton: number,
		mode: number,
	): Promise<void> => {
		const window = bot.currentWindow ?? bot.inventory;
		if (!window || !bot.registry) return;

		const actionId = nextActionId++;

		if (bot.supportFeature("stateIdUsed")) {
			const stateId =
				((window as Record<string, unknown>).stateId as number) ?? 0;

			// Snapshot old slots, simulate the click client-side, then diff
			const oldSlots = window.slots.map((s) =>
				s ? { ...s } : null,
			);
			acceptClick(window, bot.registry, { slot, mouseButton, mode });

			// Compute changed slots
			const changedSlots: { location: number; item: unknown }[] = [];
			for (let i = 0; i < window.slots.length; i++) {
				const oldItem = oldSlots[i];
				const newItem = window.slots[i];
				if (oldItem !== newItem) {
					changedSlots.push({
						location: i,
						item: newItem
							? toNotch(bot.registry, newItem)
							: false,
					});
				}
			}

			bot.client.write("window_click", {
				windowId: window.id,
				slot,
				mouseButton,
				mode,
				stateId,
				changedSlots,
				cursorItem: window.selectedItem
					? toNotch(bot.registry, window.selectedItem)
					: false,
			});

			// Wait for server confirmation (set_slot or window_items resync)
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => {
					bot.client.removeListener("set_slot", onSlot);
					bot.client.removeListener("window_items", onItems);
					resolve();
				}, 1000);
				const onSlot = () => {
					clearTimeout(timeout);
					bot.client.removeListener("window_items", onItems);
					resolve();
				};
				const onItems = () => {
					clearTimeout(timeout);
					bot.client.removeListener("set_slot", onSlot);
					resolve();
				};
				bot.client.once("set_slot", onSlot);
				bot.client.once("window_items", onItems);
			});
		} else {
			bot.client.write("window_click", {
				windowId: window.id,
				slot,
				mouseButton,
				action: actionId,
				mode,
				item: { blockId: -1 },
			});
		}
	};

	// ── Close window (client-side) ──

	bot.closeWindow = (window: Window) => {
		bot.client.write("close_window", { windowId: window.id });
		if (bot.currentWindow === window) {
			bot.currentWindow = null;
		}
		bot.emit("windowClose", window);
	};

	// ── Set quick bar slot ──

	bot.setQuickBarSlot = (slot: number) => {
		bot.quickBarSlot = slot;
		bot.client.write("held_item_slot", { slotId: slot });
		bot.updateHeldItem();
	};

	// ── Update held item ──

	bot.updateHeldItem = () => {
		if (!bot.inventory) return;
		bot.heldItem = bot.inventory.slots[bot.quickBarSlot + 36] ?? null;
	};

	// ── Activate item (use held item) ──

	bot.activateItem = (offhand?: boolean) => {
		bot.usingHeldItem = true;
		if (bot.supportFeature("useItemWithOwnPacket")) {
			bot.client.write("use_item", {
				hand: offhand ? 1 : 0,
				sequence: 0,
			});
		} else {
			bot.client.write("block_place", {
				location: { x: -1, y: -1, z: -1 },
				direction: -1,
				heldItem: { blockId: -1 },
				cursorX: 0,
				cursorY: 0,
				cursorZ: 0,
			});
		}
	};

	// ── Deactivate item ──

	bot.deactivateItem = () => {
		bot.usingHeldItem = false;
		bot.client.write("block_dig", {
			status: 5,
			location: { x: 0, y: 0, z: 0 },
			face: 0,
			sequence: 0,
		});
	};

	// ── Consume (eat/drink) ──

	bot.consume = async (): Promise<void> => {
		bot.activateItem();
		// Wait for entity_status id=9 (eating complete) or timeout
		return new Promise<void>((resolve) => {
			const onStatus = (packet: Record<string, unknown>) => {
				if (
					(packet.entityId as number) === bot.entity.id &&
					(packet.entityStatus as number) === 9
				) {
					bot.client.removeListener("entity_status", onStatus);
					bot.usingHeldItem = false;
					resolve();
				}
			};
			bot.client.on("entity_status", onStatus);
			setTimeout(() => {
				bot.client.removeListener("entity_status", onStatus);
				bot.usingHeldItem = false;
				resolve();
			}, 5000);
		});
	};

	// ── Transfer ──

	bot.transfer = async (opts: TransferOptions): Promise<void> => {
		const { window: win, sourceStart, sourceEnd, destStart, destEnd, itemType, metadata } = opts;
		let remaining = opts.count ?? Number.POSITIVE_INFINITY;
		let firstSourceSlot: number | null = null;

		for (let i = sourceStart; i < sourceEnd && remaining > 0; i++) {
			const item = win.slots[i];
			if (!item || item.type !== itemType) continue;
			if (metadata != null && item.metadata !== metadata) continue;

			if (firstSourceSlot === null) firstSourceSlot = i;

			// Pick up the source item
			if (remaining < item.count) {
				// Need only part of this stack — right-click to pick up half, or pick up all and put back
				await bot.clickWindow(i, 0, 0);
			} else {
				await bot.clickWindow(i, 0, 0);
			}

			// Try to place into destination range
			for (let j = destStart; j < destEnd; j++) {
				const destItem = win.slots[j];
				if (destItem === null) {
					// Empty slot — drop all
					await bot.clickWindow(j, 0, 0);
					break;
				} else if (
					destItem.type === itemType &&
					(metadata == null || destItem.metadata === metadata) &&
					destItem.count < destItem.stackSize
				) {
					// Matching partial stack — fill it
					await bot.clickWindow(j, 0, 0);
					if (!win.selectedItem) break;
				}
			}

			// If still holding items, put them back
			if (win.selectedItem) {
				await bot.putSelectedItemRange(
					sourceStart,
					sourceEnd,
					win,
					firstSourceSlot,
				);
			}

			remaining -= item.count;
		}
	};

	// ── Open block/entity ──

	bot.openBlock = async (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<Window> => {
		bot.activateBlock(block, direction, cursorPos);
		const [window] = await once<[Window]>(bot, "windowOpen", WINDOW_TIMEOUT);
		return window;
	};

	bot.openEntity = async (entity: Entity): Promise<Window> => {
		bot.useOn(entity);
		const [window] = await once<[Window]>(bot, "windowOpen", WINDOW_TIMEOUT);
		return window;
	};

	// ── Equip ──

	bot.equip = async (
		item: Item | number,
		destination: EquipmentDestination | null,
	): Promise<void> => {
		// Simplified: find item in inventory, click to equip slot
		const destSlot = getEquipSlot(destination);
		if (destSlot === -1) return;

		const itemType = typeof item === "number" ? item : item.type;
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			const slotItem = bot.inventory.slots[i];
			if (slotItem && slotItem.type === itemType) {
				await bot.clickWindow(i, 0, 0);
				await bot.clickWindow(destSlot, 0, 0);
				return;
			}
		}
	};

	bot.unequip = async (
		destination: EquipmentDestination | null,
	): Promise<void> => {
		const destSlot = getEquipSlot(destination);
		if (destSlot === -1) return;
		if (bot.inventory.slots[destSlot]) {
			await bot.clickWindow(destSlot, 0, 0);
			// Put away
			for (let i = 9; i < 45; i++) {
				if (!bot.inventory.slots[i]) {
					await bot.clickWindow(i, 0, 0);
					return;
				}
			}
		}
	};

	// ── Toss ──

	bot.tossStack = async (item: Item): Promise<void> => {
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			if (bot.inventory.slots[i] === item) {
				await bot.clickWindow(i, 0, 4); // mode 4 = drop
				return;
			}
		}
	};

	bot.toss = async (
		itemType: number,
		_metadata: number | null,
		count: number | null,
	): Promise<void> => {
		let remaining = count ?? 1;
		for (let i = 0; i < bot.inventory.slots.length && remaining > 0; i++) {
			const item = bot.inventory.slots[i];
			if (item && item.type === itemType) {
				await bot.clickWindow(i, 0, 4);
				remaining--;
			}
		}
	};

	bot.putSelectedItemRange = async (
		start: number,
		end: number,
		window: Window,
		slot: number,
	): Promise<void> => {
		// While we're holding an item (selectedItem), try to put it away
		while (window.selectedItem) {
			// First, try to find a matching partial stack to fill
			let destSlot: number | null = null;
			for (let i = start; i < end; i++) {
				const item = window.slots[i];
				if (
					item &&
					item.type === window.selectedItem.type &&
					item.metadata === window.selectedItem.metadata &&
					item.count < item.stackSize
				) {
					destSlot = i;
					break;
				}
			}

			// If no partial stack, find an empty slot
			if (destSlot === null) {
				for (let i = start; i < end; i++) {
					if (!window.slots[i]) {
						destSlot = i;
						break;
					}
				}
			}

			// If no space at all, toss
			if (destSlot === null) {
				if (slot != null) {
					await bot.clickWindow(slot, 0, 0);
				}
				await bot.clickWindow(-999, 0, 0);
				break;
			}

			await bot.clickWindow(destSlot, 0, 0);
		}
	};

	bot.putAway = async (slot: number): Promise<void> => {
		const window = bot.currentWindow ?? bot.inventory;
		if (!window) return;
		await bot.clickWindow(slot, 0, 0); // Pick up the item
		await bot.putSelectedItemRange(
			window.inventoryStart,
			window.inventoryEnd,
			window,
			slot,
		);
	};

	bot.moveSlotItem = async (
		sourceSlot: number,
		destSlot: number,
	): Promise<void> => {
		await bot.clickWindow(sourceSlot, 0, 0); // Pick up from source
		await bot.clickWindow(destSlot, 0, 0); // Place at dest
		// If we still have an item (swap occurred), put it back
		const window = bot.currentWindow ?? bot.inventory;
		if (window?.selectedItem) {
			await bot.clickWindow(sourceSlot, 0, 0);
		}
	};
};

const getEquipSlot = (dest: EquipmentDestination | null): number => {
	switch (dest) {
		case "hand":
			return 36;
		case "off-hand":
			return 45;
		case "head":
			return 5;
		case "torso":
			return 6;
		case "legs":
			return 7;
		case "feet":
			return 8;
		default:
			return -1;
	}
};
