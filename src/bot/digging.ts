/**
 * Block mining — dig, stopDigging, canDigBlock, digTime.
 */

import { getEnchants } from "../item/index.ts";
import { length, subtract, type Vec3, vec3 } from "../vec3/index.ts";
import {
	PLAYER_EYE_HEIGHT,
	raycast,
} from "../world/index.ts";
import type { Bot, BotOptions, Task } from "./types.ts";
import { createTask } from "./utils.ts";

export const initDigging = (bot: Bot, _options: BotOptions): void => {
	let digging = false;
	let digTask: Task<void> | null = null;
	let swingInterval: ReturnType<typeof setInterval> | null = null;

	bot.dig = async (
		block: unknown,
		forceLook?: boolean | "ignore",
		digFace?: unknown,
	): Promise<void> => {
		if (!block || !bot.registry) return;

		const blockObj = block as { position: Vec3; name: string; stateId: number };
		const pos = blockObj.position;
		if (!pos) return;

		const time = bot.digTime(block);
		if (time === Infinity)
			throw new Error(`dig time for ${blockObj.name} is Infinity`);

		// Determine face
		let face = 1; // default top

		if (forceLook !== "ignore") {
			const faceVec = digFace as Vec3 | "raycast" | "auto" | undefined;

			if (faceVec && typeof faceVec === "object" && "x" in faceVec) {
				// Explicit Vec3 face direction
				const v = faceVec as Vec3;
				if (v.x) face = v.x > 0 ? 5 : 4; // EAST : WEST
				else if (v.y) face = v.y > 0 ? 1 : 0; // TOP : BOTTOM
				else if (v.z) face = v.z > 0 ? 3 : 2; // SOUTH : NORTH

				await bot.lookAt(
					vec3(
						pos.x + 0.5 + v.x * 0.5,
						pos.y + 0.5 + v.y * 0.5,
						pos.z + 0.5 + v.z * 0.5,
					),
					forceLook === true,
				);
			} else if (faceVec === "raycast" && bot.world) {
				// Raycast face detection
				const eyePos = vec3(
					bot.entity.position.x,
					bot.entity.position.y + PLAYER_EYE_HEIGHT,
					bot.entity.position.z,
				);
				const dx = bot.entity.position.x - (pos.x + 0.5);
				const dy =
					bot.entity.position.y + PLAYER_EYE_HEIGHT - (pos.y + 0.5);
				const dz = bot.entity.position.z - (pos.z + 0.5);

				// Check visible faces based on player position relative to block
				const visibleFaces = {
					y: Math.sign(Math.abs(dy) > 0.5 ? dy : 0),
					x: Math.sign(Math.abs(dx) > 0.5 ? dx : 0),
					z: Math.sign(Math.abs(dz) > 0.5 ? dz : 0),
				};

				let bestFace: { face: number; target: Vec3 } | null = null;
				let bestDist = Infinity;

				for (const axis of ["y", "x", "z"] as const) {
					const sign = visibleFaces[axis];
					if (!sign) continue;

					const targetPos = vec3(
						pos.x + 0.5 + (axis === "x" ? sign * 0.5 : 0),
						pos.y + 0.5 + (axis === "y" ? sign * 0.5 : 0),
						pos.z + 0.5 + (axis === "z" ? sign * 0.5 : 0),
					);

					const rayDir = vec3(
						targetPos.x - eyePos.x,
						targetPos.y - eyePos.y,
						targetPos.z - eyePos.z,
					);
					const rayLen = Math.sqrt(
						rayDir.x * rayDir.x +
							rayDir.y * rayDir.y +
							rayDir.z * rayDir.z,
					);
					if (rayLen === 0) continue;

					const normDir = vec3(
						rayDir.x / rayLen,
						rayDir.y / rayLen,
						rayDir.z / rayLen,
					);
					const hit = raycast(bot.world, eyePos, normDir, 5);

					if (
						hit &&
						hit.position.x === pos.x &&
						hit.position.y === pos.y &&
						hit.position.z === pos.z
					) {
						const dist = rayLen;
						if (dist < bestDist) {
							bestDist = dist;
							bestFace = { face: hit.face, target: hit.intersect };
						}
					}
				}

				if (bestFace) {
					face = bestFace.face;
					await bot.lookAt(bestFace.target, forceLook === true);
				} else {
					// Fallback: look at block center
					await bot.lookAt(
						vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5),
						forceLook === true,
					);
				}
			} else {
				// Default: look at block center
				await bot.lookAt(
					vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5),
					forceLook === true,
				);
			}
		}

		// Cancel current dig if any
		if (digging) bot.stopDigging();

		digging = true;
		bot.targetDigBlock = block as never;

		bot.client.write("block_dig", {
			status: 0,
			location: { x: pos.x, y: pos.y, z: pos.z },
			face,
			sequence: 0,
		});

		bot.swingArm();
		swingInterval = setInterval(() => bot.swingArm(), 350);

		if (time === 0) {
			finishDig(pos, face);
			return;
		}

		digTask = createTask<void>();

		// Set up both timeout and blockUpdate event-driven completion
		const digTimeout = setTimeout(() => {
			if (digging) finishDig(pos, face);
		}, time);

		const onBlockUpdate = (_oldBlock: unknown, newBlock: unknown) => {
			const nb = newBlock as { position?: Vec3; type?: number } | null;
			if (!nb?.position) return;
			if (
				nb.position.x === pos.x &&
				nb.position.y === pos.y &&
				nb.position.z === pos.z
			) {
				if (nb.type === 0) {
					// Block became air — digging completed by server
					clearTimeout(digTimeout);
					bot.removeListener("blockUpdate", onBlockUpdate);
					digging = false;
					if (swingInterval) {
						clearInterval(swingInterval);
						swingInterval = null;
					}
					bot.targetDigBlock = null;
					bot.lastDigTime = Date.now();
					bot.emit("diggingCompleted", newBlock);
					if (digTask) {
						digTask.finish(undefined as never);
						digTask = null;
					}
				}
			}
		};

		bot.on("blockUpdate", onBlockUpdate);

		try {
			await digTask.promise;
		} finally {
			clearTimeout(digTimeout);
			bot.removeListener("blockUpdate", onBlockUpdate);
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

		// Resolve the dig promise
		if (digTask) {
			digTask.finish(undefined as never);
			digTask = null;
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
		const blockObj = block as { position: Vec3; diggable?: boolean; name?: string };
		if (blockObj.diggable === false) return false;
		if (!blockObj.position) return false;

		// Check registry for diggable status
		if (blockObj.name && bot.registry) {
			const def = bot.registry.blocksByName.get(blockObj.name);
			if (def && def.diggable === false) return false;
		}

		const dist = length(subtract(blockObj.position, bot.entity.position));
		return dist <= 6;
	};

	bot.digTime = (block: unknown): number => {
		if (bot.game.gameMode === "creative") return 0;

		const blockObj = block as { hardness?: number; name?: string; stateId?: number };
		const registry = bot.registry;

		// Get hardness from block object, or look up from registry
		let hardness: number | undefined = blockObj.hardness;
		const blockDef = blockObj.name && registry ? registry.blocksByName.get(blockObj.name) : null;
		if (hardness == null && blockDef?.hardness != null) {
			hardness = blockDef.hardness;
		}
		if (hardness == null || hardness < 0) return Infinity;
		if (hardness === 0) return 0;

		if (!registry) return Math.ceil(hardness * 1500);

		let speed = 1.0;
		let canHarvest = !blockDef?.harvestTools; // If no harvestTools, any tool can harvest

		// Check held tool against block's material speeds
		const heldItem = bot.heldItem;
		if (heldItem && blockDef?.material) {
			const materialSpeeds = registry.materials[blockDef.material];
			if (materialSpeeds) {
				const toolSpeed = materialSpeeds[heldItem.type];
				if (toolSpeed) {
					speed = toolSpeed;
				}
			}
			// Check if held tool can harvest this block
			if (blockDef.harvestTools && blockDef.harvestTools[heldItem.type]) {
				canHarvest = true;
			}
		}

		// Efficiency enchantment
		if (heldItem && registry) {
			const enchants = getEnchants(registry, heldItem);
			const efficiency = enchants.find(e => e.name === "efficiency");
			if (efficiency) {
				speed += efficiency.level * efficiency.level + 1;
			}
		}

		// Haste effect (id 2)
		const haste = bot.entity.effects.get(2);
		if (haste) {
			speed *= 1 + (haste.amplifier + 1) * 0.2;
		}

		// Mining Fatigue effect (id 3)
		const fatigue = bot.entity.effects.get(3);
		if (fatigue) {
			speed *= Math.pow(0.3, fatigue.amplifier + 1);
		}

		// Underwater penalty (unless Aqua Affinity helmet)
		if (bot.entity.isInWater) {
			let hasAquaAffinity = false;
			// Helmet is slot 5 in inventory
			const helmet = bot.inventory?.slots[5];
			if (helmet && registry) {
				const enchants = getEnchants(registry, helmet);
				hasAquaAffinity = enchants.some(e => e.name === "aqua_affinity");
			}
			if (!hasAquaAffinity) {
				speed *= 0.2;
			}
		}

		// Not on ground penalty
		if (!bot.entity.onGround) {
			speed *= 0.2;
		}

		// Calculate damage per tick
		const damage = speed / hardness / (canHarvest ? 30 : 100);

		// Instant break check
		if (damage >= 1) return 0;

		// Calculate ticks and convert to ms
		const ticks = Math.ceil(1 / damage);
		return ticks * 50;
	};

	// Stop digging on death
	bot.on("death", () => {
		if (digging) bot.stopDigging();
	});
};
