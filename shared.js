// shared.js
// Общие функции, используемые и в background.js (через importScripts),
// и в popup.js (через <script src="shared.js">) — чтобы логика
// нормализации доменов не расходилась между двумя копиями.

function normalizeDomain(domain) {
  let d = String(domain).trim().toLowerCase();

  // Убираем протокол (http://, https://, ftp:// и т.п.), если он есть —
  // иначе домен, скопированный из адресной строки вместе со схемой,
  // никогда не совпадёт с tab.url и вкладка не попадёт в белый список.
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");

  // Убираем всё, что идёт после хоста: путь, query, hash, порт.
  d = d.split("/")[0].split("?")[0].split("#")[0].split(":")[0];

  d = d.replace(/^\.+/, "").replace(/\.+$/, "");
  if (d.startsWith("*.")) {
    d = d.slice(2);
  }
  if (d.startsWith("www.")) {
    d = d.slice(4);
  }
  return d;
}
