// @ts-check
// bg/temp.js — временные исключения для доменов.

import { withStorageLock } from "./storage.js";

/**
 * @returns {Promise<import("../types.js").TempExemption[]>}
 */
async function getTempExemptions() {
  const data = await chrome.storage.local.get("tempExemptions");
  return /** @type {import("../types.js").TempExemption[]} */ (data.tempExemptions || []);
}

/**
 * Версия БЕЗ мьютекса — только для использования внутри уже захваченного withStorageLock.
 * @param {import("../types.js").TempExemption[]} exemptions
 */
export async function setTempExemptionsUnlocked(exemptions) {
  await chrome.storage.local.set({ tempExemptions: exemptions });
}

/**
 * Версия С мьютексом — для использования извне.
 * @param {import("../types.js").TempExemption[]} exemptions
 */
async function setTempExemptions(exemptions) {
  return withStorageLock(() => setTempExemptionsUnlocked(exemptions));
}

/**
 * Проверяет, есть ли активное временное исключение для данного hostname.
 * @param {string} hostname
 * @returns {Promise<boolean>}
 */
async function isTempExempted(hostname) {
  if (!hostname) return false;
  const exemptions = await getTempExemptions();
  const now = Date.now();
  const active = exemptions.filter(e => e.expiry > now);
  if (active.length !== exemptions.length) {
    await setTempExemptionsUnlocked(active);
  }
  return active.some(e => hostname === e.domain || hostname.endsWith("." + e.domain));
}

export { getTempExemptions, setTempExemptions, isTempExempted };