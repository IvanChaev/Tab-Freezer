// bg/activity.js — отслеживание времени последней активности вкладок

const lastDeactivationTimes = new Map(); // tabId -> timestamp when tab became inactive
let currentActiveTabId = null;

export { lastDeactivationTimes };

/**
 * Возвращает время последней активности вкладки (timestamp).
 * Для активной вкладки — текущее время.
 * Для неактивной — время деактивации, если есть, иначе tab.lastAccessed.
 */
export function getLastActiveTime(tab) {
  if (tab.active) {
    return Date.now();
  }
  if (lastDeactivationTimes.has(tab.id)) {
    return lastDeactivationTimes.get(tab.id);
  }
  return tab.lastAccessed || Date.now();
}

/**
 * Инициализирует слушатели для отслеживания активации/закрытия вкладок.
 * Вызывается один раз при старте service worker.
 */
export function initActivityTracking() {
  // При активации вкладки
  chrome.tabs.onActivated.addListener((activeInfo) => {
    const newActiveTabId = activeInfo.tabId;
    // Если была предыдущая активная вкладка, запоминаем для неё время деактивации
    if (currentActiveTabId !== null && currentActiveTabId !== newActiveTabId) {
      lastDeactivationTimes.set(currentActiveTabId, Date.now());
    }
    // Новая активная вкладка — удаляем запись о деактивации (она активна)
    lastDeactivationTimes.delete(newActiveTabId);
    currentActiveTabId = newActiveTabId;
  });

  // При закрытии вкладки очищаем запись
  chrome.tabs.onRemoved.addListener((tabId) => {
    lastDeactivationTimes.delete(tabId);
    if (currentActiveTabId === tabId) {
      currentActiveTabId = null;
    }
  });

  // При старте узнаём текущую активную вкладку
  chrome.tabs.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab) {
        currentActiveTabId = tab.id;
        lastDeactivationTimes.delete(tab.id);
      }
    })
    .catch(console.error);

  // 🔥 Раз в 30 секунд гарантированно сбрасываем запись для активной вкладки
  // Это дополнительная защита от возможных артефактов
  setInterval(() => {
    if (currentActiveTabId !== null) {
      lastDeactivationTimes.delete(currentActiveTabId);
    }
  }, 30000);
}