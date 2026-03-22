{
  description = "Typecraft — modern TypeScript SDK for Minecraft";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    version = "1.21.11";

    serverJar = pkgs.fetchurl {
      url = "https://piston-data.mojang.com/v1/objects/64bb6d763bed0a9f1d632ec347938594144943ed/server.jar";
      sha256 = "09hpvmjnspf74k8ks9imcc3lqz8p3gjald3y3j9nz035704qwfzq";
    };

    clientJar = pkgs.fetchurl {
      url = "https://piston-data.mojang.com/v1/objects/ba2df812c2d12e0219c489c4cd9a5e1f0760f5bd/client.jar";
      sha256 = "1gfkdil6nxfqm5dpzchdc6w106nnf1mafjah8cydl3y5k94cjwql";
    };

    # Build the Fabric datagen mod, then run it headlessly to extract data
    runDatagen = pkgs.writeShellScriptBin "datagen" ''
      set -euo pipefail
      PROJ_DIR="''${PROJ_DIR:-$(pwd)}"
      MOD_DIR="$PROJ_DIR/datagen/mod"
      OUT_DIR="$PROJ_DIR/src/data"

      echo "=== Typecraft Data Generator ==="
      echo "Minecraft ${version}"
      echo ""

      # Step 1: Build the Fabric mod
      echo "Building Fabric mod..."
      cd "$MOD_DIR"
      ${pkgs.gradle}/bin/gradle build --no-daemon --quiet 2>&1 | tail -5
      MOD_JAR=$(find build/libs -name "*.jar" ! -name "*-sources.jar" | head -1)
      if [ -z "$MOD_JAR" ]; then
        echo "ERROR: Mod JAR not found after build"
        exit 1
      fi
      echo "Built: $MOD_JAR"
      cd "$PROJ_DIR"

      # Step 2: Run Fabric server with our mod via Gradle runServer
      echo ""
      echo "Running Fabric server with datagen mod..."
      cd "$MOD_DIR"

      # Accept EULA for the server
      mkdir -p run
      echo "eula=true" > run/eula.txt

      # Run the modded server — our mod extracts data then calls System.exit(0)
      ${pkgs.gradle}/bin/gradle runServer --no-daemon 2>&1 | grep -E "typecraft-datagen|ERROR|Starting|Done" || true

      # Check output
      if [ ! -d "run/typecraft-data" ]; then
        echo "ERROR: No data output directory found"
        echo "Check run/ for server logs"
        ls -la run/
        exit 1
      fi
      WORK_DIR="$MOD_DIR/run"

      # Step 3: Also run vanilla --reports for recipes/tags/etc
      echo ""
      echo "Running vanilla data generator..."
      REPORTS_DIR=$(mktemp -d)
      cd "$REPORTS_DIR"
      ${pkgs.jre}/bin/java \
        -DbundlerMainClass=net.minecraft.data.Main \
        -jar ${serverJar} \
        --reports --server \
        --output "$REPORTS_DIR/output" 2>&1 | tail -3
      REPORTS_DIR="$REPORTS_DIR/output"

      # Step 4: Transform into src/data/
      echo ""
      echo "Transforming data..."
      mkdir -p "$OUT_DIR"

      # Copy mod output directly
      cp "$WORK_DIR/typecraft-data/"*.json "$OUT_DIR/"

      # Copy recipes from vanilla reports
      if [ -d "$REPORTS_DIR/data/minecraft/recipe" ]; then
        cp -r "$REPORTS_DIR/data/minecraft/recipe" "$OUT_DIR/recipes-raw"
        echo "Copied recipes"
      fi

      # Copy tags
      if [ -d "$REPORTS_DIR/data/minecraft/tags" ]; then
        cp -r "$REPORTS_DIR/data/minecraft/tags" "$OUT_DIR/tags"
        echo "Copied tags"
      fi

      # Copy biome data for tints
      if [ -d "$REPORTS_DIR/data/minecraft/worldgen/biome" ]; then
        cp -r "$REPORTS_DIR/data/minecraft/worldgen/biome" "$OUT_DIR/biomes-raw"
        echo "Copied biome data"
      fi

      # Copy vanilla reports
      if [ -d "$REPORTS_DIR/reports" ]; then
        cp "$REPORTS_DIR/reports/items.json" "$OUT_DIR/items-raw.json" 2>/dev/null || true
        cp "$REPORTS_DIR/reports/registries.json" "$OUT_DIR/registries-raw.json" 2>/dev/null || true
        cp "$REPORTS_DIR/reports/packets.json" "$OUT_DIR/packets-raw.json" 2>/dev/null || true
        echo "Copied vanilla reports"
      fi

      # Step 5: Extract assets from client JAR
      echo ""
      echo "Extracting assets from client JAR..."
      if [ -f "${clientJar}" ]; then
        ASSETS_DIR="$OUT_DIR/assets"
        mkdir -p "$ASSETS_DIR"
        ${pkgs.unzip}/bin/unzip -qo "${clientJar}" \
          "assets/minecraft/textures/block/*" \
          "assets/minecraft/textures/entity/*" \
          "assets/minecraft/textures/item/*" \
          "assets/minecraft/models/block/*" \
          "assets/minecraft/models/item/*" \
          "assets/minecraft/blockstates/*" \
          -d "$ASSETS_DIR"
        # Flatten: move assets/minecraft/* up one level
        cp -r "$ASSETS_DIR/assets/minecraft/"* "$ASSETS_DIR/"
        rm -rf "$ASSETS_DIR/assets"
        echo "Extracted textures, models, blockstates from client JAR"
        echo "  blocks: $(ls "$ASSETS_DIR/textures/block/" | wc -l) block textures"
        echo "  items: $(ls "$ASSETS_DIR/textures/item/" 2>/dev/null | wc -l) item textures"
        echo "  entities: $(ls "$ASSETS_DIR/textures/entity/" 2>/dev/null | wc -l) entity textures"
        echo "  models: $(ls "$ASSETS_DIR/models/block/" | wc -l) block models"
        echo "  item models: $(ls "$ASSETS_DIR/models/item/" 2>/dev/null | wc -l) item models"
        echo "  blockstates: $(ls "$ASSETS_DIR/blockstates/" | wc -l) blockstates"
      else
        echo "WARNING: Client JAR not found at ${clientJar}"
        echo "Install Minecraft ${version} via Prism Launcher to extract assets"
      fi

      echo ""
      echo "=== Done ==="
      echo "Output: $OUT_DIR/"
      ls -la "$OUT_DIR/"
    '';
  in {
    packages.${system} = {
      default = runDatagen;
      datagen = runDatagen;
    };

    apps.${system} = {
      default = {
        type = "app";
        program = "${runDatagen}/bin/datagen";
      };
      datagen = {
        type = "app";
        program = "${runDatagen}/bin/datagen";
      };
    };

    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        pkgs.jre
        pkgs.gradle
        pkgs.nodejs
      ];
      shellHook = ''
        echo "Typecraft dev shell"
        echo ""
        echo "  nix run .#datagen    Extract game data from MC ${version}"
        echo "  gradle build         Build the Fabric datagen mod"
        echo ""
      '';
    };
  };
}
