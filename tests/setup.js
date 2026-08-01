// @ts-check
// tests/setup.js — глобальная настройка vitest: мок chrome.* API

import { vi, beforeEach, afterEach } from "vitest";
import { createChromeMock } from "./chrome-mock.js";
import { __resetForTests as resetAudioCache } from "../bg/audio-cache.js";

/** @type {ReturnType<typeof createChromeMock>} */
let currentMock;

beforeEach(() => {
  currentMock = createChromeMock();
  vi.stubGlobal("chrome", currentMock);
  resetAudioCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
