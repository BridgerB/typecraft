/**
 * World state — time, weather, spawn point.
 * Combines upstream rain.js, time.js, spawn_point.js.
 */

import { vec3 } from "../vec3/index.ts";
import type { Bot, BotOptions } from "./types.ts";

export const initWorldState = (bot: Bot, _options: BotOptions): void => {
	// ── Time ──

	bot.client.on("update_time", (packet: Record<string, unknown>) => {
		const age = packet.age as bigint | number;
		const time = packet.time as bigint | number;

		const bigAge = typeof age === "bigint" ? age : BigInt(age);
		const bigTime = typeof time === "bigint" ? time : BigInt(time);

		// Negative time means doDaylightCycle is false
		const doDaylightCycle = bigTime >= 0n;
		const absTime = doDaylightCycle ? bigTime : -bigTime;

		bot.time = {
			doDaylightCycle,
			bigTime: absTime,
			time: Number(absTime),
			timeOfDay: Number(absTime % 24000n),
			day: Number(absTime / 24000n),
			isDay: Number(absTime % 24000n) < 13000,
			moonPhase: Number(absTime / 24000n) % 8,
			bigAge,
			age: Number(bigAge),
		};

		bot.emit("time");
	});

	// ── Rain / weather ──

	bot.client.on("game_state_change", (packet: Record<string, unknown>) => {
		const reason = packet.reason as number | string;
		const value = packet.gameMode as number;

		// Rain start
		if (reason === 1 || reason === "begin_raining") {
			bot.isRaining = true;
			bot.emit("rain");
		}
		// Rain stop
		if (reason === 2 || reason === "end_raining") {
			bot.isRaining = false;
			bot.emit("rain");
		}
		// Thunder level
		if (reason === 7 || reason === "thunder_level_change") {
			bot.thunderState = value;
			bot.emit("rain");
		}
		// Rain level
		if (reason === 8 || reason === "rain_level_change") {
			// Rain level, used for transition
		}
	});

	// ── Spawn point ──

	bot.client.on("spawn_position", (packet: Record<string, unknown>) => {
		const loc = packet.location as Record<string, number>;
		if (loc) {
			bot.spawnPoint = vec3(loc.x, loc.y, loc.z);
			bot.emit("spawnReset");
		}
	});
};
