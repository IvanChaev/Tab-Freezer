// @ts-check
// ui/virtual-list.js — виртуальный скролл для больших списков

import { OVERSCAN_COUNT, LIST_MIN_HEIGHT } from "../shared.js";

/**
 * Виртуальный скроллер, рендерящий только видимые + overscan элементы.
 *
 * @template T
 */
export class VirtualList {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   rowHeight: number,
   *   overscan?: number,
   *   renderItem: (item: T, index: number) => HTMLElement,
   *   onItemUnrender?: (item: T, index: number) => void,
   * }} options
   */
  constructor(container, options) {
    this.container = container;
    this.rowHeight = options.rowHeight;
    this.overscan = options.overscan ?? OVERSCAN_COUNT;
    this.renderItem = options.renderItem;
    this.onItemUnrender = options.onItemUnrender ?? (() => {});

    /** @type {T[]} */
    this.items = [];
    /** @type {Map<number, { el: HTMLElement, item: T }>} */
    this.rendered = new Map();

    this.container.style.display = 'block';
    this.container.style.overflowY = 'auto';
    this.container.style.position = 'relative';

    this._spacer = document.createElement('div');
    this.container.prepend(this._spacer);

    this._onScroll = this._onScroll.bind(this);
    this.container.addEventListener('scroll', this._onScroll, { passive: true });
  }

  /**
   * Полностью перезагружает список с новыми элементами.
   * @param {T[]} items
   */
  setItems(items) {
    this._clearRendered();
    this.items = items;
    this.container.scrollTop = 0;
    this._render();
  }

  /**
   * Перерендер без изменения данных (например, после ресайза).
   */
  refresh() {
    this._render();
  }

  destroy() {
    this.container.removeEventListener('scroll', this._onScroll);
    this._clearRendered();
    this._spacer.remove();
    this.container.style.display = '';
    this.container.style.overflowY = '';
    this.container.style.position = '';
  }

  _clearRendered() {
    for (const [idx, { el, item }] of this.rendered) {
      el.remove();
      this.onItemUnrender(item, idx);
    }
    this.rendered.clear();
  }

  _onScroll() {
    this._render();
  }

  _render() {
    const scrollTop = this.container.scrollTop;
    const containerHeight = Math.max(this.container.clientHeight, LIST_MIN_HEIGHT);
    const totalHeight = this.items.length * this.rowHeight;

    this._spacer.style.height = totalHeight + 'px';
    this._spacer.style.pointerEvents = 'none';

    const startIdx = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.overscan);
    const endIdx = Math.min(this.items.length, Math.ceil((scrollTop + containerHeight) / this.rowHeight) + this.overscan);

    // Удаляем элементы, вышедшие за пределы видимой области
    for (const [idx, { el, item }] of this.rendered) {
      if (idx < startIdx || idx >= endIdx) {
        el.remove();
        this.rendered.delete(idx);
        this.onItemUnrender(item, idx);
      }
    }

    // Создаём (или обновляем) элементы видимой области
    for (let i = startIdx; i < endIdx; i++) {
      if (this.rendered.has(i)) continue;

      const item = this.items[i];
      if (!item) continue;

      const el = this.renderItem(item, i);
      el.style.position = 'absolute';
      el.style.top = (i * this.rowHeight) + 'px';
      el.style.left = '0';
      el.style.right = '0';
      el.style.height = this.rowHeight + 'px';
      el.style.overflow = 'hidden';
      el.style.boxSizing = 'border-box';

      this.container.appendChild(el);
      this.rendered.set(i, { el, item });
    }
  }
}
