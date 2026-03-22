# typecraft
A modern TypeScript SDK for Minecraft — bots, worlds, and protocols

## Setup

Requires [Nix](https://nixos.org/).

```bash
# Generate game data (blocks, items, textures, protocol, etc.)
nix run .#datagen

# Run tests
npm test
```

The datagen extracts all data directly from the Minecraft server and client JARs (fetched from Mojang) — no third-party data dependencies. Takes ~27 seconds, outputs to `src/data/`.
