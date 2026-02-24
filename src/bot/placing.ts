/**
 * Block placement and activation.
 * Combines upstream place_block.js, generic_place.js, place_entity.js.
 */

import type { Entity } from "../entity/index.ts";
import { type Vec3, vec3 } from "../vec3/index.ts";
import type { Bot, BotOptions } from "./types.ts";
import { once } from "./utils.ts";

export const initPlacing = (bot: Bot, _options: BotOptions): void => {
	bot.activateBlock = async (
		block: Vec3,
		direction?: Vec3,
		cursorPos?: Vec3,
	): Promise<void> => {
		const dir = direction ?? vec3(0, 1, 0);
		const cursor = cursorPos ?? vec3(0.5, 0.5, 0.5);

		// Convert face vector to direction int
		const face = vecToFace(dir);

		bot.swingArm();

		if (bot.supportFeature("blockPlaceHasHandAndFloatCursor")) {
			bot.client.write("block_place", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				hand: 0,
				cursorX: cursor.x,
				cursorY: cursor.y,
				cursorZ: cursor.z,
				insideBlock: false,
				sequence: 0,
			});
		} else if (bot.supportFeature("blockPlaceHasHandAndIntCursor")) {
			bot.client.write("block_place", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				hand: 0,
				cursorX: Math.floor(cursor.x * 16),
				cursorY: Math.floor(cursor.y * 16),
				cursorZ: Math.floor(cursor.z * 16),
			});
		} else {
			bot.client.write("block_place", {
				location: { x: block.x, y: block.y, z: block.z },
				direction: face,
				heldItem: { blockId: -1 },
				cursorX: Math.floor(cursor.x * 16),
				cursorY: Math.floor(cursor.y * 16),
				cursorZ: Math.floor(cursor.z * 16),
			});
		}
	};

	bot.placeBlock = async (
		referenceBlock: unknown,
		faceVector: Vec3,
	): Promise<void> => {
		const block = referenceBlock as { position: Vec3 };
		if (!block.position) return;

		await bot.lookAt(
			vec3(
				block.position.x + 0.5 + faceVector.x * 0.5,
				block.position.y + 0.5 + faceVector.y * 0.5,
				block.position.z + 0.5 + faceVector.z * 0.5,
			),
			true,
		);

		await bot.activateBlock(block.position, faceVector);
	};

	bot.placeEntity = async (
		referenceBlock: unknown,
		faceVector: Vec3,
	): Promise<Entity> => {
		const block = referenceBlock as { position: Vec3 };
		if (!block.position) throw new Error("Invalid block for entity placement");

		await bot.activateBlock(block.position, faceVector);

		// Wait for entity spawn
		const [entity] = await once<[Entity]>(bot, "entitySpawn", 5000);
		return entity;
	};
};

const vecToFace = (dir: Vec3): number => {
	if (dir.y === -1) return 0; // bottom
	if (dir.y === 1) return 1; // top
	if (dir.z === -1) return 2; // north
	if (dir.z === 1) return 3; // south
	if (dir.x === -1) return 4; // west
	if (dir.x === 1) return 5; // east
	return 1; // default top
};
