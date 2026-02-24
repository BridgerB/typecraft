/**
 * Physics loop — 50ms fixed timestep, movement packets, control state, look.
 * Wires src/physics/ engine to the bot.
 */

import {
	applyPlayerState,
	createPhysics,
	createPhysicsWorld,
	createPlayerState,
	type PhysicsWorld,
	type PlayerControls,
} from "../physics/index.js";
import { subtract, type Vec3, vec3 } from "../vec3/index.js";
import {
	fromNotchianPitch,
	fromNotchianYaw,
	toNotchianPitch,
	toNotchianYaw,
} from "./conversions.js";
import type { Bot, BotOptions, ControlState } from "./types.js";
import { createTask } from "./utils.js";

/** Writable version of Vec3 for entity position/velocity mutation. */
type MutableVec3 = { x: number; y: number; z: number };

const PHYSICS_INTERVAL_MS = 50;

export const initPhysics = (bot: Bot, _options: BotOptions): void => {
	let physicsTimer: ReturnType<typeof setInterval> | null = null;
	let shouldUsePhysics = false;
	let lastSentPos = vec3(0, 0, 0);
	let lastSentYaw = 0;
	let lastSentPitch = 0;
	let positionUpdateTimer = 0;
	const lookTask = createTask<void>();
	lookTask.finish(undefined as never);
	let physicsWorld: PhysicsWorld | null = null;

	// ── Control state ──

	bot.setControlState = (control: ControlState, state: boolean) => {
		(bot.controlState as Record<string, boolean>)[control] = state;
	};

	bot.getControlState = (control: ControlState): boolean =>
		bot.controlState[control] ?? false;

	bot.clearControlStates = () => {
		for (const key of Object.keys(bot.controlState)) {
			(bot.controlState as Record<string, boolean>)[key] = false;
		}
	};

	// ── Look ──

	bot.look = async (yaw: number, pitch: number, force?: boolean) => {
		bot.entity.yaw = yaw;
		bot.entity.pitch = pitch;
		if (force) return;
		// If not forcing, we still set immediately (simplified from upstream gradual lerp)
	};

	bot.lookAt = async (point: Vec3, force?: boolean) => {
		const delta = subtract(point, bot.entity.position);
		const yaw = Math.atan2(-delta.x, delta.z);
		const groundDist = Math.sqrt(delta.x * delta.x + delta.z * delta.z);
		const pitch = Math.atan2(-delta.y, groundDist);
		return bot.look(yaw, pitch, force);
	};

	// ── Wait for ticks ──

	bot.waitForTicks = async (ticks: number): Promise<void> => {
		let remaining = ticks;
		return new Promise<void>((resolve) => {
			const onTick = () => {
				remaining--;
				if (remaining <= 0) {
					bot.removeListener("physicsTick", onTick);
					resolve();
				}
			};
			bot.on("physicsTick", onTick);
		});
	};

	// ── Elytra fly ──

	bot.elytraFly = async () => {
		if (!bot.entity.onGround && !bot.entity.elytraFlying) {
			bot.client.write("entity_action", {
				entityId: bot.entity.id,
				actionId: bot.supportFeature("entityActionUsesStringMapper")
					? "start_elytra_flying"
					: 8,
				jumpBoost: 0,
			});
		}
	};

	// ── Teleport handling ──

	bot.client.on("position", (packet: Record<string, unknown>) => {
		const flags = (packet.flags as number) ?? 0;
		const pos = bot.entity.position as MutableVec3;

		// Apply position (relative or absolute based on flags)
		pos.x =
			flags & 0x01
				? bot.entity.position.x + (packet.x as number)
				: (packet.x as number);
		pos.y =
			flags & 0x02
				? bot.entity.position.y + (packet.y as number)
				: (packet.y as number);
		pos.z =
			flags & 0x04
				? bot.entity.position.z + (packet.z as number)
				: (packet.z as number);

		bot.entity.yaw =
			flags & 0x08
				? bot.entity.yaw + fromNotchianYaw(packet.yaw as number)
				: fromNotchianYaw(packet.yaw as number);
		bot.entity.pitch =
			flags & 0x10
				? bot.entity.pitch + fromNotchianPitch(packet.pitch as number)
				: fromNotchianPitch(packet.pitch as number);

		const vel = bot.entity.velocity as MutableVec3;
		vel.x = 0;
		vel.y = 0;
		vel.z = 0;

		// Confirm teleport
		if (packet.teleportId != null) {
			bot.client.write("teleport_confirm", {
				teleportId: packet.teleportId,
			});
		}

		shouldUsePhysics = true;
		bot.emit("forcedMove");
	});

	// ── Explosion knockback ──

	bot.client.on("explosion", (packet: Record<string, unknown>) => {
		if (packet.playerMotionX != null) {
			const vel = bot.entity.velocity as MutableVec3;
			vel.x += packet.playerMotionX as number;
			vel.y += packet.playerMotionY as number;
			vel.z += packet.playerMotionZ as number;
		}
	});

	// ── Physics loop ──

	const doPhysics = () => {
		if (!bot.registry || !bot.world || !shouldUsePhysics) return;
		if (!bot.physicsEnabled) return;

		// Initialize physics engine lazily
		if (!bot.physics) {
			bot.physics = createPhysics(bot.registry);
			physicsWorld = createPhysicsWorld(bot.world);
		}

		// Create player state snapshot
		const controls: PlayerControls = {
			forward: bot.controlState.forward,
			back: bot.controlState.back,
			left: bot.controlState.left,
			right: bot.controlState.right,
			jump: bot.controlState.jump,
			sprint: bot.controlState.sprint,
			sneak: bot.controlState.sneak,
		};

		const state = createPlayerState(bot.registry, bot.entity, controls);

		// Simulate
		bot.physics.simulatePlayer(state, physicsWorld!);

		// Apply back to entity
		applyPlayerState(state, bot.entity);

		bot.emit("physicsTick");

		// Send position packet
		sendPosition();
	};

	const sendPosition = () => {
		const pos = bot.entity.position;
		const yaw = bot.entity.yaw;
		const pitch = bot.entity.pitch;
		const onGround = bot.entity.onGround;

		// 1.21.2+ uses MovementFlags bitfield instead of plain onGround boolean
		const movementFlags = {
			onGround,
			flags: { onGround, hasHorizontalCollision: false },
		};

		const posChanged =
			pos.x !== lastSentPos.x ||
			pos.y !== lastSentPos.y ||
			pos.z !== lastSentPos.z;
		const lookChanged = yaw !== lastSentYaw || pitch !== lastSentPitch;

		positionUpdateTimer++;
		const forceUpdate = positionUpdateTimer >= 20; // Every 1 second

		if (posChanged && lookChanged) {
			bot.client.write("position_look", {
				x: pos.x,
				y: pos.y,
				z: pos.z,
				yaw: toNotchianYaw(yaw),
				pitch: toNotchianPitch(pitch),
				...movementFlags,
			});
		} else if (posChanged) {
			bot.client.write("position", {
				x: pos.x,
				y: pos.y,
				z: pos.z,
				...movementFlags,
			});
		} else if (lookChanged) {
			bot.client.write("look", {
				yaw: toNotchianYaw(yaw),
				pitch: toNotchianPitch(pitch),
				...movementFlags,
			});
		} else if (forceUpdate) {
			bot.client.write("flying", { ...movementFlags });
		} else {
			return;
		}

		positionUpdateTimer = 0;
		lastSentPos = { ...pos };
		lastSentYaw = yaw;
		lastSentPitch = pitch;

		if (posChanged || lookChanged) {
			bot.emit("move", pos);
		}
	};

	// Start physics on login
	bot.client.on("login", () => {
		if (!physicsTimer) {
			physicsTimer = setInterval(doPhysics, PHYSICS_INTERVAL_MS);
		}
	});

	// Stop on disconnect
	bot.on("end", () => {
		if (physicsTimer) {
			clearInterval(physicsTimer);
			physicsTimer = null;
		}
		shouldUsePhysics = false;
	});

	// Pause physics when mounted
	bot.on("mount", () => {
		shouldUsePhysics = false;
	});

	bot.on("respawn", () => {
		shouldUsePhysics = false;
	});
};
