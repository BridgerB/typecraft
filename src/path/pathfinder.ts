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
	Pathfinder,
	PathfinderConfig,
	PathResult,
} from "./types.ts";

const DEFAULT_CONFIG: PathfinderConfig = {
	thinkTimeout: 5000,
	tickTimeout: 40,
	searchRadius: -1,
	maxDropDown: 3,
	reachDistance: 0.35,
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
	let gotoResolve: (() => void) | null = null;
	let gotoReject: ((err: Error) => void) | null = null;

	/** Create a Move from the bot's current position. */
	const startMoveFromBot = (): Move => {
		const p = bot.entity.position;
		const x = Math.floor(p.x);
		const y = Math.floor(p.y);
		const z = Math.floor(p.z);
		return { x, y, z, cost: 0, hash: `${x},${y},${z}` };
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

	/** Follow the current path by driving bot controls. */
	const followPath = (): void => {
		if (pathIndex >= path.length) return;

		const p = bot.entity.position;
		const next = path[pathIndex]!;

		// Check if we reached the current waypoint
		const dx = next.x + 0.5 - p.x;
		const dz = next.z + 0.5 - p.z;
		const dy = next.y - p.y;
		const xzDistSq = dx * dx + dz * dz;

		if (xzDistSq <= cfg.reachDistance * cfg.reachDistance && Math.abs(dy) < 1.5) {
			lastNodeTime = performance.now();
			pathIndex++;

			if (pathIndex >= path.length) {
				fullStop();
				if (currentGoal) {
					const flooredMove = startMoveFromBot();
					if (currentGoal.isEnd(flooredMove)) {
						bot.emit("goal_reached", currentGoal);
						resolveGoto();
						if (!dynamic) currentGoal = null;
					}
				}
				pathComputed = false;
				return;
			}
		}

		// Drive toward next waypoint
		const wp = path[pathIndex]!;
		const moveX = wp.x + 0.5 - p.x;
		const moveZ = wp.z + 0.5 - p.z;
		const yaw = Math.atan2(-moveX, -moveZ);

		bot.look(yaw, 0, true);
		bot.setControlState("forward", true);
		bot.setControlState("sprint", true);

		// Jump if next waypoint is above us
		bot.setControlState("jump", wp.y > p.y + 0.5);

		// Stuck detection
		if (performance.now() - lastNodeTime > cfg.stuckTimeout) {
			resetPath();
		}
	};

	/** Called every physicsTick (~50ms). */
	const onPhysicsTick = (): void => {
		if (!currentGoal) return;
		if (!bot.world || !bot.registry) return;

		// Check goal validity
		if (currentGoal.isValid && !currentGoal.isValid()) {
			const goal = currentGoal;
			currentGoal = null;
			resetPath();
			bot.emit("path_stop");
			rejectGoto("Goal invalid (target despawned)");
			return;
		}

		// Check dynamic goal changes
		if (currentGoal.hasChanged?.()) {
			resetPath();
		}

		// Continue incremental A* if partial
		if (astarCtx && astarPartial) {
			const movements = createMovements(bot, cfg.maxDropDown);
			const result = computeAStar(
				astarCtx,
				movements.getNeighbors,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			pathIndex = 0;
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			if (result.status === "noPath") {
				rejectGoto("No path found");
			}
			return;
		}

		// Start new A* if needed
		if (pathIndex >= path.length && !pathComputed) {
			const currentMove = startMoveFromBot();

			// Already at goal?
			if (currentGoal.isEnd(currentMove)) {
				fullStop();
				bot.emit("goal_reached", currentGoal);
				resolveGoto();
				if (!dynamic) currentGoal = null;
				pathComputed = true;
				return;
			}

			const movements = createMovements(bot, cfg.maxDropDown);
			astarCtx = createAStarContext(
				currentMove,
				currentGoal,
				cfg.thinkTimeout,
				cfg.searchRadius,
			);
			const result = computeAStar(
				astarCtx,
				movements.getNeighbors,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			pathIndex = 0;
			pathComputed = true;
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			if (result.status === "noPath" && !astarPartial) {
				rejectGoto("No path found");
			}
			return;
		}

		// Follow the path
		if (pathIndex < path.length) {
			followPath();
		}
	};

	// Attach to physics tick
	bot.on("physicsTick", onPhysicsTick);

	const setGoal = (goal: Goal | null, isDynamic = false): void => {
		currentGoal = goal;
		dynamic = isDynamic;
		resetPath();
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

	const goto = (goal: Goal): Promise<void> =>
		new Promise((resolve, reject) => {
			gotoResolve = resolve;
			gotoReject = reject;
			setGoal(goal);
		});

	const pathfinder: Pathfinder = {
		setGoal,
		stop,
		isMoving: () => pathIndex < path.length || astarPartial,
		goto,
		config: cfg,
	};

	return pathfinder;
};
