import type { Entity } from "../entity/types.ts";

/**
 * Collision-free numeric position hash.
 * Unique for x,z ∈ [-30000, 30000] and y ∈ [-64, 320].
 */
export const posHash = (x: number, y: number, z: number): number =>
	(x * 60001 + z) * 385 + (y + 64);

/** A discrete position node in the A* search graph (integer block coords). */
export type Move = {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly cost: number;
	readonly hash: number;
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

/** Internal A* node — mutable for heap operations and index tracking. */
export type PathNode = {
	data: Move;
	g: number;
	h: number;
	f: number;
	parent: PathNode | null;
	heapIndex: number;
};

/** Persistent A* state for incremental computation. */
export type AStarContext = {
	readonly goal: Goal;
	readonly closedSet: Set<number>;
	readonly openMap: Map<number, PathNode>;
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

/** Movement generator returned by createMovements. */
export type Movements = {
	readonly getNeighbors: (node: Move) => readonly Move[];
};

/** The pathfinder object returned by createPathfinder. */
export type Pathfinder = {
	readonly setGoal: (goal: Goal | null, dynamic?: boolean) => void;
	readonly stop: () => void;
	readonly isMoving: () => boolean;
	readonly goto: (goal: Goal) => Promise<void>;
	readonly config: PathfinderConfig;
};
