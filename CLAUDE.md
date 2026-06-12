# CLAUDE.md — typecraft

A TypeScript SDK for Minecraft (bots, worlds, protocol). Consumed by sibling
projects such as `steve` via `"typecraft": "file:../typecraft"`.

## Runs as TypeScript — there is no build and no `dist/`

Node executes the `.ts` source **directly** — current Node runs TypeScript with
no flags and no transpile step. The package entry points (`main`, `types`,
`exports`) all resolve to `./src/index.ts`, and consumers import that source
as-is. There is intentionally **no build step and no `dist/` output**.

What this means in practice:

- Edit a `.ts` file and run — the change is live immediately. Never "compile",
  "rebuild", or create a `dist/`, and never reason about a src-vs-dist split.
- Type-check with `npm run typecheck` (`tsc --noEmit`); it only reports errors,
  it never emits. `tsconfig.json` is `noEmit: true` for exactly this reason.
- Relative imports carry explicit `.ts` extensions; Node resolves them and
  `rewriteRelativeImportExtensions` keeps the type-checker happy.
- `npm run build:web` is unrelated to the library — it bundles the browser
  world-viewer with esbuild.

If you ever see an `outDir`, `declaration`, a `tsc` build script, or a `dist/`
path reappear, that is the old emit pipeline creeping back — strip it out.

## Protocol / codec notes

Packet definitions live in `src/protocol/`: `packet-defs.ts` maps each packet to
its field list, `shared-types.ts` holds reusable schemas, `generated-mappings.json`
holds enum index→name tables, and `codec.ts` reads/writes them.

Entity metadata (`set_entity_data`) is an `entityMetadataLoop` of
`{ key: u8, type: varint→name, value: switch(type) }`, terminated by key `0xFF`.
The `entityMetadataType` index table **must match the server's registry order
exactly** — a single missing or extra entry shifts every later type, so values
are read with the wrong byte count and the stream desyncs (manifesting as
`offset is out of range` and a dropped connection). When the game version adds a
metadata serializer, add it at the correct index in both the mapping table and
the `entityMetadataEntry` value switch.
