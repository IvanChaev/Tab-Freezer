// @ts-check
// tests/chrome-mock.js — фабрика моков для chrome.* API

import { vi } from "vitest";

/**
 * Создаёт свежий набор моков chrome.* для каждого теста.
 * Каждый мок можно переопределить через mockImplementation/ mockReturnValue
 */
export function createChromeMock() {
  const store = {};
  const sessionStore = {};

  /** @param {string|string[]} keys */
  function localGet(keys) {
    if (typeof keys === "string") keys = [keys];
    const result = {};
    for (const k of keys) {
      if (k in store) result[k] = store[k];
    }
    return Promise.resolve(result);
  }

  function localSet(items) {
    Object.assign(store, items);
    return Promise.resolve();
  }

  function localRemove(keys) {
    if (typeof keys === "string") keys = [keys];
    for (const k of keys) delete store[k];
    return Promise.resolve();
  }

  /** @param {string|string[]} keys */
  function sessionGet(keys) {
    if (typeof keys === "string") keys = [keys];
    const result = {};
    for (const k of keys) {
      if (k in sessionStore) result[k] = sessionStore[k];
    }
    return Promise.resolve(result);
  }

  function sessionSet(items) {
    Object.assign(sessionStore, items);
    return Promise.resolve();
  }

  function sessionRemove(keys) {
    if (typeof keys === "string") keys = [keys];
    for (const k of keys) delete sessionStore[k];
    return Promise.resolve();
  }

  /** @type {{ [tabId: number]: chrome.tabs.Tab }} */
  const tabsDb = {};
  let nextTabId = 100;
  let activeTabId = null;

  /**
   * Добавляет тестовую вкладку в tabsDb.
   * @param {Partial<chrome.tabs.Tab>} overrides
   * @returns {chrome.tabs.Tab}
   */
  function addTab(overrides = {}) {
    const id = overrides.id ?? nextTabId++;
    const tab = {
      id,
      url: "https://example.com",
      title: "Example",
      active: false,
      discarded: false,
      pinned: false,
      audible: false,
      lastAccessed: Date.now(),
      windowId: 1,
      favIconUrl: "",
      index: 0,
      ...overrides,
    };
    tabsDb[id] = tab;
    if (tab.active) activeTabId = id;
    return tab;
  }

  function removeTab(id) {
    delete tabsDb[id];
    if (activeTabId === id) activeTabId = null;
    return Promise.resolve();
  }

  function getTab(id) {
    const tab = tabsDb[id];
    if (!tab) return Promise.reject(new Error(`Tab ${id} not found`));
    return Promise.resolve(tab);
  }

  /** @type {chrome.tabs.QueryInfo} */
  function queryTabs(queryInfo) {
    let result = Object.values(tabsDb);
    if (queryInfo.active !== undefined) {
      result = result.filter(t => t.active === queryInfo.active);
    }
    if (queryInfo.windowId !== undefined) {
      result = result.filter(t => t.windowId === queryInfo.windowId);
    }
    if (queryInfo.url !== undefined) {
      result = result.filter(t => t.url === queryInfo.url);
    }
    return Promise.resolve(result);
  }

  let focusedWindowId = 1;

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn(localGet),
        set: vi.fn(localSet),
        remove: vi.fn(localRemove),
      },
      // Добавлено: используется bg/audio-cache.js, чтобы буфер "вкладка
      // недавно издавала звук" переживал перезапуски сервис-воркера.
      session: {
        get: vi.fn(sessionGet),
        set: vi.fn(sessionSet),
        remove: vi.fn(sessionRemove),
      },
    },
    tabs: {
      query: vi.fn((queryInfo) => queryTabs(queryInfo)),
      get: vi.fn((tabId) => getTab(tabId)),
      remove: vi.fn(async (tabId) => removeTab(tabId)),
      discard: vi.fn(async (tabId) => {
        if (tabsDb[tabId]) {
          tabsDb[tabId].discarded = true;
        }
      }),
      create: vi.fn(async (props) => {
        const tab = addTab(props);
        return tab;
      }),
      onActivated: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      onCreated: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    windows: {
      getLastFocused: vi.fn(() => Promise.resolve({ id: focusedWindowId })),
      update: vi.fn(() => Promise.resolve()),
      onFocusChanged: { addListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve()),
      getURL: vi.fn((path) => `chrome-extension://abc/${path}`),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    alarms: {
      get: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => {}),
      onAlarm: { addListener: vi.fn() },
    },
    contextMenus: {
      removeAll: vi.fn(() => Promise.resolve()),
      create: vi.fn(() => {}),
      onClicked: { addListener: vi.fn() },
    },

    // ---- Вспомогательные методы для тестов ----
    _mock: {
      /** @returns {typeof tabsDb} */
      get tabsDb() { return tabsDb; },
      get focusedWindowId() { return focusedWindowId; },
      set focusedWindowId(id) { focusedWindowId = id; },
      addTab,
      removeTab,
      /** Очистить всё */
      reset() {
        Object.keys(store).forEach(k => delete store[k]);
        Object.keys(sessionStore).forEach(k => delete sessionStore[k]);
        Object.keys(tabsDb).forEach(k => delete tabsDb[k]);
        activeTabId = null;
        nextTabId = 100;
        focusedWindowId = 1;
      },
    },
  };

  return chromeMock;
}
