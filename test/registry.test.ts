import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/registry/index.js";

describe("createRegistry", () => {
	it("loads 1.20.4 registry", () => {
		const reg = createRegistry("1.20.4");
		expect(reg.version.type).toBe("pc");
		expect(reg.version.majorVersion).toBe("1.20");
		expect(reg.blocksArray.length).toBeGreaterThan(0);
		expect(reg.biomesArray.length).toBeGreaterThan(0);
	});

	it("loads 1.18 registry", () => {
		const reg = createRegistry("1.18");
		expect(reg.version.majorVersion).toBe("1.18");
		expect(reg.blocksArray.length).toBeGreaterThan(0);
	});

	it("throws for unsupported version", () => {
		expect(() => createRegistry("0.0.1")).toThrow();
	});
});

describe("block lookups", () => {
	const reg = createRegistry("1.20.4");

	it("looks up air by name", () => {
		const air = reg.blocksByName.get("air");
		expect(air).toBeDefined();
		expect(air!.id).toBe(0);
		expect(air!.name).toBe("air");
	});

	it("looks up stone by name", () => {
		const stone = reg.blocksByName.get("stone");
		expect(stone).toBeDefined();
		expect(stone!.name).toBe("stone");
		expect(stone!.defaultState).toBe(stone!.minStateId);
	});

	it("looks up block by state ID", () => {
		const stone = reg.blocksByName.get("stone")!;
		const found = reg.blocksByStateId.get(stone.defaultState);
		expect(found).toBeDefined();
		expect(found!.name).toBe("stone");
	});

	it("looks up block by ID", () => {
		const stone = reg.blocksByName.get("stone")!;
		const found = reg.blocksById.get(stone.id);
		expect(found).toBeDefined();
		expect(found!.name).toBe("stone");
	});

	it("maps all state IDs in range", () => {
		const oakStairs = reg.blocksByName.get("oak_stairs")!;
		expect(oakStairs.maxStateId).toBeGreaterThan(oakStairs.minStateId);
		for (let s = oakStairs.minStateId; s <= oakStairs.maxStateId; s++) {
			expect(reg.blocksByStateId.get(s)?.name).toBe("oak_stairs");
		}
	});

	it("includes block state properties", () => {
		const oakStairs = reg.blocksByName.get("oak_stairs")!;
		expect(oakStairs.states.length).toBeGreaterThan(0);
		const facingProp = oakStairs.states.find((s) => s.name === "facing");
		expect(facingProp).toBeDefined();
		expect(facingProp!.type).toBe("enum");
	});
});

describe("biome lookups", () => {
	const reg = createRegistry("1.20.4");

	it("looks up plains by name", () => {
		const plains = reg.biomesByName.get("plains");
		expect(plains).toBeDefined();
		expect(plains!.name).toBe("plains");
	});

	it("looks up biome by ID", () => {
		const plains = reg.biomesByName.get("plains")!;
		const found = reg.biomesById.get(plains.id);
		expect(found).toBeDefined();
		expect(found!.name).toBe("plains");
	});

	it("has temperature and category", () => {
		const desert = reg.biomesByName.get("desert")!;
		expect(desert.temperature).toBeGreaterThan(0);
		expect(desert.category).toBeDefined();
	});
});

describe("version utilities", () => {
	const reg = createRegistry("1.20.4");

	it("isNewerOrEqualTo works", () => {
		expect(reg.isNewerOrEqualTo("1.18")).toBe(true);
		expect(reg.isNewerOrEqualTo("1.20")).toBe(true);
	});

	it("isOlderThan works", () => {
		expect(reg.isOlderThan("1.18")).toBe(false);
		expect(reg.isOlderThan("1.21")).toBe(true);
	});

	it("supportFeature works", () => {
		const result = reg.supportFeature("usesBlockStates");
		expect(typeof result).toBe("boolean");
	});
});

describe("cross-version consistency", () => {
	const versions = ["1.18", "1.19", "1.20.4", "1.21"];

	for (const v of versions) {
		it(`${v}: has air, stone, dirt`, () => {
			const reg = createRegistry(v);
			expect(reg.blocksByName.get("air")).toBeDefined();
			expect(reg.blocksByName.get("stone")).toBeDefined();
			expect(reg.blocksByName.get("dirt")).toBeDefined();
		});

		it(`${v}: has plains biome`, () => {
			const reg = createRegistry(v);
			expect(reg.biomesByName.get("plains")).toBeDefined();
		});
	}
});
