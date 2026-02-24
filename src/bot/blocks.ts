/**
 * Block and world management — chunk loading/unloading, block state updates.
 */

import { stateIdToBlock } from "../block.js";
import {
	createChunkColumn,
	GLOBAL_BITS_PER_BIOME,
	GLOBAL_BITS_PER_BLOCK,
	loadChunkColumn,
} from "../chunk/index.js";
import { type Vec3, vec3 } from "../vec3/index.js";
import {
	createWorld,
	onWorldEvent,
	setColumn,
	unloadColumn,
	worldGetBlockStateId,
	worldSetBlockStateId,
} from "../world/index.js";
import type { Bot, BotOptions, FindBlockOptions } from "./types.js";

export const initBlocks = (bot: Bot, _options: BotOptions): void => {
	// ── World creation ──

	bot.on("login", () => {
		if (!bot.registry) return;
		bot.world = createWorld(bot.registry);

		// Forward world block update events
		onWorldEvent(bot.world!, "blockUpdate", (pos, oldStateId, newStateId) => {
			bot.emit("blockUpdate", pos, oldStateId, newStateId);
		});
	});

	// Recreate world on respawn if dimension changes
	bot.on("game", () => {
		if (!bot.registry || !bot.world) return;
		// Update world height if changed
	});

	// ── Chunk loading ──

	bot.client.on("map_chunk", (packet: Record<string, unknown>) => {
		if (!bot.registry || !bot.world) return;

		try {
			const x = packet.x as number;
			const z = packet.z as number;

			const column = createChunkColumn({
				minY: bot.game.minY,
				worldHeight: bot.game.height,
				maxBitsPerBlock: GLOBAL_BITS_PER_BLOCK,
				maxBitsPerBiome: GLOBAL_BITS_PER_BIOME,
			});

			loadChunkColumn(column, packet.chunkData as Buffer);

			// Block entities
			const blockEntities = packet.blockEntities as
				| Array<Record<string, unknown>>
				| undefined;
			if (blockEntities) {
				for (const be of blockEntities) {
					const nbtData = be.nbtData ?? be;
					if (nbtData) {
						// Store block entity in column
					}
				}
			}

			setColumn(bot.world!, x, z, column);
			bot.emit("chunkColumnLoad", vec3(x * 16, 0, z * 16));
		} catch (err) {
			bot.emit("error", err as Error);
		}
	});

	// ── Chunk batch acknowledgement (1.20.2+) ──

	bot.client.on("chunk_batch_finished", (_packet: Record<string, unknown>) => {
		bot.client.write("chunk_batch_received", {
			chunksPerTick: 20.0,
		});
	});

	// ── Chunk unloading ──

	bot.client.on("unload_chunk", (packet: Record<string, unknown>) => {
		if (!bot.world) return;
		const x = packet.chunkX as number;
		const z = packet.chunkZ as number;
		unloadColumn(bot.world, x, z);
		bot.emit("chunkColumnUnload", vec3(x * 16, 0, z * 16));
	});

	// ── Single block change ──

	bot.client.on("block_change", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		const loc = packet.location as Record<string, number>;
		if (!loc) return;

		const pos = vec3(loc.x, loc.y, loc.z);
		const stateId = packet.type as number;

		worldSetBlockStateId(bot.world, pos, stateId);
	});

	// ── Multi block change ──

	bot.client.on("multi_block_change", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		if (bot.supportFeature("usesMultiblockSingleLong")) {
			// 1.19.2+ — records are packed longs
			const chunkCoordinates = packet.chunkCoordinates as Record<
				string,
				number
			>;
			const records = packet.records as Array<bigint | number>;
			if (!chunkCoordinates || !records) return;

			const cx = chunkCoordinates.x * 16;
			const cy = chunkCoordinates.y * 16;
			const cz = chunkCoordinates.z * 16;

			for (const record of records) {
				const val = typeof record === "bigint" ? Number(record) : record;
				const stateId = val >>> 12;
				const localX = (val >> 8) & 0xf;
				const localZ = (val >> 4) & 0xf;
				const localY = val & 0xf;

				worldSetBlockStateId(
					bot.world,
					vec3(cx + localX, cy + localY, cz + localZ),
					stateId,
				);
			}
		} else {
			// Legacy — individual records
			const records = packet.records as Array<Record<string, number>>;
			if (!records) return;

			for (const record of records) {
				const pos = vec3(
					(record.horizontalPos >> 4) & 0xf,
					record.y,
					record.horizontalPos & 0xf,
				);
				worldSetBlockStateId(bot.world, pos, record.blockId);
			}
		}
	});

	// ── Explosion — set affected blocks to air ──

	bot.client.on("explosion", (packet: Record<string, unknown>) => {
		if (!bot.world) return;

		const x = packet.x as number;
		const y = packet.y as number;
		const z = packet.z as number;
		const affectedBlockOffsets = packet.affectedBlockOffsets as
			| Array<Record<string, number>>
			| undefined;

		if (affectedBlockOffsets) {
			for (const offset of affectedBlockOffsets) {
				worldSetBlockStateId(
					bot.world,
					vec3(x + offset.x, y + offset.y, z + offset.z),
					0, // air
				);
			}
		}
	});

	// ── Bot methods ──

	bot.blockAt = (point: Vec3, _extraInfos?: boolean) => {
		if (!bot.world || !bot.registry) return null;
		const stateId = worldGetBlockStateId(bot.world, point);
		if (stateId == null || stateId === 0) return null;
		return stateIdToBlock(bot.registry, stateId);
	};

	bot.findBlocks = (options: FindBlockOptions): Vec3[] => {
		if (!bot.world || !bot.registry) return [];

		const { matching, maxDistance = 64, count = 1, point } = options;
		const origin = point ?? bot.entity.position;
		const results: Vec3[] = [];

		const matchFn =
			typeof matching === "function"
				? matching
				: typeof matching === "number"
					? (name: string, _sid: number) => {
							const def = bot.registry!.blocksByName.get(name);
							return def?.id === matching;
						}
					: (name: string, _sid: number) => {
							const def = bot.registry!.blocksByName.get(name);
							return def ? (matching as number[]).includes(def.id) : false;
						};

		// Simple scan around origin
		const r = Math.ceil(maxDistance);
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				for (let dz = -r; dz <= r; dz++) {
					if (dx * dx + dy * dy + dz * dz > maxDistance * maxDistance) continue;

					const pos = vec3(
						Math.floor(origin.x) + dx,
						Math.floor(origin.y) + dy,
						Math.floor(origin.z) + dz,
					);

					const stateId = worldGetBlockStateId(bot.world!, pos);
					if (stateId == null || stateId === 0) continue;

					const block = stateIdToBlock(bot.registry!, stateId);
					if (matchFn(block.name, stateId)) {
						results.push(pos);
						if (results.length >= count) return results;
					}
				}
			}
		}

		return results;
	};

	bot.findBlock = (options: FindBlockOptions) => {
		const results = bot.findBlocks({ ...options, count: 1 });
		return results.length > 0 ? bot.blockAt(results[0]!) : null;
	};

	bot.canSeeBlock = (_block: Vec3) => {
		// Simplified: always true (full raycast requires block collision data)
		return true;
	};

	bot.waitForChunksToLoad = async () => {
		// Wait until the chunk at bot position is loaded
		if (!bot.world) return;
		const pos = bot.entity.position;
		const cx = Math.floor(pos.x / 16);
		const cz = Math.floor(pos.z / 16);

		return new Promise<void>((resolve) => {
			const check = () => {
				try {
					const _stateId = worldGetBlockStateId(
						bot.world!,
						vec3(cx * 16, 0, cz * 16),
					);
					// If we can read the block, chunk is loaded
					resolve();
				} catch {
					// Not loaded yet, wait for next chunk load
					bot.once("chunkColumnLoad", check);
				}
			};
			check();
		});
	};
};
