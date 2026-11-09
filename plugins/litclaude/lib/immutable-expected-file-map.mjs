const MUTATORS = new Set(["set", "delete", "clear"]);

export function immutableExpectedFileMap(entries = []) {
  const target = new Map([...entries].map(([path, expected]) => {
    if (typeof path !== "string"
      || !Number.isSafeInteger(expected?.size)
      || expected.size < 0
      || typeof expected.executable !== "boolean"
      || !/^[0-9a-f]{64}$/u.test(expected?.sha256)) {
      throw new TypeError("invalid immutable expected file entry");
    }
    return [path, Object.freeze({
      size: expected.size,
      sha256: expected.sha256,
      executable: expected.executable,
    })];
  }));
  let proxy;
  proxy = new Proxy(target, {
    get(map, property) {
      if (MUTATORS.has(property)) {
        return () => { throw new TypeError("immutable expected file map"); };
      }
      if (property === "forEach") {
        return (callback, thisArg) => map.forEach((value, key) => callback.call(thisArg, value, key, proxy));
      }
      const value = Reflect.get(map, property, map);
      return typeof value === "function" ? value.bind(map) : value;
    },
    set() {
      throw new TypeError("immutable expected file map");
    },
    defineProperty() {
      throw new TypeError("immutable expected file map");
    },
    deleteProperty() {
      throw new TypeError("immutable expected file map");
    },
  });
  return Object.freeze(proxy);
}
