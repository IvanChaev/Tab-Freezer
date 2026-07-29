// @ts-check
import { describe, it, expect } from "vitest";
import { withStorageLock } from "../../bg/lock.js";

describe("withStorageLock", () => {
  it("выполняет задачу", async () => {
    const result = await withStorageLock(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("сохраняет порядок при конкурентных вызовах", async () => {
    const order = [];

    const p1 = withStorageLock(async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(1);
    });

    const p2 = withStorageLock(() => {
      order.push(2);
      return Promise.resolve();
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it("пробрасывает ошибку из задачи", async () => {
    await expect(
      withStorageLock(() => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });

  it("не блокирует очередь после ошибки", async () => {
    const err = withStorageLock(() => Promise.reject(new Error("fail")));
    const ok = withStorageLock(() => Promise.resolve("ok"));

    await expect(err).rejects.toThrow("fail");
    await expect(ok).resolves.toBe("ok");
  });

  it("таймаут прерывает ожидание", async () => {
    const slow = withStorageLock(
      () => new Promise(() => {}),
      50,
    );

    await expect(slow).rejects.toThrow("Storage lock timeout");
  });
});
