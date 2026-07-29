// @ts-check
// shared.js — общие константы и утилиты для background.js, dashboard.js и popup.js.

// ─── Системные константы ───
export const ALARM_PERIOD_MINUTES = 1;
export const STORAGE_LOCK_TIMEOUT_MS = 30000;
export const LOG_MAX_LENGTH = 100;
export const TOAST_DURATION_MS = 3000;
export const RETRY_COUNT = 3;
export const RETRY_DELAY_MS = 500;
export const MAX_RETRY_DELAY_MS = 3000;
export const VISIBILITY_THROTTLE_MS = 5000;
export const BADGE_TICK_INTERVAL_MS = 1000;
export const CACHE_REFRESH_INTERVAL_MS = 3000;
export const STATS_UPDATE_INTERVAL_MS = 5000;
export const STALE_CACHE_THRESHOLD_MS = 1500;
export const MESSAGE_TIMEOUT_MS = 3000;
export const ACTIVITY_READINESS_TIMEOUT_MS = 5000;
export const PERSIST_DEBOUNCE_MS = 1000;
export const OVERSCAN_COUNT = 10;
export const LIST_MIN_HEIGHT = 100;
export const INIT_DELAY_MS = 300;
export const INIT_RETRY_DELAY_MS = 300;
export const INIT_RETRY_COUNT = 5;

export const DEFAULT_SETTINGS = {
  timeoutMinutes: 15,
  closeOldMinutes: 120,
  autoClose: false,
  excludePinned: true,
  excludeAudio: true,
  aggressiveFreeze: false,
  whitelist: [],
  fullFreezeSystemPages: false,
  systemFreezeList: []
};

export const SETTINGS_KEYS = [
  "timeoutMinutes", "closeOldMinutes", "autoClose",
  "excludePinned", "excludeAudio", "whitelist",
  "aggressiveFreeze",
  "fullFreezeSystemPages",
  "systemFreezeList"
];

/**
 * Извлекает только известные ключи настроек из произвольного объекта.
 * @param {Record<string, unknown>|Settings} obj
 * @returns {Settings}
 */
export function pickSettings(obj) {
  const out = /** @type {Settings} */ ({});
  for (const k of SETTINGS_KEYS) out[k] = obj?.[k];
  return out;
}

/**
 * Определяет, является ли URL системным (chrome://, edge://, about: и т.д.)
 * @param {string|undefined} url
 * @returns {boolean}
 */
export function isSystemUrl(url) {
  if (!url) return false;
  const protocols = [
    "chrome://",
    "edge://",
    "about:",
    "moz-extension://",
    "chrome-extension://",
    "opera://",
    "brave://",
    "vivaldi://",
    "arc://",
    "whale://",
    "nav://",
    "edg://",
    "browser://",
    "firefox://"
  ];
  return protocols.some(p => url.startsWith(p)) || url.startsWith(chrome.runtime.getURL(""));
}

/**
 * Безопасно извлекает hostname из URL. Не кидает исключений.
 * @param {string|undefined} url
 * @returns {string|null}
 */
export function tryGetHostname(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Нормализует домен: убирает протокол, www., path, trailing dots.
 * @param {string} input
 * @returns {string}
 */
export function normalizeDomain(input) {
  if (typeof input !== "string") return "";
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  d = d.replace(/^\.+/, "").replace(/\.+$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  if (d.startsWith("*.")) d = d.slice(2);
  return d;
}

const FAILED_FAVICONS = new Set();
const MAX_FAILED_FAVICONS = 500;

function addFailedFavicon(url) {
  FAILED_FAVICONS.add(url);
  if (FAILED_FAVICONS.size > MAX_FAILED_FAVICONS) {
    FAILED_FAVICONS.clear();
  }
}

/**
 * Устанавливает favicon для img-элемента с fallback при ошибке загрузки.
 * @param {HTMLImageElement} imgEl
 * @param {string|undefined} url
 * @param {boolean} [isSystem=false]
 * @param {string} [fallbackSrc="icons/snowflake-16.png"]
 */
export function applyFavicon(imgEl, url, isSystem = false, fallbackSrc = "icons/snowflake-16.png") {
  if (isSystem || !url || FAILED_FAVICONS.has(url)) {
    imgEl.removeAttribute("onerror");
    imgEl.src = fallbackSrc;
    return;
  }
  imgEl.onerror = () => {
    addFailedFavicon(url);
    imgEl.onerror = null;
    imgEl.src = fallbackSrc;
  };
  imgEl.src = url;
}