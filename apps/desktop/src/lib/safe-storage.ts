// Safe localStorage JSON reader — prevents black-screen crashes from corrupted storage

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[storage] invalid JSON for "${key}", clearing it`, err);
    try { localStorage.removeItem(key); } catch {}
    return fallback;
  }
}
