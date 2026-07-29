/**
 * @file Глобальные JSDoc-типы проекта Tab Freezer.
 * Этот файл не содержит исполняемого кода — только декларации типов.
 */

/**
 * @typedef {Object} Settings
 * @property {number}  timeoutMinutes         Тайм-аут неактивности (минуты)
 * @property {number}  closeOldMinutes        Время удаления старых записей (минуты)
 * @property {boolean} autoClose              Авто-удаление старых записей
 * @property {boolean} excludePinned          Не трогать закреплённые вкладки
 * @property {boolean} excludeAudio           Не трогать вкладки со звуком
 * @property {boolean} aggressiveFreeze       Полная заморозка (закрывать вместо discard)
 * @property {string[]} whitelist             Белый список доменов
 * @property {boolean} fullFreezeSystemPages  Разрешить заморозку системных страниц
 * @property {string[]} systemFreezeList      Список префиксов системных URL для заморозки
 */

/**
 * @typedef {Object} TabInfo
 * @property {number}  id
 * @property {string}  [url]
 * @property {string}  [title]
 * @property {string}  [favIconUrl]
 * @property {boolean} active
 * @property {boolean} [discarded]
 * @property {boolean} [pinned]
 * @property {boolean} [audible]
 * @property {number}  [lastAccessed]
 * @property {number}  windowId
 * @property {number}  [index]
 * @property {number}  [lastActiveTime]       Обогащённое поле — время последней активности
 */

/**
 * @typedef {Object} SavedEntry
 * @property {string} id          Уникальный UUID
 * @property {string} url
 * @property {string} title
 * @property {string} favIconUrl
 * @property {number} closedAt    timestamp закрытия
 */

/**
 * @typedef {Object} LogEntry
 * @property {number} timestamp
 * @property {string} action
 * @property {string} details
 */

/**
 * @typedef {Object} TempExemption
 * @property {string} domain
 * @property {number} expiry      timestamp истечения
 */

/**
 * @typedef {Object} PopupStats
 * @property {number} total
 * @property {number} discarded
 * @property {number} saved
 * @property {number} totalFrozen
 */

// ─── Сообщения (request / response) ───

/**
 * @typedef {Object} StatsResponse
 * @property {number} total
 * @property {number} discarded
 * @property {number} saved
 * @property {number} totalFrozen
 */

/**
 * @typedef {Object} TabListResponse
 * @property {TabInfo[]} tabs
 */

/**
 * @typedef {Object} OkResponse
 * @property {boolean} ok
 * @property {string} [error]
 */

/**
 * @typedef {Object} FreezeResponse
 * @property {number} frozen
 */

/**
 * @typedef {Object} SavedTabsResponse
 * @property {SavedEntry[]} tabs
 */

/**
 * @typedef {Object} LogsResponse
 * @property {LogEntry[]} logs
 */

/**
 * @typedef {Object} TempExemptionsResponse
 * @property {TempExemption[]} exemptions
 */

// ─── DOM-ссылки дашборда ───

/**
 * @typedef {Object} DOMRefs
 * @property {NodeListOf<Element>} tabs
 * @property {NodeListOf<Element>} panes
 * @property {HTMLElement} savedList
 * @property {HTMLElement} tabList
 * @property {HTMLElement} logsContainer
 * @property {HTMLTextAreaElement} whitelistEditor
 * @property {HTMLElement} stats
 * @property {HTMLElement} countSaved
 * @property {HTMLElement} countActive
 * @property {HTMLElement} countTemp
 * @property {HTMLElement} toast
 * @property {HTMLInputElement} timeout
 * @property {HTMLInputElement} excludePinned
 * @property {HTMLInputElement} excludeAudio
 * @property {HTMLInputElement} aggressiveFreeze
 * @property {HTMLInputElement} autoClose
 * @property {HTMLInputElement} closeOldMinutes
 * @property {HTMLElement} totalFrozenCount
 * @property {HTMLElement} tempExemptionList
 * @property {HTMLInputElement} fullFreezeSystemPages
 * @property {HTMLTextAreaElement} systemFreezeListEditor
 */

/**
 * @typedef {'real'|'alphabet'|'state'} SortMode
 */

/**
 * @typedef {Object} TabTimerRef
 * @property {HTMLElement} badge
 * @property {TabInfo} tab
 */

/**
 * @typedef {Object} SavedTimerRef
 * @property {HTMLElement} badge
 * @property {number} closedAt
 * @property {boolean} isSystem
 */

/**
 * @typedef {Object} UIState
 * @property {DOMRefs} el
 * @property {SavedEntry[]} savedTabsCache
 * @property {TabInfo[]} openTabsCache
 * @property {SortMode} currentSortSaved
 * @property {SortMode} currentSortTabs
 * @property {Map<number, TabTimerRef>} tabTimerRefs
 * @property {Map<string, SavedTimerRef>} savedTimerRefs
 * @property {() => Promise<void>} loadSettings
 * @property {() => Promise<void>} refreshSavedList
 * @property {() => Promise<void>} refreshTabList
 * @property {() => Promise<void>} refreshStats
 * @property {() => Promise<void>} refreshStatsPanel
 * @property {() => Promise<void>} refreshTempExemptions
 * @property {() => Promise<void>} loadWhitelist
 * @property {() => Promise<void>} loadFullFreezeSettings
 * @property {() => Promise<void>} refreshLogs
 */

// ─── Chrome API расширения (полиморфный ответ) ───

/**
 * @typedef {Object} StorageData
 * @property {Settings} [settings]
 * @property {SavedEntry[]} [savedTabs]
 * @property {LogEntry[]} [logs]
 * @property {number} [totalFrozen]
 * @property {TempExemption[]} [tempExemptions]
 * @property {Record<string, number>} [tabDeactivationTimes]
 */

export default {};
