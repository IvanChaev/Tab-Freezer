// @ts-check
// bg/lock.js — мьютекс для последовательного доступа к chrome.storage.local.

import { STORAGE_LOCK_TIMEOUT_MS } from "../shared.js";

/** @type {Promise<void>} */
let _storageMutex = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {number} [timeoutMs=STORAGE_LOCK_TIMEOUT_MS]
 * @returns {Promise<T>}
 */
export function withStorageLock(task, timeoutMs = STORAGE_LOCK_TIMEOUT_MS) {
  const run = _storageMutex.then(() => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Storage lock timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      task()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  });

  _storageMutex = run.then(() => {}, () => {});
  return run;
}
