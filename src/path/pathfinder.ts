/**
 * Main pathfinder controller.
 * Attaches to bot.on("physicsTick"), manages A* lifecycle, drives bot controls.
 */

import type { Bot } from "../bot/types.ts";
import { computeAStar, createAStarContext } from "./astar.ts";
import { createMovements } from "./movements.ts";
import type {
	AStarContext,
	Goal,
	Move,
	Movements,
	MovementsConfig,
	Pathfinder,
	PathfinderConfig,
	PathResult,
} from "./types.ts";
import { posHash } from "./types.ts";

const DEFAULT_CONFIG: PathfinderConfig = {
	thinkTimeout: 10000,
	tickTimeout: 40,
	searchRadius: -1,
	maxDropDown: 4,
	reachDistance: 0.5,
	stuckTimeout: 3500,
};

/** Create a pathfinder and attach it to the bot's physics tick. */
export const createPathfinder = (
	bot: Bot,
	config: Partial<PathfinderConfig> = {},
): Pathfinder => {
	const cfg: PathfinderConfig = { ...DEFAULT_CONFIG, ...config };

	// Mutable state
	let currentGoal: Goal | null = null;
	let dynamic = false;
	let path: Move[] = [];
	let pathIndex = 0;
	let astarCtx: AStarContext | null = null;
	let astarPartial = false;
	let pathComputed = false;
	let lastNodeTime = performance.now();
	let movements: Movements | null = null;
	let digging = false;
	let placing = false;
	let retries = 0;
	let gotoResolve: (() => void) | null = null;
	let gotoReject: ((err: Error) => void) | null = null;

	/** Create a Move from the bot's current position. */
	const startMoveFromBot = (): Move => {
		const p = bot.entity.position;
		const x = Math.floor(p.x);
		const y = Math.floor(p.y);
		const z = Math.floor(p.z);
		return {
			x, y, z, cost: 0, hash: posHash(x, y, z),
			remainingBlocks: 0,
			toBreak: [],
			toPlace: [],
			parkour: false,
		};
	};

	/** Stop all bot controls. */
	const fullStop = (): void => {
		bot.clearControlStates();
	};

	/** Reset path computation state. */
	const resetPath = (): void => {
		path = [];
		pathIndex = 0;
		astarCtx = null;
		astarPartial = false;
		pathComputed = false;
		movements = null;
		retries = 0;
		lastNodeTime = performance.now();
		fullStop();
	};

	/** Resolve the goto promise if active. */
	const resolveGoto = (): void => {
		const resolve = gotoResolve;
		gotoResolve = null;
		gotoReject = null;
		resolve?.();
	};

	/** Reject the goto promise if active. */
	const rejectGoto = (reason: string): void => {
		const reject = gotoReject;
		gotoResolve = null;
		gotoReject = null;
		reject?.(new Error(reason));
	};

	/** Trim path to bot's current position (skip already-passed waypoints). */
	const trimPathToPlayer = (): void => {
		const p = bot.entity.position;
		let bestIdx = 0;
		let bestDist = Infinity;
		for (let i = 0; i < path.length; i++) {
			const dx = path[i]!.x + 0.5 - p.x;
			const dz = path[i]!.z + 0.5 - p.z;
			const d = dx * dx + dz * dz;
			if (d < bestDist) {
				bestDist = d;
				bestIdx = i;
			}
		}
		pathIndex = bestIdx;
	};

	/** Follow the current path by driving bot controls. */
	const followPath = (): void => {
		if (pathIndex >= path.length) return;

		const p = bot.entity.position;
		const next = path[pathIndex]!;

		const dx = next.x + 0.5 - p.x;
		const dz = next.z + 0.5 - p.z;
		const dy = next.y - p.y;

		if (
			dx * dx + dz * dz <= cfg.reachDistance * cfg.reachDistance &&
			Math.abs(dy) < 1.5
		) {
			lastNodeTime = performance.now();
			pathIndex++;

			if (pathIndex >= path.length) {
				fullStop();
				if (currentGoal) {
					const m = startMoveFromBot();
					if (currentGoal.isEnd(m)) {
						bot.emit("goal_reached", currentGoal);
						resolveGoto();
						if (!dynamic) currentGoal = null;
						pathComputed = true;
						return;
					}
				}
				// Path exhausted but goal not reached — will recompute next tick
				return;
			}
		}

		const nextMove = path[pathIndex]!;

		// Handle block breaking before moving to waypoint
		if (nextMove.toBreak.length > 0 && !digging) {
			digging = true;
			const blockPos = nextMove.toBreak[0]!;
			const block = bot.blockAt({
				x: blockPos.x,
				y: blockPos.y,
				z: blockPos.z,
			} as any);
			if (block) {
				bot.dig(block, true, "raycast")
					.then(() => {
						digging = false;
					})
					.catch(() => {
						digging = false;
						// Reset path on dig error
						path = [];
						pathIndex = 0;
						astarCtx = null;
						pathComputed = false;
						bot.emit("path_reset" as any, "dig_error");
					});
			} else {
				digging = false;
			}
			return; // Don't move while digging
		}

		// Handle block placing before moving to waypoint
		if (nextMove.toPlace.length > 0 && !placing) {
			placing = true;
			const action = nextMove.toPlace[0]!;
			const refPos = {
				x: action.x + action.dx,
				y: action.y + action.dy,
				z: action.z + action.dz,
			};
			const faceVec = { x: -action.dx, y: -action.dy, z: -action.dz };
			if (action.jump) {
				bot.setControlState("jump", true);
			}
			bot.placeBlock({ position: refPos } as any, faceVec as any)
				.then(() => {
					placing = false;
					if (action.jump) bot.setControlState("jump", false);
				})
				.catch(() => {
					placing = false;
					if (action.jump) bot.setControlState("jump", false);
					path = [];
					pathIndex = 0;
					astarCtx = null;
					pathComputed = false;
					bot.emit("path_reset" as any, "place_error");
				});
			return; // Don't move while placing
		}

		// Don't move while digging or placing
		if (digging || placing) return;

		const wp = nextMove;
		const moveX = wp.x + 0.5 - p.x;
		const moveZ = wp.z + 0.5 - p.z;

		bot.look(Math.atan2(-moveX, -moveZ), 0, true);
		bot.setControlState("forward", true);
		if (nextMove.parkour) {
			bot.setControlState("sprint", true);
			bot.setControlState("jump", true);
		} else {
			bot.setControlState("sprint", true);
			bot.setControlState("jump", wp.y > p.y + 0.5);
		}

		if (performance.now() - lastNodeTime > cfg.stuckTimeout) resetPath();
	};

	/** Called every physicsTick (~50ms). */
	const onPhysicsTick = (): void => {
		if (!currentGoal || !bot.world || !bot.registry) return;

		// Check goal validity
		if (currentGoal.isValid && !currentGoal.isValid()) {
			currentGoal = null;
			resetPath();
			bot.emit("path_stop");
			rejectGoto("Goal invalid (target despawned)");
			return;
		}

		// Check dynamic goal changes
		if (currentGoal.hasChanged?.()) resetPath();

		// Continue incremental A* every tick while partial — walk + compute simultaneously
		if (astarCtx && astarPartial && movements) {
			const result = computeAStar(
				astarCtx,
				movements,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			trimPathToPlayer();
			astarPartial = result.status === "partial";
			if (result.status !== "partial") {
				astarCtx = null;
				pathComputed = true;
			}
			bot.emit("path_update" as any, result);
			if (result.status === "noPath") rejectGoto("No path found");
			if (result.status === "timeout") {
				// A* timed out — walk the best path found, then try to recompute from there
				pathComputed = false;
			}
			// Fall through to followPath — walk while computing
		}

		// Start new A* if needed (but not while a partial computation is in progress)
		if (pathIndex >= path.length && !pathComputed && !astarPartial) {
			const currentMove = startMoveFromBot();

			if (currentGoal.isEnd(currentMove)) {
				fullStop();
				bot.emit("goal_reached", currentGoal);
				resolveGoto();
				if (!dynamic) currentGoal = null;
				pathComputed = true;
				return;
			}

			// Create movements once per path computation
			movements = createMovements(bot, { maxDropDown: cfg.maxDropDown });
			astarCtx = createAStarContext(
				currentMove,
				currentGoal,
				cfg.thinkTimeout,
				cfg.searchRadius,
			);
			const result = computeAStar(
				astarCtx,
				movements,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			trimPathToPlayer();
			pathComputed = result.status !== "partial";
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			bot.emit("path_update" as any, result);
			if (result.status === "noPath" && !astarPartial)
				rejectGoto("No path found");
			// Don't fall through on initial tick — let partial continuation handle next ticks
			if (astarPartial) return;
		}

		if (pathIndex < path.length) {
			followPath();
		} else if (pathComputed && currentGoal) {
			// Path exhausted but goal not reached — recompute after stuck timeout
			if (performance.now() - lastNodeTime > cfg.stuckTimeout) {
				retries++;
				if (retries > 3) {
					fullStop();
					rejectGoto("Path incomplete after retries");
					if (!dynamic) currentGoal = null;
					return;
				}
				pathComputed = false;
			}
		}
	};

	bot.on("physicsTick", onPhysicsTick);

	const setGoal = (goal: Goal | null, isDynamic = false): void => {
		currentGoal = goal;
		dynamic = isDynamic;
		resetPath();
		bot.emit("goal_updated" as any, goal, isDynamic);
		bot.emit("path_reset" as any, "goal_updated");
		if (!goal) {
			bot.emit("path_stop");
			rejectGoto("Goal cleared");
		}
	};

	const stop = (): void => {
		currentGoal = null;
		resetPath();
		bot.emit("path_stop");
		rejectGoto("Pathfinder stopped");
	};

	const gotoGoal = (goal: Goal): Promise<void> =>
		new Promise((resolve, reject) => {
			const cleanup = () => {
				bot.removeListener("goal_reached", onReached);
				bot.removeListener("path_stop", onStop);
				bot.removeListener("path_reset", onReset);
			};
			const onReached = () => {
				cleanup();
				resolve();
			};
			const onStop = () => {
				cleanup();
				reject(new Error("Pathfinder stopped"));
			};
			const onReset = (reason: string) => {
				if (reason === "goal_updated") {
					cleanup();
					reject(new Error("Goal changed"));
				}
			};
			gotoResolve = resolve;
			gotoReject = reject;
			setGoal(goal);

			// Listen AFTER setGoal so we don't catch the initial path_reset
			bot.on("goal_reached", onReached);
			bot.on("path_stop", onStop);
			bot.on("path_reset" as any, onReset);

			const onPathUpdate = (result: { status: string }) => {
				if (result.status === "noPath") {
					bot.removeListener("path_update" as any, onPathUpdate);
					cleanup();
					reject(new Error("No path found"));
				}
			};
			bot.on("path_update" as any, onPathUpdate);
		});

	const isMining = (): boolean => digging;
	const isBuilding = (): boolean => placing;

	const setMovements = (config: Partial<MovementsConfig>): void => {
		movements = createMovements(bot, config);
		// Reset current path since movements changed
		path = [];
		pathIndex = 0;
		astarCtx = null;
		pathComputed = false;
		bot.emit("path_reset" as any, "movements_updated");
	};

	const bestHarvestTool = (block: unknown): unknown | null => {
		if (!bot.registry || !bot.inventory) return null;
		const blockObj = block as { name?: string };
		if (!blockObj.name) return null;

		let bestTool: unknown | null = null;

		// Check each inventory item
		for (let i = 0; i < bot.inventory.slots.length; i++) {
			const item = bot.inventory.slots[i];
			if (!item) continue;

			// Use the block's material to check if this tool is effective
			const blockDef = bot.registry.blocksByName.get(blockObj.name);
			if (!blockDef?.material) continue;

			const materialSpeeds = bot.registry.materials[blockDef.material];
			if (materialSpeeds && materialSpeeds[item.type]) {
				// This tool has a speed for this material
				const toolSpeed = materialSpeeds[item.type];
				// Rough estimate: faster tool = lower time
				if (toolSpeed > 1) {
					bestTool = item;
					break; // Take first matching tool
				}
			}
		}

		return bestTool;
	};

	const getPathTo = (goal: Goal, timeout?: number): PathResult => {
		if (!movements) movements = createMovements(bot, {});
		const ctx = createAStarContext(
			startMoveFromBot(),
			goal,
			timeout ?? cfg.thinkTimeout,
			cfg.searchRadius,
		);
		return computeAStar(
			ctx,
			movements,
			timeout ?? cfg.thinkTimeout,
			timeout ?? cfg.thinkTimeout,
		);
	};

	// Reset path when nearby block changes
	bot.on("blockUpdate", (_old: unknown, newBlock: unknown) => {
		if (!path || path.length === 0) return;
		const nb = newBlock as {
			position?: { x: number; y: number; z: number };
		} | null;
		if (!nb?.position) return;

		// Check if the changed block is near any point on our current path
		for (const waypoint of path) {
			const dx = Math.abs(waypoint.x - nb.position.x);
			const dy = Math.abs(waypoint.y - nb.position.y);
			const dz = Math.abs(waypoint.z - nb.position.z);
			if (dx <= 1 && dy <= 2 && dz <= 1) {
				path = [];
				pathIndex = 0;
				astarCtx = null;
				pathComputed = false;
				bot.emit("path_reset" as any, "block_updated");
				break;
			}
		}
	});

	return {
		setGoal,
		setMovements,
		stop,
		isMoving: () => pathIndex < path.length || astarPartial,
		isMining,
		isBuilding,
		goto: gotoGoal,
		getPathTo,
		bestHarvestTool,
		config: cfg,
	};
};
