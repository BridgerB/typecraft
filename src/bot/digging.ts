/**
 * Block mining — dig, stopDigging, canDigBlock, digTime.
 */

import { length, subtract, type Vec3, vec3 } from "../vec3/index.js";
import type { Bot, BotOptions, Task } from "./types.js";
import { createTask, sleep } from "./utils.js";

export const initDigging = (bot: Bot, _options: BotOptions): void => {
	let digging = false;
	let digTask: Task<void> | null = null;
	let swingInterval: ReturnType<typeof setInterval> | null = null;

	bot.dig = async (
		block: unknown,
		forceLook?: boolean | "ignore",
		_digFace?: unknown,
	): Promise<void> => {
		if (!block || !bot.registry) return;

		const blockObj = block as { position: Vec3; name: string; stateId: number };
		const pos = blockObj.position;
		if (!pos) return;

		// Face direction (default: top)
		const face = 1;

		// Look at block unless ignored
		if (forceLook !== "ignore") {
			await bot.lookAt(
				vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5),
				forceLook === true,
			);
		}

		// Start digging
		digging = true;
		bot.targetDigBlock = block as never;

		bot.client.write("block_dig", {
			status: 0,
			location: { x: pos.x, y: pos.y, z: pos.z },
			face,
			sequence: 0,
		});

		// Swing arm periodically
		swingInterval = setInterval(() => bot.swingArm(), 350);

		// Calculate dig time
		const time = bot.digTime(block);
		if (time === 0) {
			// Instant break
			finishDig(pos, face);
			return;
		}

		digTask = createTask<void>();

		// Wait for dig time, then finish
		await sleep(time);

		if (digging) {
			finishDig(pos, face);
		}

		if (digTask) {
			digTask.finish(undefined as never);
		}
	};

	const finishDig = (pos: Vec3, face: number) => {
		digging = false;
		if (swingInterval) {
			clearInterval(swingInterval);
			swingInterval = null;
		}

		bot.client.write("block_dig", {
			status: 2,
			location: { x: pos.x, y: pos.y, z: pos.z },
			face,
			sequence: 0,
		});

		const block = bot.targetDigBlock;
		bot.targetDigBlock = null;
		bot.lastDigTime = Date.now();

		if (block) {
			bot.emit("diggingCompleted", block);
		}
	};

	bot.stopDigging = () => {
		if (!digging) return;
		digging = false;

		if (swingInterval) {
			clearInterval(swingInterval);
			swingInterval = null;
		}

		const block = bot.targetDigBlock;
		bot.targetDigBlock = null;

		bot.client.write("block_dig", {
			status: 1,
			location: { x: 0, y: 0, z: 0 },
			face: 0,
			sequence: 0,
		});

		if (digTask) {
			digTask.cancel(new Error("Digging aborted"));
			digTask = null;
		}

		if (block) {
			bot.emit("diggingAborted", block);
		}
	};

	bot.canDigBlock = (block: unknown): boolean => {
		if (!block) return false;
		const blockObj = block as { position: Vec3; diggable?: boolean };
		if (blockObj.diggable === false) return false;
		if (!blockObj.position) return false;

		const dist = length(subtract(blockObj.position, bot.entity.position));
		return dist <= 6;
	};

	bot.digTime = (block: unknown): number => {
		// Simplified: return 0 for creative, estimated time otherwise
		if (bot.game.gameMode === "creative") return 0;

		const blockObj = block as { hardness?: number };
		if (!blockObj.hardness || blockObj.hardness < 0) return 0;

		// Basic dig time estimate (hardness * 1500ms base, without tool optimization)
		return Math.ceil(blockObj.hardness * 1500);
	};

	// Stop digging on death
	bot.on("death", () => {
		if (digging) bot.stopDigging();
	});
};
