// @ts-check
import { describe, it, expect, vi, beforeEach } from "vitest";

// Мокаем activity.js, чтобы не ждать таймаут readiness и не зависеть от lastDeactivationTimes
vi.mock("../../bg/activity.js", () => ({
  waitForActivityReadiness: vi.fn(() => Promise.resolve(true)),
  getLastActiveTime: vi.fn((tab) =>
    tab.active
      ? Date.now()
      : (typeof tab.lastAccessed === "number" ? tab.lastAccessed : 0),
  ),
}));

import { runFreezeCheck } from "../../bg/freeze.js";

beforeEach(() => {
  // Стандартные настройки
  chrome.storage.local.set({
    settings: {
      timeoutMinutes: 15,
      closeOldMinutes: 120,
      autoClose: false,
      excludePinned: true,
      excludeAudio: true,
      aggressiveFreeze: false,
      whitelist: [],
      fullFreezeSystemPages: false,
      systemFreezeList: [],
    },
    savedTabs: [],
    logs: [],
    totalFrozen: 0,
    tempExemptions: [],
  });
});

describe("runFreezeCheck", () => {
  it("возвращает 0, если нет неактивных вкладок", async () => {
    chrome._mock.addTab({ id: 1, active: true, lastAccessed: Date.now() });
    chrome._mock.addTab({ id: 2, active: false, lastAccessed: Date.now() });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("замораживает вкладку, превысившую таймаут", async () => {
    const old = Date.now() - 20 * 60 * 1000; // 20 минут назад
    chrome._mock.addTab({ id: 1, active: false, lastAccessed: old });

    const count = await runFreezeCheck("test");
    expect(count).toBe(1);
    expect(chrome.tabs.discard).toHaveBeenCalledWith(1);
  });

  it("не замораживает активную вкладку", async () => {
    chrome._mock.addTab({ id: 1, active: true, lastAccessed: Date.now() - 60 * 60 * 1000 });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
    expect(chrome.tabs.discard).not.toHaveBeenCalled();
  });

  it("не замораживает вкладку без URL", async () => {
    chrome._mock.addTab({ id: 1, active: false, url: undefined });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("не замораживает закреплённую вкладку (excludePinned)", async () => {
    chrome._mock.addTab({
      id: 1, active: false, pinned: true,
      lastAccessed: Date.now() - 60 * 60 * 1000,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("не замораживает вкладку со звуком (excludeAudio)", async () => {
    const old = Date.now() - 20 * 60 * 1000;
    chrome._mock.addTab({
      id: 1, active: false, audible: true, lastAccessed: old,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("не замораживает вкладку из белого списка", async () => {
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 1,
        closeOldMinutes: 120,
        autoClose: false,
        excludePinned: true,
        excludeAudio: false,
        aggressiveFreeze: false,
        whitelist: ["example.com"],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
    });
    chrome._mock.addTab({
      id: 1, active: false, url: "https://example.com/page",
      lastAccessed: Date.now() - 10 * 60 * 1000,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("выполняет fresh check перед discard — не выгружает ставшую активной", async () => {
    const old = Date.now() - 20 * 60 * 1000;
    chrome._mock.addTab({ id: 1, active: false, lastAccessed: old });

    // Подменяем chrome.tabs.get — при финальной проверке вкладка уже активна
    const originalImpl = chrome.tabs.get.getMockImplementation();
    chrome.tabs.get.mockImplementation(async (id) => {
      const tab = await originalImpl(id);
      if (tab && id === 1) tab.active = true;
      return tab;
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
    expect(chrome.tabs.discard).not.toHaveBeenCalled();
  });

  it("агрессивная заморозка закрывает вкладку вместо discard", async () => {
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 1,
        closeOldMinutes: 120,
        autoClose: false,
        excludePinned: false,
        excludeAudio: false,
        aggressiveFreeze: true,
        whitelist: [],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
    });
    chrome._mock.addTab({
      id: 1, active: false, url: "https://example.com",
      lastAccessed: Date.now() - 10 * 60 * 1000,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(1);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
    // Сохранена в списке замороженных
    const { savedTabs } = await chrome.storage.local.get("savedTabs");
    expect(savedTabs.length).toBe(1);
    expect(savedTabs[0].url).toBe("https://example.com");
  });

  it("пропускает уже выгруженные вкладки (не aggressive)", async () => {
    const old = Date.now() - 20 * 60 * 1000;
    chrome._mock.addTab({
      id: 1, active: false, discarded: true, lastAccessed: old,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
    expect(chrome.tabs.discard).not.toHaveBeenCalled();
  });

  it("замораживает уже выгруженные при aggressiveFreeze", async () => {
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 1,
        closeOldMinutes: 120,
        autoClose: false,
        excludePinned: false,
        excludeAudio: false,
        aggressiveFreeze: true,
        whitelist: [],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
    });
    chrome._mock.addTab({
      id: 1, active: false, discarded: true,
      lastAccessed: Date.now() - 10 * 60 * 1000,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(1);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
  });

  it("автоочистка старых сохранённых записей", async () => {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 дней назад
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 15,
        closeOldMinutes: 60, // 1 час
        autoClose: true,
        excludePinned: true,
        excludeAudio: true,
        aggressiveFreeze: false,
        whitelist: [],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
      savedTabs: [
        { id: "old", url: "https://old.com", title: "Old", closedAt: old },
      ],
    });

    await runFreezeCheck("test");
    const { savedTabs } = await chrome.storage.local.get("savedTabs");
    expect(savedTabs.length).toBe(0);
  });

  it("выполняет автоочистку, даже если activity tracking не готов", async () => {
    const { waitForActivityReadiness } = await import("../../bg/activity.js");
    waitForActivityReadiness.mockResolvedValue(false);

    const old = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 дней назад
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 15,
        closeOldMinutes: 60,
        autoClose: true,
        excludePinned: true,
        excludeAudio: true,
        aggressiveFreeze: false,
        whitelist: [],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
      savedTabs: [
        { id: "stale", url: "https://old.com", title: "Old", closedAt: old },
      ],
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);

    const { savedTabs } = await chrome.storage.local.get("savedTabs");
    expect(savedTabs.length).toBe(0);

    waitForActivityReadiness.mockResolvedValue(true);
  });

  it("не удаляет свежие записи при неготовом activity tracking", async () => {
    const { waitForActivityReadiness } = await import("../../bg/activity.js");
    waitForActivityReadiness.mockResolvedValue(false);

    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 15,
        closeOldMinutes: 60,
        autoClose: true,
        excludePinned: true,
        excludeAudio: true,
        aggressiveFreeze: false,
        whitelist: [],
        fullFreezeSystemPages: false,
        systemFreezeList: [],
      },
      savedTabs: [
        {
          id: "fresh",
          url: "https://fresh.com",
          title: "Fresh",
          closedAt: Date.now(),
        },
      ],
    });

    await runFreezeCheck("test");

    const { savedTabs } = await chrome.storage.local.get("savedTabs");
    expect(savedTabs.length).toBe(1);

    waitForActivityReadiness.mockResolvedValue(true);
  });

  it("замораживает системную страницу с null lastAccessed", async () => {
    await chrome.storage.local.set({
      settings: {
        timeoutMinutes: 1,
        closeOldMinutes: 120,
        autoClose: false,
        excludePinned: false,
        excludeAudio: false,
        aggressiveFreeze: false,
        whitelist: [],
        fullFreezeSystemPages: true,
        systemFreezeList: ["chrome://history"],
      },
    });
    chrome._mock.addTab({
      id: 1,
      active: false,
      url: "chrome://history",
      title: "History",
      lastAccessed: null,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(1);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);

    const { savedTabs } = await chrome.storage.local.get("savedTabs");
    expect(savedTabs.length).toBe(1);
    expect(savedTabs[0].url).toBe("chrome://history");
  });

  it("не трогает страницы расширения", async () => {
    chrome._mock.addTab({
      id: 1, active: false,
      url: "chrome-extension://abc/dashboard.html",
      lastAccessed: Date.now() - 60 * 60 * 1000,
    });

    const count = await runFreezeCheck("test");
    expect(count).toBe(0);
  });

  it("логирует результат проверки", async () => {
    const old = Date.now() - 20 * 60 * 1000;
    chrome._mock.addTab({ id: 1, active: false, lastAccessed: old });

    await runFreezeCheck("test-reason");
    const { logs } = await chrome.storage.local.get("logs");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe("Заморозка");
  });

  it("возвращает количество замороженных вкладок", async () => {
    const old = Date.now() - 20 * 60 * 1000;
    chrome._mock.addTab({ id: 1, active: false, lastAccessed: old });
    chrome._mock.addTab({ id: 2, active: false, lastAccessed: old });

    const count = await runFreezeCheck("test");
    expect(count).toBe(2);
  });
});
