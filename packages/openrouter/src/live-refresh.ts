const liveCatalogRefreshResults = new WeakSet<object>();
const liveCatalogRefreshInvocationBindings = new WeakMap<object, string>();

export function markLiveCatalogRefreshResult<Value extends object>(value: Value): Value {
  liveCatalogRefreshResults.add(value);
  return value;
}

export function consumeLiveCatalogRefreshResult(
  value: unknown,
  invocationId: string,
): value is object {
  if (
    typeof value !== "object" ||
    value === null ||
    !liveCatalogRefreshResults.has(value) ||
    liveCatalogRefreshInvocationBindings.has(value)
  ) {
    return false;
  }
  liveCatalogRefreshInvocationBindings.set(value, invocationId);
  return true;
}
