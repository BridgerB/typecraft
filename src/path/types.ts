import type { Entity } from "../entity/types.ts";

/** A discrete position node in the A* search graph (integer block coords). */
export type Move = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly cost: number;
	readonly hash: string;
};

/** Goal interface — functions that drive A* toward a target. */
export type Goal = {
	readonly heuristic: (node: Move) => number;
	readonly isEnd: (node: Move) => boolean;
	readonly hasChanged?: () => boolean;
	readonly isValid?: () => boolean;
};

/** Result from an A* computation (single tick or final). */
export type PathResult = {
	readonly status: "success" | "timeout" | "noPath" | "partial";
	readonly path: readonly Move[];
	readonly cost: number;
	readonly visitedNodes: number;
	readonly generatedNodes: number;
	readonly time: number;
};

/** Configuration for the pathfinder. */
export type PathfinderConfig = {
	readonly thinkTimeout: number;
	readonly tickTimeout: number;
	readonly searchRadius: number;
	readonly maxDropDown: number;
	readonly reachDistance: number;
	readonly stuckTimeout: number;
};

/** Internal A* node — mutable for heap operations. */
export type PathNode = {
	data: Move;
	g: number;
	h: number;
	f: number;
	parent: PathNode | null;
};

/** Persistent A* state for incremental computation. */
export type AStarContext = {
	readonly goal: Goal;
	readonly closedSet: Set<string>;
	readonly openMap: Map<string, PathNode>;
	readonly openHeap: PathNode[];
	bestNode: PathNode;
	readonly startTime: number;
	readonly maxCost: number;
};

/** Simplified block query result for movement decisions. */
export type BlockQuery = {
	readonly safe: boolean;
	readonly physical: boolean;
	readonly liquid: boolean;
	readonly climbable: boolean;
	readonly height: number;
	readonly name: string;
};

/** The pathfinder object returned by createPathfinder. */
export type Pathfinder = {
	readonly setGoal: (goal: Goal | null, dynamic?: boolean) => void;
	readonly stop: () => void;
	readonly isMoving: () => boolean;
	readonly goto: (goal: Goal) => Promise<void>;
	readonly config: PathfinderConfig;
};
