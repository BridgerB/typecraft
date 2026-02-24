import type { Item } from "../item/types.ts";
import type { Vec3 } from "../vec3/index.ts";

/** Entity classification. */
export type EntityType =
	| "player"
	| "mob"
	| "object"
	| "global"
	| "orb"
	| "projectile"
	| "hostile"
	| "other";

/** Active potion effect on an entity. */
export type Effect = {
	id: number;
	amplifier: number;
	duration: number;
};

/** A Minecraft entity — player, mob, object, or other. */
export type Entity = {
	id: number;
	type: EntityType;
	uuid: string | null;
	username: string | null;
	name: string | null;
	displayName: string | null;
	entityType: number | null;
	kind: string | null;
	position: Vec3;
	velocity: Vec3;
	yaw: number;
	pitch: number;
	onGround: boolean;
	height: number;
	width: number;
	equipment: (Item | null)[];
	metadata: unknown[];
	effects: Map<number, Effect>;
	vehicle: Entity | null;
	passengers: Entity[];
	health: number;
	food: number;
	foodSaturation: number;
	elytraFlying: boolean;
	isValid: boolean;
	count: number | null;
	/** Fixed-point position tracking (integer, avoids float drift). */
	_fixedX: number;
	_fixedY: number;
	_fixedZ: number;
};
