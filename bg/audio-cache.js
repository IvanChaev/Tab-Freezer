// @ts-check
// bg/audio-cache.js — буфер для аудио-статуса вкладок
//
// ВАЖНО: раньше буфер хранился в обычном Map() в памяти сервис-воркера.
// В MV3 воркер убивается через ~30 сек простоя и стартует заново на
// каждый alarm/событие. Обычная переменная при этом обнуляется, поэтому
// ровно в момент периодической проверки (runFreezeCheck), которая как раз
// и запускает "холодный" воркер, буфер почти всегда оказывался пустым —
// и если у вкладки (например, Twitch) в этот самый миг audible временно
// было false (реклама/буферизация/смена сегмента потока), защита
// excludeAudio не срабатывала.
//
// Теперь состояние хранится в chrome.storage.session — оно живёт всё
// время работы браузера и переживает перезапуски сервис-воркера,
// сбрасываясь только при закрытии браузера или перезагрузке расширения.

const STORAGE_KEY = "audioCacheTimes";
// Увеличено с 10 сек: буфер должен с запасом перекрывать интервал между
// проверками (ALARM_PERIOD_MINUTES = 1 мин в shared.js), т.к. основной
// источник обновления метки — периодическая "развёртка" в freeze.js
// (см. ниже), а не только событие onUpdated.
const AUDIO_BUFFER_MS = 90000;

/**
 * In-memory зеркало chrome.storage.session — чтобы не дёргать storage
 * на каждый синхронный вызов в рамках одного "пробуждения" воркера.
 * Источник истины — storage.session, это зеркало лишь кэш поверх него.
 * @type {Map<number, number>}
 */
let memCache = new Map();
let hydrated = false;
/** @type {Promise<void>|null} */
let hydrationPromise = null;

/**
 * Подтягивает состояние из chrome.storage.session при первом обращении
 * в рамках текущего "пробуждения" воркера.
 * @returns {Promise<void>}
 */
function hydrate() {
  if (hydrated) return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const data = await chrome.storage.session.get(STORAGE_KEY);
      const obj = /** @type {Record<string, number>} */ (data[STORAGE_KEY] || {});
      memCache = new Map(Object.entries(obj).map(([id, t]) => [Number(id), t]));
    } catch (e) {
      console.error("Не удалось восстановить audioCache из storage.session:", e);
      memCache = new Map();
    } finally {
      hydrated = true;
    }
  })();

  return hydrationPromise;
}

/**
 * Сохраняет текущее состояние memCache в chrome.storage.session.
 * @returns {Promise<void>}
 */
async function persist() {
  /** @type {Record<string, number>} */
  const obj = {};
  for (const [id, t] of memCache) obj[id] = t;

  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch (e) {
    console.error("Не удалось сохранить audioCache в storage.session:", e);
  }
}

/**
 * Обновить кеш при изменении аудио-статуса вкладки
 * @param {number} tabId
 * @param {boolean} audible
 * @returns {Promise<void>}
 */
export async function updateAudioCache(tabId, audible) {
  if (!audible) return;
  await hydrate();
  memCache.set(tabId, Date.now());
  await persist();
}

/**
 * Проверить, считается ли вкладка «имеющей звук» с учётом буфера
 * @param {number} tabId
 * @param {boolean|undefined} currentAudible
 * @returns {Promise<boolean>}
 */
export async function isTabAudibleWithBuffer(tabId, currentAudible) {
  if (currentAudible) {
    // ВАЖНО: обновляем метку прямо здесь, а не только в onUpdated-листенере.
    // onUpdated стреляет лишь при СМЕНЕ audible, поэтому для вкладки,
    // которая играет непрерывно долго (типичный случай для Twitch),
    // без этой строчки в кэше годами лежала бы метка "стала слышна"
    // с момента самого первого перехода false→true — и как только
    // звук хоть на миг прервётся, буфер уже "просрочен" по построению.
    await hydrate();
    memCache.set(tabId, Date.now());
    persist().catch(e => console.error("audioCache persist error:", e));
    return true;
  }

  await hydrate();
  const lastTrue = memCache.get(tabId);
  if (!lastTrue) return false;
  return (Date.now() - lastTrue) < AUDIO_BUFFER_MS;
}

/**
 * Удалить запись при закрытии вкладки
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function removeFromAudioCache(tabId) {
  await hydrate();
  if (memCache.delete(tabId)) {
    await persist();
  }
}

/**
 * Очистка устаревших записей
 * @returns {Promise<void>}
 */
export async function cleanAudioCache() {
  await hydrate();
  const now = Date.now();
  let changed = false;

  for (const [tabId, time] of memCache) {
    if (now - time > AUDIO_BUFFER_MS) {
      memCache.delete(tabId);
      changed = true;
    }
  }

  if (changed) await persist();
}

/**
 * Сбрасывает внутреннее module-scope состояние. ТОЛЬКО для тестов.
 *
 * Модуль импортируется один раз на тестовый файл и переиспользуется во
 * всех тестах внутри него (ES-модули кэшируются). tests/setup.js создаёт
 * новый chrome-мок с чистым storage.session в каждом beforeEach, но без
 * этого сброса старый memCache "переживает" в память следующего теста —
 * а т.к. chrome-mock.js нумерует id вкладок с одного числа в каждом
 * тесте, это давало ложные срабатывания буфера "звук был" между
 * тестами, использующими одинаковый tabId.
 * @returns {void}
 */
export function __resetForTests() {
  memCache = new Map();
  hydrated = false;
  hydrationPromise = null;
}
