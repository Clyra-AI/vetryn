const liveCatalogRefreshResults = new WeakSet<object>();

export function markLiveCatalogRefreshResult<Value extends object>(value: Value): Value {
  liveCatalogRefreshResults.add(value);
  return value;
}

export function isLiveCatalogRefreshResult(value: unknown): value is object {
  return typeof value === "object" && value !== null && liveCatalogRefreshResults.has(value);
}
