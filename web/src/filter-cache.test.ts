import { describe, expect, it } from "vitest";
import { filterCacheKey, readCachedFilters, writeCachedFilters } from "./filter-cache";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } as Pick<Storage, "getItem" | "setItem">,
  };
}

describe("filter cache", () => {
  it("scopes cached filters by project and view", () => {
    const { storage } = createStorage();
    writeCachedFilters(storage, "project-a", "cashflow", { personId: "person-a", type: "income" });
    writeCachedFilters(storage, "project-a", "budget", { sortKey: "spent" });

    expect(readCachedFilters(storage, "project-a", "cashflow")).toEqual({
      personId: "person-a",
      type: "income",
    });
    expect(readCachedFilters(storage, "project-a", "budget")).toEqual({
      sortKey: "spent",
    });
    expect(readCachedFilters(storage, "project-b", "cashflow")).toEqual({});
  });

  it("ignores invalid or unsupported cached values", () => {
    const { storage, values } = createStorage();
    values.set(filterCacheKey("project-a", "cashflow"), '{"personId":"person-a","count":3}');
    expect(readCachedFilters(storage, "project-a", "cashflow")).toEqual({ personId: "person-a" });

    values.set(filterCacheKey("project-a", "cashflow"), "{invalid");
    expect(readCachedFilters(storage, "project-a", "cashflow")).toEqual({});
  });
});
