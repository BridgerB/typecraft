/**
 * Goal factory functions for A* pathfinding.
 * Each goal provides a heuristic and end-condition for the search.
 */

import type { Entity } from "../entity/types.ts";
import type { Goal, Move } from "./types.ts";

/** Octile distance on XZ + manhattan on Y. Admissible heuristic for A*. */
const octileHeuristic = (
	dx: number,
	dy: number,
	dz: number,
): number => {
	const adx = Math.abs(dx);
	const adz = Math.abs(dz);
	return Math.abs(adx - adz) + Math.min(adx, adz) * Math.SQRT2 + Math.abs(dy);
};

/** Goal: stand at exact block position. */
export const createGoalBlock = (x: number, y: number, z: number): Goal => {
	const gx = Math.floor(x);
	const gy = Math.floor(y);
	const gz = Math.floor(z);
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, gy - node.y, gz - node.z),
		isEnd: (node) => node.x === gx && node.y === gy && node.z === gz,
	};
};

/** Goal: within range of a static position. */
export const createGoalNear = (
	x: number,
	y: number,
	z: number,
	range: number,
): Goal => {
	const gx = Math.floor(x);
	const gy = Math.floor(y);
	const gz = Math.floor(z);
	const rangeSq = range * range;
	return {
		heuristic: (node) => octileHeuristic(gx - node.x, gy - node.y, gz - node.z),
		isEnd: (node) => {
			const dx = gx - node.x;
			const dy = gy - node.y;
			const dz = gz - node.z;
			return dx * dx + dy * dy + dz * dz <= rangeSq;
		},
	};
};

/** Goal: follow a moving entity within range. Dynamic — hasChanged() triggers recomputation. */
export const createGoalFollow = (entity: Entity, range: number): Goal => {
	const rangeSq = range * range;
	let lastX = Math.floor(entity.position.x);
	let lastY = Math.floor(entity.position.y);
	let lastZ = Math.floor(entity.position.z);

	return {
		heuristic: (node) =>
			octileHeuristic(lastX - node.x, lastY - node.y, lastZ - node.z),

		isEnd: (node) => {
			const dx = lastX - node.x;
			const dy = lastY - node.y;
			const dz = lastZ - node.z;
			return dx * dx + dy * dy + dz * dz <= rangeSq;
		},

		hasChanged: () => {
			const px = Math.floor(entity.position.x);
			const py = Math.floor(entity.position.y);
			const pz = Math.floor(entity.position.z);
			const dx = lastX - px;
			const dy = lastY - py;
			const dz = lastZ - pz;
			if (dx * dx + dy * dy + dz * dz > rangeSq) {
				lastX = px;
				lastY = py;
				lastZ = pz;
				return true;
			}
			return false;
		},

		isValid: () => entity.isValid,
	};
};
