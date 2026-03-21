/**
 * Auto-version detection — pings the server to discover its protocol version,
 * then invokes autoVersionHooks so external modules (e.g. Forge/FML) can react.
 */

import MinecraftData from "minecraft-data";
import type { Client, ClientOptions } from "./client.ts";
import { ping } from "./ping.ts";

/** Ping the target server and configure the client to match its version. */
export const autoVersion = async (
	client: Client,
	options: ClientOptions,
): Promise<void> => {
	const host = options.host ?? "localhost";
	const port = options.port ?? 25565;

	const response = await ping({ host, port, version: options.version });

	const protocolVersion = response.version.protocol;
	const brandedName = response.version.name;

	// Try to resolve a known minecraft-data version from the ping response
	const byProtocol =
		(MinecraftData as unknown as Record<string, Record<string, Record<string, { minecraftVersion: string }[]>>>)
			.postNettyVersionsByProtocolVersion?.pc?.[protocolVersion] ?? [];
	const byName =
		(MinecraftData as unknown as Record<string, Record<string, Record<string, { minecraftVersion: string }>>>)
			.versionsByMinecraftVersion?.pc?.[brandedName];

	const versions = [...byProtocol, ...(byName ? [byName] : [])];
	if (versions.length === 0) {
		throw new Error(
			`Unsupported protocol version '${protocolVersion}' (server: ${brandedName})`,
		);
	}

	// Invoke hooks so external modules (e.g. Forge/FML) can respond to the ping
	for (const hook of client.autoVersionHooks) {
		hook(response, client, options);
	}
};
