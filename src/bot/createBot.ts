/**
 * Bot factory — creates a connected Minecraft bot.
 */

import { EventEmitter } from "node:events";
import { createEntity } from "../entity/index.js";
import { type Client, createClient } from "../protocol/index.js";
import { createRegistry } from "../registry/index.js";
import { type Vec3, ZERO } from "../vec3/index.js";
import { initBlocks } from "./blocks.js";
import { initChat } from "./chat.js";
import { initContainers } from "./containers.js";
import { initCrafting } from "./crafting.js";
import { initDigging } from "./digging.js";
import { initEntities } from "./entities.js";
import { initExtended } from "./extended.js";
import { initGame } from "./game.js";
import { initInventory } from "./inventory.js";
import { initPhysics } from "./physics.js";
import { initPlacing } from "./placing.js";
import { initSocial } from "./social.js";
import { initStatus } from "./status.js";
import type {
	Bot,
	BotOptions,
	ControlState,
	GameSettings,
	MainHand,
} from "./types.js";
import { initWorldState } from "./world_state.js";

/** Create and connect a Minecraft bot. */
export const createBot = (options: BotOptions): Bot => {
	const client: Client =
		(options as unknown as { client?: Client }).client ?? createClient(options);

	const emitter = new EventEmitter();

	// Default settings
	const settings: GameSettings = {
		chat: options.chat ?? "enabled",
		colorsEnabled: options.colorsEnabled ?? true,
		viewDistance: options.viewDistance ?? "far",
		difficulty: options.difficulty ?? 2,
		skinParts: options.skinParts ?? {
			showCape: true,
			showJacket: true,
			showLeftSleeve: true,
			showRightSleeve: true,
			showLeftPants: true,
			showRightPants: true,
			showHat: true,
		},
		mainHand: (options.mainHand ?? "right") as MainHand,
	};

	const bot = Object.assign(emitter, {
		// Identity
		client,
		registry: null,
		username: options.username,
		version: options.version,
		majorVersion: "",
		protocolVersion: client.protocolVersion,
		supportFeature: (_f: string) => false,

		// Self
		entity: createEntity(0),
		player: {
			uuid: "",
			username: options.username,
			displayName: null,
			gamemode: 0,
			ping: 0,
			entity: null,
			skinData: null,
		},

		// Game state
		game: {
			levelType: "default",
			gameMode: "survival" as const,
			hardcore: false,
			dimension: "overworld",
			difficulty: "normal" as const,
			maxPlayers: 0,
			serverBrand: "",
			minY: 0,
			height: 256,
		},
		isRaining: false,
		thunderState: 0,
		spawnPoint: { ...ZERO } as Vec3,
		time: {
			doDaylightCycle: true,
			bigTime: 0n,
			time: 0,
			timeOfDay: 0,
			day: 0,
			isDay: true,
			moonPhase: 0,
			bigAge: 0n,
			age: 0,
		},

		// Entities
		entities: {} as Record<number, never>,
		players: {} as Record<string, never>,
		uuidToUsername: {} as Record<string, string>,
		fireworkRocketDuration: 0,

		// World
		world: null,

		// Physics
		physics: null,
		physicsEnabled: options.physicsEnabled ?? true,
		controlState: {
			forward: false,
			back: false,
			left: false,
			right: false,
			jump: false,
			sprint: false,
			sneak: false,
		},

		// Inventory (placeholder — initInventory replaces)
		inventory: null as never,
		currentWindow: null,
		heldItem: null,
		usingHeldItem: false,
		quickBarSlot: 0,

		// Status
		health: 20,
		food: 20,
		foodSaturation: 5,
		oxygenLevel: 20,
		experience: { level: 0, points: 0, progress: 0 },

		// Combat state
		isSleeping: false,
		targetDigBlock: null,
		lastDigTime: 0,

		// Chat
		chatPatterns: [],
		settings,

		// Social
		scoreboards: {},
		scoreboard: {},
		teams: {},
		teamMap: {},
		bossBars: {},
		tablist: { header: null, footer: null },

		// Lifecycle
		end: (reason?: string) => client.end(reason),
		quit: (reason?: string) => client.end(reason ?? "disconnect.quitting"),
		respawn: () => {},

		// Stubs — filled by init functions
		setControlState: (_c: ControlState, _s: boolean) => {},
		getControlState: (_c: ControlState) => false,
		clearControlStates: () => {},
		look: async (_y: number, _p: number, _f?: boolean) => {},
		lookAt: async (_pt: Vec3, _f?: boolean) => {},
		elytraFly: async () => {},
		waitForTicks: async (_n: number) => {},
		chat: (_m: string) => {},
		whisper: (_u: string, _m: string) => {},
		tabComplete: async () => [] as string[],
		chatAddPattern: () => 0,
		clickWindow: async () => {},
		putSelectedItemRange: async () => {},
		putAway: async () => {},
		closeWindow: () => {},
		transfer: async () => {},
		openBlock: async () => null as never,
		openEntity: async () => null as never,
		moveSlotItem: async () => {},
		setQuickBarSlot: () => {},
		updateHeldItem: () => {},
		activateItem: () => {},
		deactivateItem: () => {},
		consume: async () => {},
		equip: async () => {},
		unequip: async () => {},
		tossStack: async () => {},
		toss: async () => {},
		blockAt: () => null,
		findBlock: () => null,
		findBlocks: () => [],
		canSeeBlock: () => false,
		waitForChunksToLoad: async () => {},
		dig: async () => {},
		stopDigging: () => {},
		canDigBlock: () => false,
		digTime: () => 0,
		placeBlock: async () => {},
		placeEntity: async () => null as never,
		activateBlock: async () => {},
		attack: () => {},
		swingArm: () => {},
		useOn: () => {},
		mount: () => {},
		dismount: () => {},
		moveVehicle: () => {},
		nearestEntity: () => null,
		recipesFor: () => [],
		recipesAll: () => [],
		craft: async () => {},
		sleep: async () => {},
		wake: async () => {},
		fish: async () => {},
		setSettings: () => {},
		blockAtCursor: () => null,
		acceptResourcePack: () => {},
		denyResourcePack: () => {},
		setCommandBlock: () => {},
		openChest: async () => null as never,
		openFurnace: async () => null as never,
		openAnvil: async () => null as never,
		openEnchantmentTable: async () => null as never,
		openVillager: async () => null as never,
		creative: {
			setInventorySlot: async () => {},
			clearSlot: async () => {},
			clearInventory: async () => {},
			flyTo: async () => {},
			startFlying: () => {},
			stopFlying: () => {},
		},
	}) as unknown as Bot;

	// Wire client events to bot
	client.on("error", (err: Error) => {
		if (!options.hideErrors) bot.emit("error", err);
	});
	client.on("end", (reason: string) => bot.emit("end", reason));
	client.on("connect", () => bot.emit("connect"));

	// On login, set registry and version info
	bot.on("login", () => {
		const version = client.version;
		const registry = createRegistry(version);
		bot.registry = registry;
		bot.version = registry.version.minecraftVersion;
		bot.majorVersion = registry.version.majorVersion;
		bot.protocolVersion = registry.version.version;
		bot.supportFeature = (f: string) => !!registry.supportFeature(f);
	});

	// Kick handling
	client.on("kick_disconnect", (packet: Record<string, unknown>) => {
		bot.emit("kicked", packet.reason as string, true);
	});
	client.on("disconnect", (packet: Record<string, unknown>) => {
		bot.emit("kicked", packet.reason as string, false);
	});

	// Initialize all subsystems
	initGame(bot, options);
	initEntities(bot, options);
	initBlocks(bot, options);
	initPhysics(bot, options);
	initStatus(bot, options);
	initInventory(bot, options);
	initChat(bot, options);
	initCrafting(bot, options);
	initDigging(bot, options);
	initPlacing(bot, options);
	initWorldState(bot, options);
	initSocial(bot, options);
	initExtended(bot, options);
	initContainers(bot, options);

	return bot;
};
