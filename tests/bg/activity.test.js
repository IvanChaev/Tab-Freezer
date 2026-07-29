// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getCurrentActiveTabId,
  getLastActiveTime,
  resetDeactivationTimes,
  initActivityTracking,
  waitForActivityReadiness,
  lastDeactivationTimes,
} from "../../bg/activity.js";

/** @type {Array<(args: any) => void>} */
let onActivatedCbs = [];
/** @type {Array<(windowId: number) => void>} */
let onFocusChangedCbs = [];
/** @type {Array<(tabId: number) => void>} */
let onRemovedCbs = [];
/** @type {Array<(tab: chrome.tabs.Tab) => void>} */
let onCreatedCbs = [];

function captureListeners() {
  onActivatedCbs = [];
  onFocusChangedCbs = [];
  onRemovedCbs = [];
  onCreatedCbs = [];

  chrome.tabs.onActivated.addListener.mockImplementation((cb) => {
    onActivatedCbs.push(cb);
  });
  chrome.windows.onFocusChanged.addListener.mockImplementation((cb) => {
    onFocusChangedCbs.push(cb);
  });
  chrome.tabs.onRemoved.addListener.mockImplementation((cb) => {
    onRemovedCbs.push(cb);
  });
  chrome.tabs.onCreated.addListener.mockImplementation((cb) => {
    onCreatedCbs.push(cb);
  });
}

async function resetAndInit() {
  lastDeactivationTimes.clear();
  await resetDeactivationTimes();
  captureListeners();
  await initActivityTracking({ restore: false });
}

beforeEach(async () => {
  chrome._mock.reset();
  lastDeactivationTimes.clear();
  await resetDeactivationTimes();
  captureListeners();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getLastActiveTime", () => {
  it("возвращает Date.now() для активной вкладки", () => {
    const before = Date.now();
    const result = getLastActiveTime({ id: 1, active: true });
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("возвращает lastDeactivationTimes для неактивной с записью", () => {
    const deactivatedAt = Date.now() - 5000;
    lastDeactivationTimes.set(1, deactivatedAt);
    const result = getLastActiveTime({ id: 1, active: false });
    expect(result).toBe(deactivatedAt);
  });

  it("возвращает tab.lastAccessed для неактивной без записи", () => {
    const result = getLastActiveTime({
      id: 1, active: false, lastAccessed: 1000,
    });
    expect(result).toBe(1000);
  });
});

describe("resetDeactivationTimes", () => {
  it("очищает карту и currentActiveTabId", async () => {
    lastDeactivationTimes.set(99, Date.now());
    chrome._mock.addTab({ id: 1, active: true });

    await resetDeactivationTimes();

    expect(lastDeactivationTimes.size).toBeGreaterThan(0);
    // У неактивных вкладок должна быть запись о деактивации
    const activeId = getCurrentActiveTabId();
    expect(typeof activeId).toBe("number");
  });

  it("устанавливает currentActiveTabId на активную вкладку", async () => {
    chrome._mock.addTab({ id: 10, active: true });

    await resetDeactivationTimes();

    expect(getCurrentActiveTabId()).toBe(10);
  });

  it("помечает неактивные вкладки как деактивированные", async () => {
    chrome._mock.addTab({ id: 1, active: true });
    chrome._mock.addTab({ id: 2, active: false });
    chrome._mock.addTab({ id: 3, active: false });

    await resetDeactivationTimes();

    expect(lastDeactivationTimes.has(2)).toBe(true);
    expect(lastDeactivationTimes.has(3)).toBe(true);
    expect(lastDeactivationTimes.has(1)).toBe(false);
  });
});

describe("initActivityTracking", () => {
  it("регистрирует слушатели событий", async () => {
    expect(chrome.tabs.onActivated.addListener).not.toHaveBeenCalled();

    await initActivityTracking({ restore: false });

    expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled();
    expect(chrome.windows.onFocusChanged.addListener).toHaveBeenCalled();
    expect(chrome.tabs.onRemoved.addListener).toHaveBeenCalled();
    expect(chrome.tabs.onCreated.addListener).toHaveBeenCalled();
  });

  it("onActivated обновляет currentActiveTabId", async () => {
    chrome._mock.addTab({ id: 1, active: true });
    await resetAndInit();

    onActivatedCbs[0]({ tabId: 2, windowId: 1 });

    expect(getCurrentActiveTabId()).toBe(2);
  });

  it("onActivated записывает деактивацию предыдущей вкладки", async () => {
    chrome._mock.addTab({ id: 1, active: true });
    await resetAndInit();

    onActivatedCbs[0]({ tabId: 2, windowId: 1 });

    expect(lastDeactivationTimes.has(1)).toBe(true);
    expect(typeof lastDeactivationTimes.get(1)).toBe("number");
  });

  it("onRemoved удаляет запись о деактивации", async () => {
    lastDeactivationTimes.set(5, Date.now());
    await resetAndInit();

    onRemovedCbs[0](5);

    expect(lastDeactivationTimes.has(5)).toBe(false);
  });

  it("onRemoved сбрасывает currentActiveTabId если закрыта активная", async () => {
    chrome._mock.addTab({ id: 1, active: true });
    await resetAndInit();

    onRemovedCbs[0](1);

    expect(getCurrentActiveTabId()).toBeNull();
  });

  it("onCreated добавляет неактивную вкладку в деактивированные", async () => {
    await resetAndInit();

    onCreatedCbs[0]({ id: 42, active: false });

    expect(lastDeactivationTimes.has(42)).toBe(true);
  });

  it("onCreated делает активную вкладку текущей", async () => {
    chrome._mock.addTab({ id: 1, active: true });
    await resetAndInit();

    onCreatedCbs[0]({ id: 99, active: true });

    expect(getCurrentActiveTabId()).toBe(99);
  });
});

describe("waitForActivityReadiness", () => {
  it("возвращает true после initActivityTracking", async () => {
    const readyPromise = waitForActivityReadiness(100);
    await initActivityTracking({ restore: false });
    await expect(readyPromise).resolves.toBe(true);
  });
});
