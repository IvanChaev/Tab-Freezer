// shared.js — общие константы и утилиты для background.js, dashboard.js и popup.js.

export const DEFAULT_SETTINGS = {
  timeoutMinutes: 15,
  closeOldMinutes: 120,
  autoClose: false,
  excludePinned: true,
  excludeAudio: true,
  aggressiveFreeze: false,
  whitelist: [],
  fullFreezeSystemPages: false,   // 🆕 разрешить полную заморозку системных страниц
  systemFreezeList: []            // 🆕 список разрешённых системных URL (префиксы)
};

// === Список ключей настроек, используемых в UI ===
export const SETTINGS_KEYS = [
  "timeoutMinutes", "closeOldMinutes", "autoClose",
  "excludePinned", "excludeAudio", "whitelist",
  "aggressiveFreeze",
  "fullFreezeSystemPages",   // 🆕
  "systemFreezeList"         // 🆕
];

// === Выборочное копирование настроек (используется в settings.js и whitelist.js) ===
export function pickSettings(obj) {
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = obj?.[k];
  return out;
}

// 🆕 Определение системного URL (вынесено для переиспользования)
export function isSystemUrl(url) {
  if (!url) return false;
  return url.startsWith("chrome://") ||
         url.startsWith("edge://") ||
         url.startsWith("about:") ||
         url.startsWith("moz-extension://") ||
         url.startsWith("chrome-extension://");
}

export function normalizeDomain(input) {
  if (typeof input !== "string") return "";
  let d = input.trim().toLowerCase();
  // Удаляем протокол
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  // Удаляем путь, параметры, якорь, порт
  d = d.split("/")[0].split("?")[0].split("#")[0].split(":")[0];
  // Убираем ведущие/замыкающие точки
  d = d.replace(/^\.+/, "").replace(/\.+$/, "");
  // Убираем www.
  if (d.startsWith("www.")) d = d.slice(4);
  // Убираем возможный "*."
  if (d.startsWith("*.")) d = d.slice(2);
  return d;
}

// === Безопасная загрузка favicon'ов ===
const FAILED_FAVICONS = new Set();
const MAX_FAILED_FAVICONS = 500;

function addFailedFavicon(url) {
  FAILED_FAVICONS.add(url);
  if (FAILED_FAVICONS.size > MAX_FAILED_FAVICONS) {
    FAILED_FAVICONS.clear(); // очищаем всё, чтобы не расти бесконечно
  }
}

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