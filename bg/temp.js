// bg/temp.js — временные исключения для доменов.
// Хранятся в chrome.storage.local.tempExemptions как [{ domain, expiry }].
// "Просроченные" записи автоматически вычищаются при чтении.

import { withStorageLock } from "./storage.js";

async function getTempExemptions() {
  const data = await chrome.storage.local.get("tempExemptions");
  return data.tempExemptions || [];
}

async function setTempExemptionsUnlocked(exemptions) {
  await chrome.storage.local.set({ tempExemptions: exemptions });
}

async function setTempExemptions(exemptions) {
  return withStorageLock(() => setTempExemptionsUnlocked(exemptions));
}

/**
 * Проверяет, есть ли активное временное исключение для данного hostname.
 * Заодно чистит просроченные записи из хранилища, если такие есть.
 *
 * ВАЖНО: эта функция вызывается из freeze.js изнутри runFreezeCheck, который
 * уже держит withStorageLock — поэтому здесь используется НЕзалоченная запись
 * (setTempExemptionsUnlocked), иначе получился бы дедлок мьютекса.
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