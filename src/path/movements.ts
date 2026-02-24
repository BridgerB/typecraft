/**
 * Movement generation for A* pathfinding.
 * Queries blocks via PhysicsWorld adapter, classifies them with a per-path
 * cache, and generates valid neighboring moves (walk, jump, drop, diagonal).
 */

import type { Bot } from "../bot/types.ts";
import { createPhysicsWorld } from "../physics/adapter.ts";
import type { PhysicsWorld } from "../physics/types.ts";
import type { Registry } from "../registry/types.ts";
import type { BlockQuery, Move, Movements } from "./types.ts";
import { posHash } from "./types.ts";

// Cardinal directions (NESW)
const CARDINAL = [
	{ x: -1, z: 0 },
	{ x: 1, z: 0 },
	{ x: 0, z: -1 },
	{ x: 0, z: 1 },
] as const;

// Diagonal directions
const DIAGONAL = [
	{ x: -1, z: -1 },
	{ x: -1, z: 1 },
	{ x: 1, z: -1 },
	{ x: 1, z: 1 },
] as const;

/** Void/unloaded block query — treated as impassable. */
const VOID_BLOCK: BlockQuery = {
	safe: false,
	physical: false,
	liquid: false,
	climbable: false,
	height: 0,
	name: "void",
};

/** Create a movement generator bound to the bot's current world state. */
export const createMovements = (
	bot: Bot,
	maxDropDown = 3,
): Movements => {
	const registry = bot.registry!;
	const physicsWorld = createPhysicsWorld(bot.world!);

	// Pre-compute block classification sets
	const liquidIds = new Set<number>();
	const climbableIds = new Set<number>();
	const avoidIds = new Set<number>();
	const fenceIds = new Set<number>();

	const addId = (name: string, set: Set<number>) => {
		const def = registry.blocksByName.get(name);
		if (def) set.add(def.id);
	};

	addId("water", liquidIds);
	addId("flowing_water", liquidIds);
	addId("lava", liquidIds);
	addId("flowing_lava", liquidIds);
	addId("lava", avoidIds);
	addId("flowing_lava", avoidIds);
	addId("fire", avoidIds);
	addId("soul_fire", avoidIds);
	addId("cobweb", avoidIds);
	addId("web", avoidIds);
	addId("sweet_berry_bush", avoidIds);
	addId("wither_rose", avoidIds);
	addId("ladder", climbableIds);
	addId("vine", climbableIds);

	// Classify blocks with shapes taller than 1 as fences
	const collisionShapes = registry.blockCollisionShapes;
	for (const block of registry.blocksArray) {
		const shapeRef = collisionShapes.blocks[block.name];
		if (shapeRef === undefined) continue;
		const shapeId =
			typeof shapeRef === "number" ? shapeRef : (shapeRef[0] ?? 0);
		const shapes = collisionShapes.shapes[String(shapeId)] ?? [];
		for (const shape of shapes) {
			if ((shape[4] ?? 0) > 1.0) {
				fenceIds.add(block.id);
				break;
			}
		}
	}

	// Block query cache — avoids repeated world lookups for shared neighbors
	const blockCache = new Map<number, BlockQuery>();

	/** Query block properties at an absolute position (cached). */
	const queryBlock = (x: number, y: number, z: number): BlockQuery => {
		const key = posHash(x, y, z);
		const cached = blockCache.get(key);
		if (cached) return cached;

		const block = physicsWorld.getBlock({ x, y, z });
		if (!block) {
			blockCache.set(key, VOID_BLOCK);
			return VOID_BLOCK;
		}

		const isLiquid = liquidIds.has(block.id);
		const isClimbable = climbableIds.has(block.id);
		const isAvoid = avoidIds.has(block.id);
		const isFence = fenceIds.has(block.id);
		const isEmpty = block.boundingBox === "empty";
		const isPhysical = block.boundingBox === "block" && !isFence;
		const isSafe = (isEmpty || isClimbable) && !isAvoid && !isLiquid;

		let height = 0;
		for (const shape of block.shapes) {
			const shapeTop = shape[4] ?? 0;
			if (shapeTop > height) height = shapeTop;
		}

		const result: BlockQuery = {
			safe: isSafe,
			physical: isPhysical,
			liquid: isLiquid,
			climbable: isClimbable,
			height,
			name: block.name,
		};
		blockCache.set(key, result);
		return result;
	};

	// Pre-allocated neighbors buffer — reused per getNeighbors call
	let neighbors: Move[] = [];
	let neighborCount = 0;

	/** Push a move into the neighbors buffer. */
	const pushNeighbor = (x: number, y: number, z: number, cost: number): void => {
		neighbors[neighborCount++] = { x, y, z, cost, hash: posHash(x, y, z) };
	};

	/** Forward walk: move into adjacent block at same Y level. */
	const getMoveForward = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		if (!queryBlock(nx, node.y - 1, nz).physical) return;
		if (!queryBlock(nx, node.y, nz).safe) return;
		if (!queryBlock(nx, node.y + 1, nz).safe) return;

		pushNeighbor(nx, node.y, nz, 1);
	};

	/** Jump up: move into adjacent block one Y higher. */
	const getMoveJumpUp = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;
		const ny = node.y + 1;

		if (!queryBlock(node.x, node.y + 2, node.z).safe) return;
		if (!queryBlock(nx, node.y, nz).physical) return;
		if (!queryBlock(nx, ny, nz).safe) return;
		if (!queryBlock(nx, ny + 1, nz).safe) return;

		pushNeighbor(nx, ny, nz, 2);
	};

	/** Drop down: walk forward and fall until hitting ground. */
	const getMoveDropDown = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		if (!queryBlock(nx, node.y + 1, nz).safe) return;
		if (!queryBlock(nx, node.y, nz).safe) return;
		if (queryBlock(nx, node.y - 1, nz).physical) return; // has floor = forward move

		for (let dy = -2; dy >= -(maxDropDown + 1); dy--) {
			const landing = queryBlock(nx, node.y + dy, nz);
			if (landing.physical) {
				const landY = node.y + dy + 1;
				if (landY !== node.y && !queryBlock(nx, landY, nz).safe) return;
				pushNeighbor(nx, landY, nz, 1 + (node.y - landY) * 0.5);
				return;
			}
			if (!landing.safe && !landing.liquid) return;
		}
	};

	/** Diagonal: move diagonally if both intermediate cardinal paths are clear. */
	const getMoveDiagonal = (node: Move, dx: number, dz: number): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		if (!queryBlock(nx, node.y - 1, nz).physical) return;
		if (!queryBlock(nx, node.y, nz).safe) return;
		if (!queryBlock(nx, node.y + 1, nz).safe) return;

		const p1 =
			queryBlock(node.x, node.y, node.z + dz).safe &&
			queryBlock(node.x, node.y + 1, node.z + dz).safe;
		const p2 =
			queryBlock(node.x + dx, node.y, node.z).safe &&
			queryBlock(node.x + dx, node.y + 1, node.z).safe;
		if (!p1 && !p2) return;

		pushNeighbor(nx, node.y, nz, Math.SQRT2);
	};

	const getNeighbors = (node: Move): readonly Move[] => {
		neighborCount = 0;

		for (const dir of CARDINAL) {
			getMoveForward(node, dir.x, dir.z);
			getMoveJumpUp(node, dir.x, dir.z);
			getMoveDropDown(node, dir.x, dir.z);
		}

		for (const dir of DIAGONAL) {
			getMoveDiagonal(node, dir.x, dir.z);
		}

		// Return a slice so the caller gets an independent snapshot
		return neighbors.slice(0, neighborCount);
	};

	return { getNeighbors };
};
