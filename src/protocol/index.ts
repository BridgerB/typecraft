export type { AuthResult } from "./auth.js";
export { authenticateMicrosoft, joinServer, mcServerHash } from "./auth.js";
export type { Client, ClientOptions, PacketMeta } from "./client.js";
export { connectClient, createProtocolClient } from "./client.js";
export type {
	PacketCodec,
	ReadResult,
	TypeDef,
	TypeRegistry,
} from "./codec.js";
export {
	createPacketCodec,
	createTypeRegistry,
} from "./codec.js";
export { compressPacket, decompressPacket } from "./compression.js";
export { createClient } from "./createClient.js";
export { resolveServer } from "./dns.js";
export { createDecryptor, createEncryptor } from "./encryption.js";
export { createSplitter, framePacket } from "./framing.js";
export { registerHandshake } from "./handshake.js";
export { registerKeepalive } from "./keepalive.js";
export type { PingOptions, PingResponse } from "./ping.js";
export { ping } from "./ping.js";
export { Direction, ProtocolState } from "./states.js";
export {
	readVarInt,
	readVarLong,
	sizeOfVarInt,
	sizeOfVarLong,
	writeVarInt,
	writeVarLong,
} from "./varint.js";
