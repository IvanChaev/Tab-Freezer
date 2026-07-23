// ui/tabs.js — панель "Открытые вкладки": рендер, сортировка, поиск,
// кнопки "закрыть", "перейти" и "временно игнорировать сайт".

import { applyFavicon, normalizeDomain } from "../shared.js";
import { isSystemUrl } from "./dom.js";
import { sortOpenTabs, updateTabBadge } from "./state.js";

export function initOpenTabs(state, showToast) {
  const { el } = state;

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

  function renderTabList() {
    const searchText = document.getElementById('tabsSearch')?.value.toLowerCase() || '';
    let filtered = state.openTabsCache;
    if (searchText) {
      filtered = filtered.filter(tab => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    const sortedTabs = sortOpenTabs(filtered, state.currentSortTabs);
    // ✅ СЧЁТЧИК ТЕПЕРЬ ОТ ОБЩЕГО КЭША, НЕ ЗАВИСИТ ОТ ПОИСКА
    el.countActive.textContent = state.openTabsCache.length;
    el.tabList.replaceChildren();
    state.tabTimerRefs.clear();

    if (sortedTabs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = searchText ? 'Нет совпадений' : 'Нет открытых вкладок';
      el.tabList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const now = Date.now();
    for (const tab of sortedTabs) {
      const row = document.createElement("div");
      row.className = "tab-row";
      row.style.cursor = "pointer";
      row.title = `Кликните, чтобы перейти на вкладку: ${tab.title}`;

      const img = document.createElement("img");
      applyFavicon(img, tab.favIconUrl, isSystemUrl(tab.url));

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = tab.title;

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
        try {
          const hostname = new URL(tab.url).hostname;
          const domain = normalizeDomain(hostname);
          if (!domain) {
            showToast("Не удалось определить домен", true);
            return;
          }
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

      fragment.appendChild(row);
    }
    el.tabList.appendChild(fragment);
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