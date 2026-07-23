// ui/dom.js — мелкие DOM-утилиты, общие для разных панелей дашборда.

import { isSystemUrl } from "../shared.js";

// Реэкспортируем для совместимости с существующими импортами
export { isSystemUrl };

/**
 * Компактный формат "как давно": секунды/минуты:секунды/часы:мин:сек/дни.
 */
export function formatDuration(ms) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `0:${String(totalSec).padStart(2, "0")}`;
  const days = Math.floor(totalSec / 86400);
  if (days >= 1) return `${days} дн.`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Делает из #toast функцию showToast(message, isError?), которую удобно
 * таскать замыканием по модулям.
 */
export function makeToast(toastEl) {
  return function showToast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.style.backgroundColor = isError ? 'var(--danger)' : 'var(--accent)';
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 3000);
  };
}