// shared.js — общие константы и утилиты для background.js, dashboard.js и popup.js.

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

export function pickSettings(obj) {
  const out = {};
  for (const k of SETTINGS_KEYS) out[k] = obj?.[k];
  return out;
}

// 🆕 Расширенная функция определения системного URL
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