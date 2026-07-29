// @ts-check
// ui/tabs.js — панель "Открытые вкладки": рендер, сортировка, поиск,
// кнопки "закрыть", "перейти" и "временно игнорировать сайт".

import { applyFavicon, normalizeDomain, tryGetHostname } from "../shared.js";
import { isSystemUrl } from "./dom.js";
import { sortOpenTabs, updateTabBadge } from "./state.js";
import { VirtualList } from "./virtual-list.js";

const TAB_ROW_HEIGHT = 56;

/**
 * @param {import("../types.js").UIState} state
 * @param {(message: string, isError?: boolean) => void} showToast
 */
export function initOpenTabs(state, showToast) {
  const { el } = state;

  /** @type {VirtualList<import("../types.js").TabInfo>|null} */
  let virtualList = null;

  async function refreshTabList() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-tab-list" });
      state.openTabsCache = res?.tabs || [];
      renderTabList();
    } catch (err) {
      console.error("Ошибка загрузки вкладок:", err);
    }
  }
  state.refreshTabList = refreshTabList;

  function getFilteredTabs() {
    const searchText = document.getElementById('tabsSearch')?.value.toLowerCase() || '';
    let filtered = state.openTabsCache;
    if (searchText) {
      filtered = filtered.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    return sortOpenTabs(filtered, state.currentSortTabs);
  }

  function renderTabList() {
    const sortedTabs = getFilteredTabs();
    el.countActive.textContent = state.openTabsCache.length;

    if (sortedTabs.length === 0) {
      if (virtualList) {
        virtualList.destroy();
        virtualList = null;
      }
      el.tabList.replaceChildren();
      el.tabList.style.display = '';
      el.tabList.style.overflowY = '';
      el.tabList.style.position = '';
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      const searchText = document.getElementById('tabsSearch')?.value || '';
      empty.textContent = searchText ? 'Нет совпадений' : 'Нет открытых вкладок';
      el.tabList.appendChild(empty);
      return;
    }

    if (!virtualList) {
      virtualList = new VirtualList(el.tabList, {
        rowHeight: TAB_ROW_HEIGHT,
        renderItem: createTabRow,
        onItemUnrender: cleanupTabRow,
      });
    }
    virtualList.setItems(sortedTabs);
  }

  /**
   * @param {import("../types.js").TabInfo} tab
   * @param {number} _index
   * @returns {HTMLElement}
   */
  function createTabRow(tab, _index) {
    const now = Date.now();
    const row = document.createElement("div");
    row.className = "tab-row";
    row.style.cursor = "pointer";
    row.title = `Кликните, чтобы перейти на вкладку: ${tab.title || ''}`;

    const img = document.createElement("img");
    applyFavicon(img, tab.favIconUrl, isSystemUrl(tab.url));

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title || tab.url || '';

    const badge = document.createElement("span");
    badge.className = `badge ${tab.discarded ? 'frozen' : ''}`;
    updateTabBadge(badge, tab, now);
    state.tabTimerRefs.set(tab.id, { badge, tab });

    const tempBtn = document.createElement("button");
    tempBtn.textContent = "⏱";
    tempBtn.title = "Временно игнорировать этот сайт";
    tempBtn.style.cssText = "background:transparent; border:none; color:var(--accent); cursor:pointer; font-size:0.9rem; padding:0 4px;";
    tempBtn.onclick = async (e) => {
      e.stopPropagation();
      const duration = prompt("Введите время в минутах (15, 60, 120, 240, 1440):", "60");
      if (!duration) return;
      const minutes = parseInt(duration, 10);
      if (isNaN(minutes) || minutes <= 0) {
        showToast("Некорректное значение", true);
        return;
      }
      if (!tab.url) {
        showToast("Не удалось определить URL", true);
        return;
      }
      const hostname = tryGetHostname(tab.url);
      if (!hostname) {
        showToast("Некорректный URL", true);
        return;
      }
      const domain = normalizeDomain(hostname);
      if (!domain) {
        showToast("Не удалось определить домен", true);
        return;
      }
      try {
        await chrome.runtime.sendMessage({ type: "add-temp-exemption", domain, durationMinutes: minutes });
        showToast(`Домен ${domain} игнорируется ${minutes} мин.`);
        state.refreshTempExemptions?.();
      } catch (err) {
        showToast("Ошибка добавления исключения", true);
      }
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "Закрыть вкладку";
    closeBtn.onclick = async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ type: "close-tab", tabId: tab.id });
      await refreshTabList();
      state.refreshStats?.();
    };

    row.append(img, title, badge, tempBtn, closeBtn);

    row.onclick = async (e) => {
      if (e.target === closeBtn || e.target === tempBtn) return;
      await chrome.runtime.sendMessage({ type: "activate-tab", tabId: tab.id, windowId: tab.windowId });
    };

    return row;
  }

  /**
   * @param {import("../types.js").TabInfo} tab
   */
  function cleanupTabRow(tab) {
    state.tabTimerRefs.delete(tab.id);
  }

  // ---- "Заморозить неактивные сейчас" ----
  document.getElementById('freezeAllBtn').addEventListener('click', async () => {
    const res = await chrome.runtime.sendMessage({ type: "freeze-now" });
    showToast(`Обработано вкладок: ${res?.frozen || 0}`);
    await refreshTabList();
    state.refreshStats?.();
  });

  // ---- Сортировка ----
  document.getElementById('tabsSortControls').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const sort = btn.dataset.sort;
    if (sort === state.currentSortTabs) return;
    document.querySelectorAll('#tabsSortControls .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentSortTabs = sort;
    renderTabList();
  });

  // ---- Поиск ----
  document.getElementById('tabsSearch').addEventListener('input', renderTabList);
}