/**
 * Chat messaging — send/receive chat, whisper, tab complete.
 * Uses src/chat/ for message parsing.
 */

import {
	type ChatMessage,
	chatToString,
	parseChatMessage,
	processNbtMessage,
} from "../chat/index.ts";
import type { Bot, BotOptions } from "./types.ts";

/** Check if a value looks like an NBT compound (has type/value fields). */
const isNbt = (v: unknown): boolean =>
	v != null &&
	typeof v === "object" &&
	"type" in (v as Record<string, unknown>) &&
	"value" in (v as Record<string, unknown>);

export const initChat = (bot: Bot, options: BotOptions): void => {
	const chatLengthLimit = options.chatLengthLimit ?? 256;

	// ── Receive chat ──

	const handleChatMessage = (jsonMsg: ChatMessage, position: string) => {
		const text = chatToString(jsonMsg);
		bot.emit("message", jsonMsg, position);
		bot.emit("messagestr", text, position, jsonMsg);

		// Match against chat patterns
		let matched = false;
		for (const pattern of bot.chatPatterns) {
			const matches = text.match(pattern.pattern);
			if (matches) {
				matched = true;
				if (pattern.type === "chat") {
					bot.emit(
						"chat",
						matches[1] ?? "",
						matches[2] ?? text,
						null,
						jsonMsg,
						matches.slice(1),
					);
				} else if (pattern.type === "whisper") {
					bot.emit(
						"whisper",
						matches[1] ?? "",
						matches[2] ?? text,
						null,
						jsonMsg,
						matches.slice(1),
					);
				}
			}
		}

		if (!matched) {
			bot.emit("unmatchedMessage", text, jsonMsg);
		}
	};

	bot.client.on("chat", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const message = packet.message as string;
		const position = String(packet.position ?? "chat");
		try {
			const jsonMsg = parseChatMessage(JSON.parse(message));
			if (position === "2") {
				bot.emit("actionBar", jsonMsg);
			} else {
				handleChatMessage(jsonMsg, position);
			}
		} catch {
			// Ignore parse errors
		}
	});

	bot.client.on("system_chat", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const content = packet.content as string;
		const isActionBar = packet.isActionBar as boolean;
		try {
			const jsonMsg = parseChatMessage(
				typeof content === "string" ? JSON.parse(content) : content,
			);
			if (isActionBar) {
				bot.emit("actionBar", jsonMsg);
			} else {
				handleChatMessage(jsonMsg, "system");
			}
		} catch {
			// Ignore parse errors
		}
	});

	bot.client.on("profileless_chat", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		const content = packet.content ?? packet.message;
		try {
			const jsonMsg = parseChatMessage(
				typeof content === "string" ? JSON.parse(content as string) : content,
			);
			handleChatMessage(jsonMsg, "chat");
		} catch {
			// Ignore parse errors
		}
	});

	// 1.19.1+ player chat (signed messages)
	bot.client.on("player_chat", (packet: Record<string, unknown>) => {
		if (!bot.registry) return;
		try {
			// Prefer formatted content, fall back to plain message
			const unsigned = packet.unsignedChatContent;
			const plain = packet.plainMessage as string | undefined;

			let jsonMsg: ChatMessage;
			if (unsigned != null) {
				// May be JSON string, parsed JSON, or NBT compound
				const normalized = isNbt(unsigned)
					? processNbtMessage(unsigned)
					: typeof unsigned === "string"
						? JSON.parse(unsigned)
						: unsigned;
				jsonMsg = parseChatMessage(normalized ?? { text: plain ?? "" });
			} else if (plain) {
				jsonMsg = parseChatMessage({ text: plain });
			} else {
				return;
			}

			// Extract sender name — may be JSON string or NBT compound
			const networkName = packet.networkName;
			let senderName: string | undefined;
			if (networkName != null) {
				const normalized = isNbt(networkName)
					? processNbtMessage(networkName)
					: typeof networkName === "string"
						? JSON.parse(networkName)
						: networkName;
				senderName = chatToString(parseChatMessage(normalized ?? ""));
			}

			if (senderName && plain) {
				// Emit directly as chat event with known sender
				bot.emit("chat", senderName, plain, null, jsonMsg, null);
				bot.emit("message", jsonMsg, "chat");
				bot.emit("messagestr", `<${senderName}> ${plain}`, "chat", jsonMsg);
			} else {
				handleChatMessage(jsonMsg, "chat");
			}
		} catch {
			// Ignore parse errors
		}
	});

	// ── Default chat patterns ──

	if (options.defaultChatPatterns !== false) {
		bot.chatPatterns.push(
			{
				pattern: /^<(\S+)>\s(.+)$/,
				type: "chat",
				description: "vanilla chat",
			},
			{
				pattern: /^(\S+) whispers to you: (.+)$/,
				type: "whisper",
				description: "vanilla whisper",
			},
		);
	}

	// ── Send chat ──

	bot.chat = (message: string) => {
		// Split long messages
		const chunks: string[] = [];
		for (let i = 0; i < message.length; i += chatLengthLimit) {
			chunks.push(message.slice(i, i + chatLengthLimit));
		}
		for (const chunk of chunks) {
			if (chunk.startsWith("/")) {
				// Commands use chat_command (1.19+) or chat (legacy)
				if (bot.protocolVersion >= 759) {
					bot.client.write("chat_command", {
						command: chunk.slice(1),
					});
				} else {
					bot.client.write("chat", { message: chunk });
				}
			} else if (bot.protocolVersion >= 759) {
				// 1.19+ uses chat_message with signing fields
				bot.client.write("chat_message", {
					message: chunk,
					timestamp: BigInt(Date.now()),
					salt: 0n,
					signature: undefined,
					offset: 0,
					acknowledged: Buffer.alloc(3),
					checksum: 0,
				});
			} else {
				bot.client.write("chat", { message: chunk });
			}
		}
	};

	bot.whisper = (username: string, message: string) => {
		bot.chat(`/tell ${username} ${message}`);
	};

	// ── Tab complete ──

	bot.tabComplete = async (
		str: string,
		assumeCommand?: boolean,
		_sendBlockInSight?: boolean,
		timeout?: number,
	): Promise<string[]> => {
		const transactionId = Math.floor(Math.random() * 0x7fffffff);

		bot.client.write("tab_complete", {
			text: str,
			assumeCommand: assumeCommand ?? false,
			transactionId,
		});

		return new Promise<string[]>((resolve) => {
			const onComplete = (packet: Record<string, unknown>) => {
				if (
					(packet.transactionId as number) === transactionId ||
					packet.transactionId == null
				) {
					bot.client.removeListener("tab_complete", onComplete);
					const matches = packet.matches as
						| string[]
						| Array<Record<string, string>>;
					if (Array.isArray(matches)) {
						resolve(
							matches.map((m) => (typeof m === "string" ? m : (m.match ?? ""))),
						);
					} else {
						resolve([]);
					}
				}
			};
			bot.client.on("tab_complete", onComplete);
			setTimeout(() => {
				bot.client.removeListener("tab_complete", onComplete);
				resolve([]);
			}, timeout ?? 5000);
		});
	};

	// ── Chat pattern management ──

	bot.chatAddPattern = (
		pattern: RegExp,
		chatType: string,
		description?: string,
	): number =>
		bot.chatPatterns.push({
			pattern,
			type: chatType,
			description: description ?? "",
		}) - 1;
};
