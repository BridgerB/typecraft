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
	Pathfinder,
	PathfinderConfig,
} from "./types.ts";
import { posHash } from "./types.ts";

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
	let movements: Movements | null = null;
	let gotoResolve: (() => void) | null = null;
	let gotoReject: ((err: Error) => void) | null = null;

	/** Create a Move from the bot's current position. */
	const startMoveFromBot = (): Move => {
		const p = bot.entity.position;
		const x = Math.floor(p.x);
		const y = Math.floor(p.y);
		const z = Math.floor(p.z);
		return { x, y, z, cost: 0, hash: posHash(x, y, z) };
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
					}
				}
				pathComputed = false;
				return;
			}
		}

		const wp = path[pathIndex]!;
		const moveX = wp.x + 0.5 - p.x;
		const moveZ = wp.z + 0.5 - p.z;

		bot.look(Math.atan2(-moveX, -moveZ), 0, true);
		bot.setControlState("forward", true);
		bot.setControlState("sprint", true);
		bot.setControlState("jump", wp.y > p.y + 0.5);

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

		// Continue incremental A* if partial (reuse existing movements)
		if (astarCtx && astarPartial && movements) {
			const result = computeAStar(
				astarCtx,
				movements,
				cfg.tickTimeout,
				cfg.thinkTimeout,
			);
			path = [...result.path];
			pathIndex = 0;
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			if (result.status === "noPath") rejectGoto("No path found");
			return;
		}

		// Start new A* if needed
		if (pathIndex >= path.length && !pathComputed) {
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
			movements = createMovements(bot, cfg.maxDropDown);
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
			pathIndex = 0;
			pathComputed = true;
			astarPartial = result.status === "partial";
			if (result.status !== "partial") astarCtx = null;
			if (result.status === "noPath" && !astarPartial)
				rejectGoto("No path found");
			return;
		}

		if (pathIndex < path.length) followPath();
	};

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

	return {
		setGoal,
		stop,
		isMoving: () => pathIndex < path.length || astarPartial,
		goto,
		config: cfg,
	};
};
