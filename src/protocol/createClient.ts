/**
 * High-level client factory — creates a connected Minecraft client
 * with handshake, keepalive, and optional auth wired up.
 */

import { createHash } from "node:crypto";
import {
	type Client,
	type ClientOptions,
	connectClient,
	createProtocolClient,
} from "./client.js";
import { registerHandshake } from "./handshake.js";
import { registerKeepalive } from "./keepalive.js";

/** Create and connect a Minecraft client. */
export const createClient = (options: ClientOptions): Client => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25565;
	const auth = options.auth ?? "offline";
	const keepAlive = options.keepAlive ?? true;

	const client = createProtocolClient(options);

	// Offline mode: generate UUID from username
	if (auth === "offline") {
		client.uuid = offlineUUID(client.username);
	}

	// Register protocol handlers
	registerHandshake(client, {
		host,
		port,
		protocolVersion: client.protocolVersion,
		skipEncryption: auth === "offline",
	});

	if (keepAlive) {
		registerKeepalive(client);
	}

	// Connect
	connectClient(client, host, port);

	return client;
};

/** Generate an offline-mode UUID from a username (consistent with Minecraft's algorithm). */
const offlineUUID = (username: string): string => {
	const hash = createHash("md5").update(`OfflinePlayer:${username}`).digest();
	// Set version 3 (name-based, MD5)
	hash[6] = (hash[6] & 0x0f) | 0x30;
	// Set variant (RFC 4122)
	hash[8] = (hash[8] & 0x3f) | 0x80;
	const hex = hash.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
