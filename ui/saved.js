// ui/saved.js — панель "Замороженные" (список агрессивно закрытых вкладок).
// Рендер, сортировка, поиск, удаление и открытие сохранённой записи.

import { applyFavicon } from "../shared.js";
import { isSystemUrl, formatDuration } from "./dom.js";
import { sortSavedTabs } from "./state.js";

export function initSavedTabs(state, showToast) {
  const { el } = state;

  async function refreshSavedList() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" });
      state.savedTabsCache = res?.tabs || [];
      renderSavedList();
    } catch (err) {
      console.error("Ошибка загрузки сохранённых:", err);
    }
  }
  state.refreshSavedList = refreshSavedList;

  function renderSavedList() {
    const searchText = document.getElementById('savedSearch')?.value.toLowerCase() || '';
    let filtered = state.savedTabsCache;
    if (searchText) {
      filtered = filtered.filter(entry => {
        const title = (entry.title || entry.url).toLowerCase();
        const url = (entry.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    const sortedList = sortSavedTabs(filtered, state.currentSortSaved);
    // ✅ СЧЁТЧИК ТЕПЕРЬ ОТ ПОЛНОГО КЭША, А НЕ ОТ ФИЛЬТРОВАННОГО
    el.countSaved.textContent = state.savedTabsCache.length;
    el.savedList.replaceChildren();
    state.savedTimerRefs.clear();

    if (sortedList.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      empty.textContent = searchText ? 'Нет совпадений' : 'Список пуст. Здесь появятся полностью закрытые вкладки.';
      el.savedList.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const now = Date.now();
    for (const entry of sortedList) {
      const row = document.createElement("a");
      row.className = "tab-row";
      row.href = entry.url;
      row.title = `Кликните, чтобы открыть: ${entry.url}`;

      const isSystem = isSystemUrl(entry.url);
      const img = document.createElement("img");
      applyFavicon(img, entry.favIconUrl, isSystem);

      const title = document.createElement("span");
      title.className = "title";
      title.textContent = entry.title || entry.url;

      // 🔥 ИЗМЕНЕНИЕ: для системных тоже показываем время, добавляя префикс "Системная "
      const badge = document.createElement("span");
      badge.className = "badge frozen";
      const closedAt = typeof entry.closedAt === "number" ? entry.closedAt : now;
      const timeText = formatDuration(now - closedAt);
      badge.textContent = isSystem ? `Системная ❄ ${timeText}` : `❄ ${timeText}`;
      state.savedTimerRefs.set(entry.id, { badge, closedAt: entry.closedAt, isSystem });

      const delBtn = document.createElement("button");
      delBtn.className = "close-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Удалить из списка без открытия";
      delBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await chrome.runtime.sendMessage({ type: "delete-saved-frozen-tab", id: entry.id });
        await refreshSavedList();
      };

      row.append(img, title, badge, delBtn);
      row.onclick = async (e) => {
        if (e.target === delBtn) return;
        e.preventDefault();
        await chrome.runtime.sendMessage({ type: "open-saved-frozen-tab", id: entry.id });
        await refreshSavedList();
      };

      fragment.appendChild(row);
    }
    el.savedList.appendChild(fragment);
  }

  // ---- Очистить список ----
  document.getElementById('clearSavedBtn').addEventListener('click', async () => {
    if (!confirm("Очистить весь список сохранённых закрытых вкладок?")) return;
    await chrome.runtime.sendMessage({ type: "clear-saved-frozen-tabs" });
    await refreshSavedList();
    showToast("Список очищен");
  });

  // ---- Сортировка ----
  document.getElementById('savedSortControls').addEventListener('click', (e) => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const sort = btn.dataset.sort;
    if (sort === state.currentSortSaved) return;
    document.querySelectorAll('#savedSortControls .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.currentSortSaved = sort;
    renderSavedList();
  });

  // ---- Поиск ----
  document.getElementById('savedSearch').addEventListener('input', renderSavedList);
}