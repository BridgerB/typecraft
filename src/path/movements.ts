/**
 * Movement generation for A* pathfinding.
 * Queries blocks via PhysicsWorld adapter, classifies them,
 * and generates valid neighboring moves (walk, jump, drop, diagonal).
 */

import type { Bot } from "../bot/types.ts";
import { createPhysicsWorld } from "../physics/adapter.ts";
import type { PhysicsBlock, PhysicsWorld } from "../physics/types.ts";
import type { Registry } from "../registry/types.ts";
import type { BlockQuery, Move } from "./types.ts";

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

/** Create a move node at integer coordinates. */
const createMove = (x: number, y: number, z: number, cost: number): Move => ({
	x,
	y,
	z,
	cost,
	hash: `${x},${y},${z}`,
});

/** Create a movement generator bound to the bot's current world state. */
export const createMovements = (
	bot: Bot,
	maxDropDown = 3,
): { getNeighbors: (node: Move) => Move[] } => {
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

	// Classify blocks with shapes taller than 1 as fences (can't step onto)
	const collisionShapes = registry.blockCollisionShapes;
	for (const block of registry.blocksArray) {
		const shapeRef = collisionShapes.blocks[block.name];
		if (shapeRef === undefined) continue;
		const shapeId = typeof shapeRef === "number" ? shapeRef : (shapeRef[0] ?? 0);
		const shapes = collisionShapes.shapes[String(shapeId)] ?? [];
		for (const shape of shapes) {
			if ((shape[4] ?? 0) > 1.0) {
				fenceIds.add(block.id);
				break;
			}
		}
	}

	/** Query block properties at an absolute position. */
	const queryBlock = (x: number, y: number, z: number): BlockQuery => {
		const block = physicsWorld.getBlock({ x, y, z });
		if (!block)
			return {
				safe: false,
				physical: false,
				liquid: false,
				climbable: false,
				height: 0,
				name: "void",
			};

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

		return {
			safe: isSafe,
			physical: isPhysical,
			liquid: isLiquid,
			climbable: isClimbable,
			height,
			name: block.name,
		};
	};

	/** Forward walk: move into adjacent block at same Y level. */
	const getMoveForward = (
		node: Move,
		dx: number,
		dz: number,
		neighbors: Move[],
	): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		const floor = queryBlock(nx, node.y - 1, nz);
		if (!floor.physical) return;

		const feet = queryBlock(nx, node.y, nz);
		if (!feet.safe) return;

		const head = queryBlock(nx, node.y + 1, nz);
		if (!head.safe) return;

		neighbors.push(createMove(nx, node.y, nz, 1));
	};

	/** Jump up: move into adjacent block one Y higher. */
	const getMoveJumpUp = (
		node: Move,
		dx: number,
		dz: number,
		neighbors: Move[],
	): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;
		const ny = node.y + 1;

		// Need headroom above current position
		const aboveHead = queryBlock(node.x, node.y + 2, node.z);
		if (!aboveHead.safe) return;

		// Need solid floor at destination
		const floor = queryBlock(nx, node.y, nz);
		if (!floor.physical) return;

		// Need clear space at destination (feet + head)
		const feet = queryBlock(nx, ny, nz);
		if (!feet.safe) return;

		const head = queryBlock(nx, ny + 1, nz);
		if (!head.safe) return;

		neighbors.push(createMove(nx, ny, nz, 2));
	};

	/** Drop down: walk forward and fall until hitting ground. */
	const getMoveDropDown = (
		node: Move,
		dx: number,
		dz: number,
		neighbors: Move[],
	): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		// Need headroom at step-off
		const head = queryBlock(nx, node.y + 1, nz);
		if (!head.safe) return;

		const feet = queryBlock(nx, node.y, nz);
		if (!feet.safe) return;

		// Already has floor? That's a forward move, not a drop.
		const floorBelow = queryBlock(nx, node.y - 1, nz);
		if (floorBelow.physical) return;

		// Fall until we hit ground
		for (let dy = -2; dy >= -(maxDropDown + 1); dy--) {
			const landing = queryBlock(nx, node.y + dy, nz);
			if (landing.physical) {
				const landY = node.y + dy + 1;
				// Verify space above landing is clear
				const aboveLanding = queryBlock(nx, landY, nz);
				if (!aboveLanding.safe) return;
				const fallDist = node.y - landY;
				neighbors.push(createMove(nx, landY, nz, 1 + fallDist * 0.5));
				return;
			}
			if (!landing.safe && !landing.liquid) return;
		}
	};

	/** Diagonal: move diagonally if both intermediate cardinal paths are clear. */
	const getMoveDiagonal = (
		node: Move,
		dx: number,
		dz: number,
		neighbors: Move[],
	): void => {
		const nx = node.x + dx;
		const nz = node.z + dz;

		// Need solid floor at destination
		const floor = queryBlock(nx, node.y - 1, nz);
		if (!floor.physical) return;

		// Need clear space at destination
		const feet = queryBlock(nx, node.y, nz);
		if (!feet.safe) return;

		const head = queryBlock(nx, node.y + 1, nz);
		if (!head.safe) return;

		// At least one intermediate cardinal path must be passable
		const path1Feet = queryBlock(node.x, node.y, node.z + dz);
		const path1Head = queryBlock(node.x, node.y + 1, node.z + dz);
		const path2Feet = queryBlock(node.x + dx, node.y, node.z);
		const path2Head = queryBlock(node.x + dx, node.y + 1, node.z);

		const path1Clear = path1Feet.safe && path1Head.safe;
		const path2Clear = path2Feet.safe && path2Head.safe;
		if (!path1Clear && !path2Clear) return;

		neighbors.push(createMove(nx, node.y, nz, Math.SQRT2));
	};

	const getNeighbors = (node: Move): Move[] => {
		const neighbors: Move[] = [];

		for (const dir of CARDINAL) {
			getMoveForward(node, dir.x, dir.z, neighbors);
			getMoveJumpUp(node, dir.x, dir.z, neighbors);
			getMoveDropDown(node, dir.x, dir.z, neighbors);
		}

		for (const dir of DIAGONAL) {
			getMoveDiagonal(node, dir.x, dir.z, neighbors);
		}

		return neighbors;
	};

	return { getNeighbors };
};
