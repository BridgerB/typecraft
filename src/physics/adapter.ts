/**
 * Adapter that bridges our World to the PhysicsWorld interface.
 */

import { stateIdToBlock } from "../block.js";
import type { BlockDefinition } from "../registry/index.js";
import type { Vec3 } from "../vec3/index.js";
import type { World } from "../world/index.js";
import { worldGetBlockStateId } from "../world/index.js";
import type { PhysicsBlock, PhysicsWorld } from "./types.js";

/** Create a PhysicsWorld from our World, resolving collision shapes per access. */
export const createPhysicsWorld = (world: World): PhysicsWorld => {
	const registry = world.registry;
	const collisionShapes = registry.blockCollisionShapes;

	const resolveShapes = (
		def: BlockDefinition,
		stateId: number,
	): readonly (readonly number[])[] => {
		const shapeRef = collisionShapes.blocks[def.name];
		if (shapeRef === undefined) return [];
		const shapeId =
			typeof shapeRef === "number"
				? shapeRef
				: (shapeRef[stateId - def.minStateId] ?? 0);
		return collisionShapes.shapes[String(shapeId)] ?? [];
	};

	return {
		getBlock: (pos: Vec3): PhysicsBlock | null => {
			const stateId = worldGetBlockStateId(world, pos);
			if (stateId === null) return null;

			const def = registry.blocksByStateId.get(stateId);
			if (!def) return null;

			const blockInfo = stateIdToBlock(registry, stateId);
			return {
				id: def.id,
				name: def.name,
				stateId,
				shapes: resolveShapes(def, stateId),
				boundingBox: def.boundingBox,
				properties: blockInfo.properties,
			};
		},
	};
};
