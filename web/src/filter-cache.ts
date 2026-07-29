export type CachedFilterValues = Record<string, string>;

type FilterStorage = Pick<Storage, "getItem" | "setItem">;

const cachePrefix = "renovation-budget:view-filters:v1";

export function filterCacheKey(projectId: string, view: string): string {
  return `${cachePrefix}:${projectId}:${view}`;
}

export function readCachedFilters(
  storage: FilterStorage,
  projectId: string,
  view: string,
): CachedFilterValues {
  try {
    const value: unknown = JSON.parse(storage.getItem(filterCacheKey(projectId, view)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function writeCachedFilters(
  storage: FilterStorage,
  projectId: string,
  view: string,
  values: CachedFilterValues,
): void {
  try {
    storage.setItem(filterCacheKey(projectId, view), JSON.stringify(values));
  } catch {
    // 篩選快取失敗時不影響主要帳務操作。
  }
}
