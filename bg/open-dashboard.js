// bg/open-dashboard.js — открыть (или сфокусировать уже открытую) панель управления.

export async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL("dashboard.html");
  const tabs = await chrome.tabs.query({ url: dashboardUrl });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}