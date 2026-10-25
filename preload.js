/**
 * Wi-Fi OFF Scheduler - Preload Script
 * Exposes a safe, restricted API to the renderer process via contextBridge.
 * Enforces contextIsolation: true, nodeIntegration: false.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Wi-Fi operations
  getWifiState: () => ipcRenderer.invoke('wifi:get-state'),
  getSavedProfiles: () => ipcRenderer.invoke('wifi:get-profiles'),
  disconnectWifi: () => ipcRenderer.invoke('wifi:disconnect'),
  connectWifi: (profile) => ipcRenderer.invoke('wifi:connect', profile),
  renewIp: () => ipcRenderer.invoke('wifi:renew-ip'),

  // Rule management
  getRules: () => ipcRenderer.invoke('rules:get-all'),
  saveRule: (rule) => ipcRenderer.invoke('rules:save', rule),
  deleteRule: (ruleId) => ipcRenderer.invoke('rules:delete', ruleId),
  runRuleNow: (ruleId) => ipcRenderer.invoke('rules:run-now', ruleId),
  duplicateRule: (ruleId) => ipcRenderer.invoke('rules:duplicate', ruleId),
  toggleRuleEnabled: (ruleId, enabled) => ipcRenderer.invoke('rules:toggle', ruleId, enabled),

  // Rules Import/Export
  exportRules: () => ipcRenderer.invoke('rules:export'),
  importRules: () => ipcRenderer.invoke('rules:import'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (updates) => ipcRenderer.invoke('settings:save', updates),

  // Activity Log
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  exportHistory: (format) => ipcRenderer.invoke('history:export', format),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  // Event Listeners from Main process
  onWifiStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('wifi:state-changed', handler);
    return () => ipcRenderer.removeListener('wifi:state-changed', handler);
  },

  onRulesUpdated: (callback) => {
    const handler = (_event, rules) => callback(rules);
    ipcRenderer.on('rules:updated', handler);
    return () => ipcRenderer.removeListener('rules:updated', handler);
  },

  onScheduleTicked: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('scheduler:ticked', handler);
    return () => ipcRenderer.removeListener('scheduler:ticked', handler);
  },

  onToastNotification: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:toast', handler);
    return () => ipcRenderer.removeListener('app:toast', handler);
  }
});
