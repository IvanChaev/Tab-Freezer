// @ts-check
// tests/bg/audio-cache.test.js — прямое покрытие буфера аудио-статуса.
//
// ВАЖНО про time-зависимые кейсы: chrome.storage.session в моке живёт
// в замыкании createChromeMock() (tests/chrome-mock.js) и НЕ привязан
// к жизни конкретного импортированного модуля, поэтому он переживает
// vi.resetModules() внутри одного теста (имитация рестарта service worker).
//
// Фейковые таймеры включаются локально в этом файле (глобальный
// tests/setup.js их не использует) и отключаются в afterEach.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  updateAudioCache,
  isTabAudibleWithBuffer,
  removeFromAudioCache,
  cleanAudioCache,
} from "../../bg/audio-cache.js";

// Значение константы AUDIO_BUFFER_MS из bg/audio-cache.js.
const AUDIO_BUFFER_MS = 90000;
// Старый (баговый) буфер — 10 сек, на его месте тест-регрессия из п. d.
const OLD_BUFFER_MS = 10000;

const SESSION_KEY = "audioCacheTimes";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isTabAudibleWithBuffer", () => {
  it("a: возвращает true, если currentAudible === true, независимо от кэша", async () => {
    await expect(isTabAudibleWithBuffer(1, true)).resolves.toBe(true);
    // Даже после очистки хранилища (пустой кэш) — true.
    await chrome.storage.session.remove(SESSION_KEY);
    await expect(isTabAudibleWithBuffer(2, true)).resolves.toBe(true);
  });

  it("b: после true метка сохраняется, следующий вызов с false сразу возвращает true", async () => {
    await isTabAudibleWithBuffer(1, true);

    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(true);
  });

  it("c: возвращает false, если с последнего true прошло больше AUDIO_BUFFER_MS", async () => {
    await updateAudioCache(1, true);

    vi.advanceTimersByTime(AUDIO_BUFFER_MS + 1);

    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(false);
  });

  it("d: регрессия бага — непрерывный звук с перерывом рекламы не даёт заморозить", async () => {
    // Долгая непрерывная трансляция: метка обновлена один раз (как было
    // в onUpdated), затем звук кратковременно пропал (audible === false).
    // Продвигаем время БОЛЬШЕ старого буфера (10 сек), но МЕНЬШЕ нового (90 сек):
    // со старым буфером вкладка была бы признана беззвучной и заморожена.
    await updateAudioCache(1, true);

    vi.advanceTimersByTime(OLD_BUFFER_MS + 1);
    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(true);

    vi.advanceTimersByTime(AUDIO_BUFFER_MS - (OLD_BUFFER_MS + 1) - 1);
    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(true);
  });
});

describe("перезапуск service worker", () => {
  it("e: метка переживает vi.resetModules() — читается из chrome.storage.session", async () => {
    await updateAudioCache(1, true);

    // Имитация холодного старта воркера: чистим реестр модулей и
    // заново импортируем audio-cache — in-memory Map будет пустой,
    // но chrome.storage.session сохранил метку.
    vi.resetModules();
    const freshModule = await import("../../bg/audio-cache.js");

    await expect(
      freshModule.isTabAudibleWithBuffer(1, false),
    ).resolves.toBe(true);
  });
});

describe("cleanAudioCache / removeFromAudioCache", () => {
  it("f: cleanAudioCache удаляет записи старше AUDIO_BUFFER_MS из storage.session", async () => {
    await updateAudioCache(1, true);
    await updateAudioCache(2, true);

    const { [SESSION_KEY]: before } = await chrome.storage.session.get(SESSION_KEY);
    expect(before).toEqual({ 1: expect.any(Number), 2: expect.any(Number) });

    // Протухает только первая запись.
    vi.advanceTimersByTime(AUDIO_BUFFER_MS + 1);
    await updateAudioCache(2, true);

    await cleanAudioCache();

    const { [SESSION_KEY]: after } = await chrome.storage.session.get(SESSION_KEY);
    expect(after).toEqual({ 2: expect.any(Number) });
    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(false);
  });

  it("g: removeFromAudioCache удаляет запись и это отражается в storage.session", async () => {
    await updateAudioCache(1, true);

    await removeFromAudioCache(1);

    const { [SESSION_KEY]: after } = await chrome.storage.session.get(SESSION_KEY);
    expect(after).toEqual({});
    await expect(isTabAudibleWithBuffer(1, false)).resolves.toBe(false);
  });
});
