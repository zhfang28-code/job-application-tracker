import { STORAGE_KEY, normalizeApplication } from "./model.js?v=20260831-2";

export function loadApplications(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed.applications;
    return Array.isArray(items) ? items.map(normalizeApplication) : [];
  } catch (error) {
    console.warn("Could not load saved applications", error);
    return [];
  }
}

export function saveApplications(applications, storage = globalThis.localStorage) {
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    applications: applications.map(normalizeApplication),
  };
  storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  return payload;
}

export function loadPreference(key, fallback = "") {
  try {
    return globalThis.localStorage.getItem(`jobtrail.preference.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePreference(key, value) {
  try {
    globalThis.localStorage.setItem(`jobtrail.preference.${key}`, String(value));
  } catch {
    // The app remains usable when private browsing blocks localStorage.
  }
}
