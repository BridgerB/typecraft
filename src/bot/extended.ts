/**
 * Extended features — bed, title, book, sound, explosion, particle,
 * resource pack, kick, fishing, ray trace.
 */

import { type Vec3, vec3 } from "../vec3/index.ts";
import {
	directionFromYawPitch,
	PLAYER_EYE_HEIGHT,
	raycast,
} from "../world/index.ts";
import type {
	Bot,
	BotOptions,
	CommandBlockOptions,
	Particle,
	Task,
} from "./types.ts";
import { createTask } from "./utils.ts";

export const initExtended = (bot: Bot, _options: BotOptions): void => {
	// ── Sleeping ──

	bot.sleep = async (bedBlock: Vec3): Promise<void> => {
		bot.client.write("block_place", {
			location: { x: bedBlock.x, y: bedBlock.y, z: bedBlock.z },
			direction: 0,
			hand: 0,
			cursorX: 0.5,
			cursorY: 0.5,
			cursorZ: 0.5,
			insideBlock: false,
			sequence: 0,
		});

		// Wait for sleep confirmation
		return new Promise<void>((resolve) => {
			const onMetadata = () => {
				if (bot.isSleeping) {
					bot.removeListener("entityUpdate", onMetadata);
					bot.emit("sleep");
					resolve();
				}
			};
			bot.on("entityUpdate", onMetadata);
			setTimeout(() => {
				bot.removeListener("entityUpdate", onMetadata);
				resolve();
			}, 3000);
		});
	};

	bot.wake = async (): Promise<void> => {
		bot.client.write("entity_action", {
			entityId: bot.entity.id,
			actionId: bot.supportFeature("entityActionUsesStringMapper")
				? "leave_bed"
				: 2,
			jumpBoost: 0,
		});
		bot.isSleeping = false;
		bot.emit("wake");
	};

	// ── Title ──

	bot.client.on("set_title_text", (packet: Record<string, unknown>) => {
		const text = (packet.text as string) ?? "";
		bot.emit("title", text, "title");
	});

	bot.client.on("set_title_subtitle", (packet: Record<string, unknown>) => {
		const text = (packet.text as string) ?? "";
		bot.emit("title", text, "subtitle");
	});

	// Legacy title packet
	bot.client.on("title", (packet: Record<string, unknown>) => {
		const action = packet.action as number;
		if (action === 0) {
			bot.emit("title", (packet.text as string) ?? "", "title");
		} else if (action === 1) {
			bot.emit("title", (packet.text as string) ?? "", "subtitle");
		}
	});

	// ── Sound ──

	bot.client.on("sound_effect", (packet: Record<string, unknown>) => {
		const soundId = packet.soundId as number;
		const soundCategory = (packet.soundCategory as number) ?? 0;
		const x = ((packet.x as number) ?? 0) / 8;
		const y = ((packet.y as number) ?? 0) / 8;
		const z = ((packet.z as number) ?? 0) / 8;
		const volume = (packet.volume as number) ?? 1;
		const pitch = (packet.pitch as number) ?? 1;

		bot.emit(
			"hardcodedSoundEffectHeard",
			soundId,
			soundCategory,
			vec3(x, y, z),
			volume,
			pitch,
		);
	});

	bot.client.on("named_sound_effect", (packet: Record<string, unknown>) => {
		const soundName = (packet.soundName as string) ?? "";
		const x = ((packet.x as number) ?? 0) / 8;
		const y = ((packet.y as number) ?? 0) / 8;
		const z = ((packet.z as number) ?? 0) / 8;
		const volume = (packet.volume as number) ?? 1;
		const pitch = (packet.pitch as number) ?? 1;

		bot.emit("soundEffectHeard", soundName, vec3(x, y, z), volume, pitch);
	});

	// ── Particle ──

	bot.client.on("world_particles", (packet: Record<string, unknown>) => {
		const particle: Particle = {
			id: (packet.particleId as number) ?? 0,
			position: vec3(
				packet.x as number,
				packet.y as number,
				packet.z as number,
			),
			offset: vec3(
				(packet.offsetX as number) ?? 0,
				(packet.offsetY as number) ?? 0,
				(packet.offsetZ as number) ?? 0,
			),
			count: (packet.particles as number) ?? 1,
			movementSpeed: (packet.particleData as number) ?? 0,
			longDistanceRender: (packet.longDistance as boolean) ?? false,
		};
		bot.emit("particle", particle);
	});

	// ── Resource pack ──

	bot.client.on("resource_pack_send", (packet: Record<string, unknown>) => {
		const url = packet.url as string;
		const hash = packet.hash as string | undefined;
		const uuid = packet.uuid as string | undefined;
		bot.emit("resourcePack", url, hash, uuid);
	});

	bot.acceptResourcePack = () => {
		bot.client.write("resource_pack_receive", {
			result: 3, // accepted
		});
		bot.client.write("resource_pack_receive", {
			result: 0, // loaded
		});
	};

	bot.denyResourcePack = () => {
		bot.client.write("resource_pack_receive", {
			result: 1, // declined
		});
	};

	// ── Fishing ──

	let fishingTask: Task<void> | null = null;

	bot.fish = async (): Promise<void> => {
		bot.activateItem();
		fishingTask = createTask<void>();

		// Wait for bobber entity + completion
		// Simplified: wait for collect event or timeout
		const timeout = setTimeout(() => {
			if (fishingTask) {
				fishingTask.finish(undefined as never);
				fishingTask = null;
			}
		}, 60000);

		try {
			await fishingTask.promise;
		} finally {
			clearTimeout(timeout);
			bot.activateItem(); // reel in
		}
	};

	// ── Block at cursor ──

	bot.blockAtCursor = (maxDistance = 5) => {
		if (!bot.world || !bot.registry) return null;
		const eye = vec3(
			bot.entity.position.x,
			bot.entity.position.y + PLAYER_EYE_HEIGHT,
			bot.entity.position.z,
		);
		const dir = directionFromYawPitch(bot.entity.yaw, bot.entity.pitch);
		const hit = raycast(bot.world, eye, dir, maxDistance);
		if (!hit) return null;
		return {
			position: hit.position,
			face: hit.face,
			intersect: hit.intersect,
			name: hit.name,
			stateId: hit.stateId,
		};
	};

	// ── Command block ──

	bot.setCommandBlock = (
		pos: Vec3,
		command: string,
		options: CommandBlockOptions,
	) => {
		bot.client.write("update_command_block", {
			location: { x: pos.x, y: pos.y, z: pos.z },
			command,
			mode: options.mode,
			flags:
				(options.trackOutput ? 0x01 : 0) |
				(options.conditional ? 0x02 : 0) |
				(options.alwaysActive ? 0x04 : 0),
		});
	};
};
