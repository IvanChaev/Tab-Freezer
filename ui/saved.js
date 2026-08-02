// @ts-check
// ui/saved.js — панель "Замороженные" (список агрессивно закрытых вкладок).
// Рендер, сортировка, поиск, удаление и открытие сохранённой записи.

import { applyFavicon } from "../shared.js";
import { isSystemUrl, formatDuration } from "./dom.js";
import { sortSavedTabs } from "./state.js";
import { VirtualList } from "./virtual-list.js";

const SAVED_ROW_HEIGHT = 56;

/**
 * @param {import("../types.js").UIState} state
 * @param {(message: string, isError?: boolean) => void} showToast
 */
export function initSavedTabs(state, showToast) {
  const { el } = state;

  /** @type {VirtualList<import("../types.js").SavedEntry>|null} */
  let virtualList = null;

  // Номер последнего запроса. Если ответ пришёл после более нового запроса —
  // он устарел, и его нельзя применять (иначе пустой список мог бы
  // "перезатереть" свежие данные и надпись "Список пуст" не исчезла бы).
  let savedRequestSeq = 0;

  async function refreshSavedList() {
    const seq = ++savedRequestSeq;
    try {
      const res = await chrome.runtime.sendMessage({ type: "get-saved-frozen-tabs" });
      if (seq !== savedRequestSeq) return;
      state.savedTabsCache = res?.tabs || [];
      renderSavedList();
    } catch (err) {
      console.error("Ошибка загрузки сохранённых:", err);
    }
  }
  state.refreshSavedList = refreshSavedList;

  function getFilteredSaved() {
    const searchText = document.getElementById('savedSearch')?.value.toLowerCase() || '';
    let filtered = state.savedTabsCache;
    if (searchText) {
      filtered = filtered.filter(entry => {
        const title = (entry.title || entry.url).toLowerCase();
        const url = (entry.url || '').toLowerCase();
        return title.includes(searchText) || url.includes(searchText);
      });
    }
    return sortSavedTabs(filtered, state.currentSortSaved);
  }

  function renderSavedList() {
    const sortedList = getFilteredSaved();
    el.countSaved.textContent = state.savedTabsCache.length;

    if (sortedList.length === 0) {
      if (virtualList) {
        virtualList.destroy();
        virtualList = null;
      }
      el.savedList.replaceChildren();
      el.savedList.style.display = '';
      el.savedList.style.overflowY = '';
      el.savedList.style.position = '';
      const empty = document.createElement('div');
      empty.className = 'tab-row';
      empty.style.justifyContent = 'center';
      empty.style.color = 'var(--text-muted)';
      const searchText = document.getElementById('savedSearch')?.value || '';
      empty.textContent = searchText ? 'Нет совпадений' : 'Список пуст. Здесь появятся полностью закрытые вкладки.';
      el.savedList.appendChild(empty);
      return;
    }

    if (!virtualList) {
      virtualList = new VirtualList(el.savedList, {
        rowHeight: SAVED_ROW_HEIGHT,
        renderItem: createSavedRow,
        onItemUnrender: cleanupSavedRow,
      });
    }
    virtualList.setItems(sortedList);
  }

  /**
   * @param {import("../types.js").SavedEntry} entry
   * @param {number} _index
   * @returns {HTMLElement}
   */
  function createSavedRow(entry, _index) {
    const now = Date.now();
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

    return row;
  }

  /**
   * @param {import("../types.js").SavedEntry} entry
   */
  function cleanupSavedRow(entry) {
    state.savedTimerRefs.delete(entry.id);
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