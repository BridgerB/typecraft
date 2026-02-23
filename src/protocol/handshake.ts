/**
 * Handshake + login flow — sends set_protocol, login_start, and handles
 * login success / configuration state transitions.
 */

import { publicEncrypt, randomBytes } from "node:crypto";
import type { Client } from "./client.js";
import { ProtocolState } from "./states.js";

/** Wire up the login handshake flow for a client. */
export const registerHandshake = (
	client: Client,
	options: {
		readonly host: string;
		readonly port: number;
		readonly protocolVersion: number;
		readonly skipEncryption?: boolean;
	},
) => {
	// ── Step 1: On connect, send handshake + login_start ──

	client.on("connect", () => {
		// Send set_protocol (handshake)
		client.write("set_protocol", {
			protocolVersion: options.protocolVersion,
			serverHost: options.host,
			serverPort: options.port,
			nextState: 2, // LOGIN
		});

		// Transition to LOGIN state
		client.state = ProtocolState.LOGIN;

		// Send login_start
		client.write("login_start", {
			username: client.username,
			playerUUID: client.uuid || "0".repeat(32),
		});
	});

	// ── Step 2: Handle encryption request (online mode) ──

	if (!options.skipEncryption) {
		client.on("encryption_begin", (packet: Record<string, unknown>) => {
			handleEncryption(client, packet);
		});
	}

	// ── Step 3: Handle compression ──

	client.on("compress", (packet: Record<string, unknown>) => {
		client.setCompressionThreshold(packet.threshold as number);
	});

	// ── Step 4: Handle login success → CONFIGURATION or PLAY ──

	client.on("success", (packet: Record<string, unknown>) => {
		client.uuid = packet.uuid as string;
		client.username = packet.username as string;

		// 1.20.2+ uses CONFIGURATION state between LOGIN and PLAY
		if (hasConfigurationState(client.protocolVersion)) {
			client.write("login_acknowledged", {});
			client.state = ProtocolState.CONFIGURATION;
			registerConfigurationHandlers(client);
		} else {
			client.state = ProtocolState.PLAY;
			client.emit("login");
		}
	});
};

// ── Configuration state (1.20.2+) ──

const registerConfigurationHandlers = (client: Client) => {
	const onFinishConfig = () => {
		client.write("finish_configuration", {});
		client.state = ProtocolState.PLAY;
		client.emit("login");

		// Clean up config listeners
		client.removeListener("finish_configuration", onFinishConfig);
		client.removeListener("select_known_packs", onSelectKnownPacks);

		// Support re-entering configuration from PLAY
		client.on("start_configuration", () => {
			client.write("configuration_acknowledged", {});
			client.state = ProtocolState.CONFIGURATION;
			registerConfigurationHandlers(client);
		});
	};

	const onSelectKnownPacks = (_packet: Record<string, unknown>) => {
		// Respond with empty packs — let server send all data
		client.write("select_known_packs", { packs: [] });
	};

	client.on("finish_configuration", onFinishConfig);
	client.on("select_known_packs", onSelectKnownPacks);

	// Handle registry data, feature flags, etc — just acknowledge
	client.on("registry_data", () => {});
};

// ── Encryption handshake ──

const handleEncryption = (client: Client, packet: Record<string, unknown>) => {
	const serverPublicKey = packet.publicKey as Buffer;
	const verifyToken = packet.verifyToken as Buffer;

	// Generate 16-byte shared secret
	const sharedSecret = randomBytes(16);

	// RSA encrypt with server's public key (PKCS#1 v1.5)
	const encryptedSecret = publicEncrypt(
		{ key: serverPublicKey, padding: 1 }, // RSA_PKCS1_PADDING
		sharedSecret,
	);

	const encryptedToken = publicEncrypt(
		{ key: serverPublicKey, padding: 1 },
		verifyToken,
	);

	// Send encryption response
	client.write("encryption_begin", {
		sharedSecret: encryptedSecret,
		verifyToken: encryptedToken,
	});

	// Enable encryption
	client.setEncryption(sharedSecret);
};

// ── Version checks ──

/** 1.20.2+ (protocol version 764+) uses the CONFIGURATION state. */
const hasConfigurationState = (protocolVersion: number): boolean =>
	protocolVersion >= 764;
