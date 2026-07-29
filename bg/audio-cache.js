// @ts-check
// bg/audio-cache.js — буфер для аудио-статуса вкладок

/** @type {Map<number, number>} */
const audioCache = new Map();
const AUDIO_BUFFER_MS = 10000;

/**
 * Обновить кеш при изменении аудио-статуса вкладки
 * @param {number} tabId
 * @param {boolean} audible
 */
export function updateAudioCache(tabId, audible) {
  if (audible) {
    audioCache.set(tabId, Date.now());
  }
}

/**
 * Проверить, считается ли вкладка «имеющей звук» с учётом буфера
 * @param {number} tabId
 * @param {boolean|undefined} currentAudible
 * @returns {boolean}
 */
export function isTabAudibleWithBuffer(tabId, currentAudible) {
  if (currentAudible) return true;
  const lastTrue = audioCache.get(tabId);
  if (!lastTrue) return false;
  return (Date.now() - lastTrue) < AUDIO_BUFFER_MS;
}

/**
 * Удалить запись при закрытии вкладки
 * @param {number} tabId
 */
export function removeFromAudioCache(tabId) {
  audioCache.delete(tabId);
}

/**
 * Очистка устаревших записей
 */
export function cleanAudioCache() {
  const now = Date.now();
  for (const [tabId, time] of audioCache) {
    if (now - time > AUDIO_BUFFER_MS) {
      audioCache.delete(tabId);
    }
  }
}