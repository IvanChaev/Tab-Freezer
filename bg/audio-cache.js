// bg/audio-cache.js

/** Хранит время последнего переключения аудио на true для каждой вкладки */
const audioCache = new Map();
const AUDIO_BUFFER_MS = 10000; // 10 секунд

/**
 * Обновить кеш при изменении аудио-статуса вкладки
 */
export function updateAudioCache(tabId, audible) {
  if (audible) {
    audioCache.set(tabId, Date.now());
  } else {
    // Если аудио выключено, мы НЕ удаляем запись, чтобы сохранить время последнего включения.
    // Запись будет удалена при закрытии вкладки или по истечении буфера (см. ниже).
  }
}

/**
 * Проверить, считается ли вкладка «имеющей звук» с учётом буфера
 */
export function isTabAudibleWithBuffer(tabId, currentAudible) {
  if (currentAudible) return true;
  const lastTrue = audioCache.get(tabId);
  if (!lastTrue) return false;
  return (Date.now() - lastTrue) < AUDIO_BUFFER_MS;
}

/**
 * Удалить запись при закрытии вкладки (вызывать в onRemoved)
 */
export function removeFromAudioCache(tabId) {
  audioCache.delete(tabId);
}

/**
 * Очистка устаревших записей (можно вызывать периодически, но не обязательно)
 */
export function cleanAudioCache() {
  const now = Date.now();
  for (const [tabId, time] of audioCache) {
    if (now - time > AUDIO_BUFFER_MS) {
      audioCache.delete(tabId);
    }
  }
}