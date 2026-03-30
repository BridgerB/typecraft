/**
 * Generate protocol type mappings from PrismarineJS proto.yml.
 *
 * Fetches the latest proto.yml for a given Minecraft version, extracts all
 * enum/mapper definitions, and writes them to a JSON file that shared-types.ts
 * imports. This eliminates hand-maintained ID mappings that drift between versions.
 *
 * Usage:
 *   node scripts/gen-protocol-types.ts              # uses "latest"
 *   node scripts/gen-protocol-types.ts 1.21.11      # specific version
 *
 * Output: src/protocol/generated-mappings.json
 */

const version = process.argv[2] ?? "latest";
const url = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/${version}/proto.yml`;

console.log(`Fetching proto.yml for ${version}...`);
const res = await fetch(url);
if (!res.ok) {
	console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
	process.exit(1);
}
const yaml = await res.text();
console.log(`Got ${yaml.length} bytes`);

// ── YAML subset parser ──
// proto.yml uses a simple subset: indented key-value, lists with "- item",
// and "varint =>" for mapper definitions. We only need to extract mappers.

type Mapper = Record<string, string>;

const extractMappers = (text: string): Record<string, Mapper> => {
	const mappers: Record<string, Mapper> = {};
	const lines = text.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;

		// Match "   name: varint =>" or "   name: u8 =>" (mapper start)
		const mapperMatch = line.match(
			/^(\s+)(\w[\w/]*)\s*:\s*(?:varint|u8|i8)\s*=>\s*$/,
		);
		if (!mapperMatch) continue;

		const [, baseIndent, name] = mapperMatch;
		const mapper: Mapper = {};
		const childIndent = baseIndent!.length + 3; // proto.yml uses 3-space indent
		let idx = 0;

		for (let j = i + 1; j < lines.length; j++) {
			const child = lines[j]!;
			if (child.trim() === "" || child.trim().startsWith("#")) continue;

			// Check indentation — stop if we're back at or above the mapper level
			const stripped = child.replace(/^ +/, "");
			const indent = child.length - stripped.length;
			if (indent <= baseIndent!.length) break;

			// List item: "- value_name" (auto-indexed)
			const listMatch = child.match(/^\s+-\s+(\S+)\s*$/);
			if (listMatch) {
				mapper[String(idx)] = listMatch[1]!;
				idx++;
				continue;
			}

			// Explicit key: "0: value_name"
			const kvMatch = child.match(/^\s+(\d+)\s*:\s*(\S+)\s*$/);
			if (kvMatch) {
				const id = parseInt(kvMatch[1]!, 10);
				mapper[String(id)] = kvMatch[2]!;
				idx = id + 1;
				continue;
			}

			// If line has deeper content (sub-container), it's not a simple enum
			// Stop parsing this mapper
			if (indent > childIndent + 3) continue;
		}

		if (Object.keys(mapper).length > 0) {
			mappers[name!] = mapper;
		}
	}

	return mappers;
};

const mappers = extractMappers(yaml);

// Filter to the important mappers we care about
const important = [
	"SlotComponentType",
	"soundSource",
	// Particle type is nested inside Particle container, grab it separately
];

// Extract particle types specifically (nested inside Particle.type)
const extractParticleTypes = (text: string): Mapper | null => {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		// Find "Particle:" container, then "type: varint =>"
		if (line.match(/^\s+Particle:\s*$/)) {
			for (let j = i + 1; j < lines.length; j++) {
				const sub = lines[j]!;
				if (sub.match(/^\s+type:\s*varint\s*=>\s*$/)) {
					// Found it — extract like a regular mapper
					const mapper: Mapper = {};
					let idx = 0;
					for (let k = j + 1; k < lines.length; k++) {
						const entry = lines[k]!;
						if (entry.trim() === "" || entry.trim().startsWith("#")) continue;
						const listMatch = entry.match(/^\s+-\s+(\S+)\s*$/);
						if (listMatch) {
							mapper[String(idx)] = listMatch[1]!;
							idx++;
							continue;
						}
						const kvMatch = entry.match(/^\s+(\d+)\s*:\s*(\S+)\s*$/);
						if (kvMatch) {
							const id = parseInt(kvMatch[1]!, 10);
							mapper[String(id)] = kvMatch[2]!;
							idx = id + 1;
							continue;
						}
						// Non-list line = end of mapper
						if (!entry.match(/^\s+-/) && !entry.match(/^\s+\d+:/)) break;
					}
					return mapper;
				}
				// If we hit a non-indented line, stop
				if (sub.match(/^\s{0,5}\S/) && !sub.match(/^\s+type:/)) break;
			}
		}
	}
	return null;
};

// Extract entity metadata types (nested inside entityMetadataEntry.type)
const extractEntityMetadataTypes = (text: string): Mapper | null => {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.match(/^\s+entityMetadataEntry:\s*$/)) {
			for (let j = i + 1; j < lines.length; j++) {
				const sub = lines[j]!;
				if (sub.match(/^\s+type:\s*varint\s*=>\s*$/)) {
					const mapper: Mapper = {};
					let idx = 0;
					for (let k = j + 1; k < lines.length; k++) {
						const entry = lines[k]!;
						if (entry.trim() === "" || entry.trim().startsWith("#")) continue;
						const listMatch = entry.match(/^\s+-\s+(\S+)\s*$/);
						if (listMatch) {
							mapper[String(idx)] = listMatch[1]!;
							idx++;
							continue;
						}
						if (!entry.match(/^\s+-/)) break;
					}
					return mapper;
				}
				if (sub.match(/^\s{0,5}\S/) && !sub.match(/^\s+\w+:/)) break;
			}
		}
	}
	return null;
};

const particleTypes = extractParticleTypes(yaml);
const entityMetadataTypes = extractEntityMetadataTypes(yaml);

const output: Record<string, Mapper> = {};

// Add all top-level mappers
for (const [name, mapper] of Object.entries(mappers)) {
	output[name] = mapper;
}

// Add nested mappers
if (particleTypes) output.ParticleType = particleTypes;
if (entityMetadataTypes) output.entityMetadataType = entityMetadataTypes;

// Normalize: replace "/" with "_" in mapper values (proto.yml uses "wolf/variant"
// but our switch fields use "wolf_variant")
for (const mapper of Object.values(output)) {
	for (const [k, v] of Object.entries(mapper)) {
		mapper[k] = v.replace(/\//g, "_").replace("zomie_", "zombie_");
	}
}

// Write output
const { writeFileSync } = await import("node:fs");
const { join } = await import("node:path");

const outPath = join(
	import.meta.dirname!,
	"../src/protocol/generated-mappings.json",
);
writeFileSync(outPath, JSON.stringify(output, null, "\t") + "\n");

console.log(`\nWrote ${outPath}`);
console.log(`Mappers found: ${Object.keys(output).length}`);
for (const [name, mapper] of Object.entries(output)) {
	console.log(`  ${name}: ${Object.keys(mapper).length} entries`);
}
