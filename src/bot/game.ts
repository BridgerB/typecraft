/**
 * Game state initialization — game mode, difficulty, dimension, brand.
 * Handles login, respawn, game_state_change, difficulty, and brand packets.
 */

import type { Bot, BotOptions, Difficulty, GameMode } from "./types.js";

const DIFFICULTY_NAMES: readonly Difficulty[] = [
	"peaceful",
	"easy",
	"normal",
	"hard",
];
const GAME_MODES: readonly GameMode[] = [
	"survival",
	"creative",
	"adventure",
	"spectator",
];

const DIMENSION_NAMES: Record<string, string> = {
	"-1": "the_nether",
	"0": "overworld",
	"1": "the_end",
};

const parseGameMode = (bits: number): GameMode =>
	bits < 0 || bits > 0b11 ? "survival" : GAME_MODES[bits & 0b11]!;

export const initGame = (bot: Bot, options: BotOptions): void => {
	bot.game = {
		levelType: "default",
		gameMode: "survival",
		hardcore: false,
		dimension: "overworld",
		difficulty: "normal",
		maxPlayers: 0,
		serverBrand: "",
		minY: 0,
		height: 256,
	};

	const handleRespawnData = (packet: Record<string, unknown>) => {
		bot.game.levelType =
			(packet.levelType as string) ?? (packet.isFlat ? "flat" : "default");
		bot.game.hardcore =
			(packet.isHardcore as boolean) ??
			Boolean((packet.gameMode as number) & 0b100);

		if (bot.supportFeature("spawnRespawnWorldDataField")) {
			bot.game.gameMode = packet.gamemode as GameMode;
		} else {
			bot.game.gameMode = parseGameMode(
				(packet.gamemode ?? packet.gameMode) as number,
			);
		}

		// Dimension resolution (version-dependent)
		if (bot.supportFeature("dimensionIsAnInt")) {
			bot.game.dimension =
				DIMENSION_NAMES[String(packet.dimension)] ?? "overworld";
		} else if (
			bot.supportFeature("dimensionIsAString") ||
			bot.supportFeature("segmentedRegistryCodecData")
		) {
			bot.game.dimension = (packet.dimension as string).replace(
				"minecraft:",
				"",
			);
		} else if (bot.supportFeature("dimensionIsAWorld")) {
			bot.game.dimension = (packet.worldName as string).replace(
				"minecraft:",
				"",
			);
		}

		// World height
		bot.game.minY = 0;
		bot.game.height = 256;

		if (packet.difficulty != null) {
			bot.game.difficulty =
				DIFFICULTY_NAMES[packet.difficulty as number] ?? "normal";
		}
	};

	// Login packet
	bot.client.on("login", (packet: Record<string, unknown>) => {
		handleRespawnData((packet.worldState as Record<string, unknown>) ?? packet);
		bot.game.maxPlayers = (packet.maxPlayers as number) ?? 0;
		bot.emit("login");
		bot.emit("game");

		// Send brand
		bot.client.write("custom_payload", {
			channel: bot.supportFeature("customChannelMCPrefixed")
				? "MC|Brand"
				: "minecraft:brand",
			data: Buffer.from(options.brand ?? "vanilla"),
		});
	});

	// Respawn packet
	bot.client.on("respawn", (packet: Record<string, unknown>) => {
		handleRespawnData((packet.worldState as Record<string, unknown>) ?? packet);
		bot.emit("game");
	});

	// Game state change
	bot.client.on("game_state_change", (packet: Record<string, unknown>) => {
		const reason = packet.reason as number | string;

		// Win game — send respawn
		if ((reason === 4 || reason === "win_game") && packet.gameMode === 1) {
			bot.client.write("client_command", { action: 0 });
		}

		// Game mode change
		if (reason === 3 || reason === "change_game_mode") {
			bot.game.gameMode = parseGameMode(packet.gameMode as number);
			bot.emit("game");
		}
	});

	// Difficulty
	bot.client.on("difficulty", (packet: Record<string, unknown>) => {
		bot.game.difficulty =
			DIFFICULTY_NAMES[packet.difficulty as number] ?? "normal";
	});

	// Ping (anti-cheat compatibility)
	bot.client.on("ping", (packet: Record<string, unknown>) => {
		bot.client.write("pong", { id: packet.id });
	});
};
