/**
 * Protocol schema builder — assembles the complete ProtoDef schema from:
 * 1. Shared type definitions (shared-types.ts, hand-written from protocol spec)
 * 2. Packet field definitions (packet-defs.ts, written from protocol spec)
 * 3. Packet IDs (src/data/packets-raw.json, from server --reports)
 *
 * Uses Mojang packet names throughout (matching datagen extraction).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKET_DEFS } from "./packet-defs.ts";
import { SHARED_TYPES } from "./shared-types.ts";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");

type PacketsRaw = Record<
	string,
	Record<string, Record<string, { protocol_id: number }>>
>;

const DIRECTION_MAP: Record<string, string> = {
	clientbound: "toClient",
	serverbound: "toServer",
};

const STATE_MAP: Record<string, string> = {
	handshake: "handshaking",
	status: "status",
	login: "login",
	configuration: "configuration",
	play: "play",
};

type ProtocolSchema = {
	readonly protocol: Record<string, unknown>;
	readonly version: {
		readonly type: string;
		readonly majorVersion: string;
		readonly version: number;
		readonly minecraftVersion: string;
	};
};

let cached: ProtocolSchema | null = null;

/** Build the complete ProtoDef protocol schema. Result is cached. */
export const buildProtocol = (): ProtocolSchema => {
	if (cached) return cached;

	const packetsRaw = JSON.parse(
		readFileSync(join(DATA_DIR, "packets-raw.json"), "utf8"),
	) as PacketsRaw;

	const protocol: Record<string, unknown> = {
		types: { ...SHARED_TYPES },
	};

	for (const [rawState, rawDirs] of Object.entries(packetsRaw)) {
		const state = STATE_MAP[rawState];
		if (!state) continue;

		const stateObj: Record<string, unknown> = {};

		for (const [rawDir, packets] of Object.entries(rawDirs)) {
			const dir = DIRECTION_MAP[rawDir];
			if (!dir) continue;

			const mappings: Record<string, string> = {};
			const switchFields: Record<string, string> = {};
			const types: Record<string, unknown> = {};

			for (const [fullName, info] of Object.entries(packets)) {
				const name = fullName.replace("minecraft:", "");
				const hexId = `0x${info.protocol_id.toString(16).padStart(2, "0")}`;

				mappings[hexId] = name;
				switchFields[name] = `packet_${name}`;

				const defKey = `${state}.${dir}.packet_${name}`;
				types[`packet_${name}`] = PACKET_DEFS[defKey] ??
					SHARED_TYPES[`packet_common_${name}`] ?? ["container", []];
			}

			types.packet = [
				"container",
				[
					{
						name: "name",
						type: ["mapper", { type: "varint", mappings }],
					},
					{
						name: "params",
						type: ["switch", { compareTo: "name", fields: switchFields }],
					},
				],
			];

			stateObj[dir] = { types };
		}

		protocol[state] = stateObj;
	}

	// Handshaking — always present, stable across versions
	if (!protocol.handshaking) {
		protocol.handshaking = {
			toClient: { types: {} },
			toServer: {
				types: {
					packet_intention: PACKET_DEFS[
						"handshaking.toServer.packet_intention"
					] ?? [
						"container",
						[
							{ name: "protocolVersion", type: "varint" },
							{ name: "serverHost", type: "string" },
							{ name: "serverPort", type: "u16" },
							{ name: "nextState", type: "varint" },
						],
					],
					packet_legacy_server_list_ping: PACKET_DEFS[
						"handshaking.toServer.packet_legacy_server_list_ping"
					] ?? ["container", [{ name: "payload", type: "u8" }]],
					packet: [
						"container",
						[
							{
								name: "name",
								type: [
									"mapper",
									{
										type: "varint",
										mappings: {
											"0x00": "intention",
											"0xfe": "legacy_server_list_ping",
										},
									},
								],
							},
							{
								name: "params",
								type: [
									"switch",
									{
										compareTo: "name",
										fields: {
											intention: "packet_intention",
											legacy_server_list_ping: "packet_legacy_server_list_ping",
										},
									},
								],
							},
						],
					],
				},
			},
		};
	}

	cached = {
		protocol,
		version: {
			type: "pc",
			majorVersion: "1.21",
			version: 774,
			minecraftVersion: "1.21.11",
		},
	};

	return cached;
};
