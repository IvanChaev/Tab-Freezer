// @ts-check
// tests/setup.js — глобальная настройка vitest: мок chrome.* API

import { vi } from "vitest";
import { createChromeMock } from "./chrome-mock.js";

/** @type {ReturnType<typeof createChromeMock>} */
let currentMock;

beforeEach(() => {
  currentMock = createChromeMock();
  vi.stubGlobal("chrome", currentMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
