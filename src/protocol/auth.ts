/**
 * Microsoft authentication via prismarine-auth + Mojang session server join.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

// ── Minecraft server hash (mcHexDigest) ──

/**
 * Compute Minecraft's authentication server hash.
 * SHA1(serverId + sharedSecret + serverPublicKey), formatted as
 * a signed hex digest (two's complement for negative values).
 */
export const mcServerHash = (
	serverId: string,
	sharedSecret: Buffer,
	publicKey: Buffer,
): string => {
	const hash = createHash("sha1");
	hash.update(serverId, "ascii");
	hash.update(sharedSecret);
	hash.update(publicKey);
	const digest = hash.digest();
	return mcHexDigest(digest);
};

/** Format a SHA1 digest as Minecraft's signed hex string. */
const mcHexDigest = (digest: Buffer): string => {
	const negative = (digest[0] & 0x80) !== 0;
	if (negative) {
		// Two's complement: invert all bits, add 1
		let carry = true;
		for (let i = digest.length - 1; i >= 0; i--) {
			digest[i] = ~digest[i] & 0xff;
			if (carry) {
				carry = digest[i] === 0xff;
				digest[i] = (digest[i] + 1) & 0xff;
			}
		}
		return `-${digest.toString("hex").replace(/^0+/, "")}`;
	}
	return digest.toString("hex").replace(/^0+/, "");
};

// ── Session server join ──

const SESSION_SERVER = "https://sessionserver.mojang.com";

/** Notify Mojang that this client is joining a server (online mode). */
export const joinServer = async (
	accessToken: string,
	profileId: string,
	serverId: string,
	sharedSecret: Buffer,
	publicKey: Buffer,
): Promise<void> => {
	const hash = mcServerHash(serverId, sharedSecret, publicKey);
	const response = await fetch(`${SESSION_SERVER}/session/minecraft/join`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			accessToken,
			selectedProfile: profileId.replace(/-/g, ""),
			serverId: hash,
		}),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Session server join failed (${response.status}): ${text}`);
	}
};

// ── Microsoft auth flow ──

export type AuthResult = {
	readonly accessToken: string;
	readonly username: string;
	readonly uuid: string;
};

/**
 * Authenticate with Microsoft via prismarine-auth.
 * Returns access token, username, and UUID from the Minecraft profile.
 */
export const authenticateMicrosoft = async (options: {
	readonly username: string;
	readonly profilesFolder?: string;
	readonly onMsaCode?: (data: {
		user_code: string;
		verification_uri: string;
	}) => void;
}): Promise<AuthResult> => {
	// Dynamic import — prismarine-auth is CJS
	const { Authflow, Titles } = await import("prismarine-auth");

	const cacheDir =
		options.profilesFolder ??
		join(process.env.HOME ?? ".", ".minecraft", "typecraft-cache");

	const authflow = new Authflow(
		options.username,
		cacheDir,
		{
			flow: "live",
			authTitle: Titles.MinecraftNintendoSwitch,
		},
		options.onMsaCode,
	);

	const { token, profile } = await authflow.getMinecraftJavaToken({
		fetchProfile: true,
	});

	if (!profile || (profile as unknown as Record<string, unknown>).error) {
		throw new Error(
			`Failed to obtain Minecraft profile for ${options.username}. Does this account own Minecraft?`,
		);
	}

	const prof = profile as { id: string; name: string };
	const uuid = prof.id.replace(
		/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
		"$1-$2-$3-$4-$5",
	);

	return {
		accessToken: token,
		username: prof.name,
		uuid,
	};
};
