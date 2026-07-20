const fileInput = document.getElementById("fileInput");
const status = document.getElementById("status");

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const settings = JSON.parse(text);

    // Проверяем не только наличие ключей, но и их типы: битый файл с,
    // например, whitelist-строкой вместо массива иначе сохранится как есть
    // и уронит background.js (isWhitelisted -> whitelist.some) при следующей
    // проверке вкладок.
    const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
    const isBoolean = (v) => typeof v === "boolean";
    const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

    const validators = {
      timeoutMinutes: isFiniteNumber,
      closeOldMinutes: isFiniteNumber,
      autoClose: isBoolean,
      excludePinned: isBoolean,
      excludeAudio: isBoolean,
      whitelist: isStringArray
    };

    const isValid =
      settings &&
      typeof settings === "object" &&
      Object.entries(validators).every(([key, check]) => key in settings && check(settings[key]));
    if (!isValid) throw new Error("Неверный формат файла");

    const response = await chrome.runtime.sendMessage({ type: "save-settings", settings });
    if (response?.ok) {
      status.textContent = "Настройки импортированы ✓ Можно закрыть эту вкладку и открыть попап заново.";
      status.classList.remove("status-error");
    } else {
      throw new Error("Ошибка сохранения");
    }
  } catch (err) {
    status.textContent = "Ошибка импорта: файл повреждён или неверного формата ✗";
    status.classList.add("status-error");
    console.error(err);
  }
});