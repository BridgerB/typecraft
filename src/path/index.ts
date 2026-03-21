export { computeAStar, createAStarContext } from "./astar.ts";
export {
	createGoalBlock,
	createGoalBreakBlock,
	createGoalCompositeAll,
	createGoalCompositeAny,
	createGoalFollow,
	createGoalGetToBlock,
	createGoalInvert,
	createGoalLookAtBlock,
	createGoalNear,
	createGoalNearXZ,
	createGoalPlaceBlock,
	createGoalXZ,
	createGoalY,
	type LookAtBlockOptions,
	type PlaceBlockGoalOptions,
} from "./goals.ts";
export { createMovements } from "./movements.ts";
export { createPathfinder } from "./pathfinder.ts";
export { defaultMovementsConfig, posHash } from "./types.ts";
export type {
	AStarContext,
	BlockQuery,
	Goal,
	Move,
	Movements,
	MovementsConfig,
	Pathfinder,
	PathfinderConfig,
	PathNode,
	PathResult,
	PlaceAction,
} from "./types.ts";
