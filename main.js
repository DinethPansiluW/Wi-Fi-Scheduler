/**
 * Wi-Fi OFF Scheduler - Electron Main Process
 * Manages application lifecycle, frameless window, system tray, IPC handlers,
 * powerMonitor resume detection, and background scheduler coordination.
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  dialog,
  powerMonitor,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');

const { store } = require('./store');
const {
  getCurrentWifiState,
  getSavedProfiles,
  disconnectWifi,
  connectWifi,
  renewIp,
  executeRule
} = require('./wifi');
const {
  SchedulerRunner,
  computeNextRun,
  checkMissedRun
} = require('./scheduler');

let taskscheduler = null;
try {
  taskscheduler = require('./taskscheduler');
} catch (err) {
  console.warn('[Main] taskscheduler module load error:', err.message);
}

function getCliArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const headlessRuleId = getCliArg('--run-rule');
const reconnectSsid = getCliArg('--reconnect');
const reconnectRuleId = getCliArg('--rule-id');
const isHeadless = Boolean(headlessRuleId || reconnectSsid !== null);

if (isHeadless) {
  // Headless mode for Task Scheduler execution
  setTimeout(() => {
    app.quit();
    process.exit(0);
  }, 60000);

  app.whenReady().then(async () => {
    try {
      store.init();

      // Case 1: Reconnect task
      if (reconnectSsid !== null) {
        const res = await connectWifi(reconnectSsid);
        store.addHistoryEntry({
          ruleId: reconnectRuleId || null,
          ruleName: reconnectRuleId ? `Rule ${reconnectRuleId} (Auto-reconnect)` : 'Auto-reconnect',
          action: 'connect',
          result: res.success,
          message: `Auto-reconnected to "${reconnectSsid}": ${res.message}`
        });
        if (reconnectRuleId && taskscheduler) {
          await taskscheduler.deleteTask(`\\WiFiOffScheduler\\Reconnect_${reconnectRuleId}`);
        }
        return;
      }

      // Case 2: Run rule task
      const settings = store.getSettings();
      if (settings && settings.pauseAll) {
        console.log(`[Headless] Schedules are paused; skipping rule ${headlessRuleId}.`);
        return;
      }

      const rules = store.getRules();
      const rule = rules.find((r) => r.id === headlessRuleId);
      if (!rule || !rule.enabled || rule.completed) {
        console.log(`[Headless] Rule ${headlessRuleId} not eligible (missing, disabled, or completed).`);
        return;
      }

      const now = new Date();
      const catchUpMinutes = settings.catchUpMinutes || 10;
      const windowMs = catchUpMinutes * 60 * 1000;

      // For monthly day 29-31, only run on the clamped target day
      if (rule.when === 'monthly') {
        const targetDayConfig = parseInt(rule.dayOfMonth, 10) || 1;
        const maxDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const clampedTargetDay = Math.min(targetDayConfig, maxDaysInMonth);
        if (now.getDate() !== clampedTargetDay) {
          console.log(`[Headless] Today is day ${now.getDate()}, but clamped monthly target day is ${clampedTargetDay}. Skipping.`);
          return;
        }
      }

      // Check if this launch is within the catch-up window or on time
      let occurrence = checkMissedRun(rule, rule.lastRunKey || '', now, windowMs);
      if (!occurrence) {
        const nextRun = computeNextRun(rule, new Date(now.getTime() - 60000));
        if (nextRun && Math.abs(nextRun.getTime() - now.getTime()) <= 60000) {
          occurrence = nextRun;
        }
      }

      if (!occurrence) {
        console.log(`[Headless] Launch is outside allowed catch-up window of ${catchUpMinutes}m. Skipping.`);
        return;
      }

      const runKey = `${rule.id}_${occurrence.toISOString().slice(0, 16)}`;
      if (rule.lastRunKey === runKey) {
        console.log(`[Headless] Occurrence ${runKey} was already executed. Skipping duplicate.`);
        return;
      }

      // Execute with the existing wifi.executeRule
      const result = await executeRule(rule);

      rule.lastRunAt = new Date().toISOString();
      rule.lastRunResult = result.success ? 'success' : 'error';
      rule.lastRunMessage = result.message;
      rule.lastRunKey = runKey;

      if (rule.when === 'once') {
        rule.completed = true;
        rule.enabled = false;
        if (taskscheduler) {
          await taskscheduler.deleteTask(`\\WiFiOffScheduler\\Rule_${rule.id}`);
        }
      }

      store.addOrUpdateRule(rule);

      store.addHistoryEntry({
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action,
        result: result.success,
        message: result.message
      });

      // Auto-reconnect if configured
      if (
        result.success &&
        rule.action === 'disconnect' &&
        rule.autoReconnectMinutes > 0 &&
        taskscheduler
      ) {
        const reconnectProfile = rule.targetProfile || (rule.targetSsids && rule.targetSsids[0]);
        if (reconnectProfile) {
          await taskscheduler.scheduleReconnectTask(rule.id, reconnectProfile, rule.autoReconnectMinutes);
        }
      }
    } catch (err) {
      console.error('[Headless] Execution error:', err);
    } finally {
      app.quit();
      process.exit(0);
    }
  });
}

// Single-instance lock (GUI mode only)
if (!isHeadless) {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    process.exit(0);
  }
}

function triggerTaskSync() {
  if (process.platform !== 'win32' || !taskscheduler) return;
  try {
    const rules = store.getRules();
    const settings = store.getSettings();
    taskscheduler.syncAllTasks(rules, settings).catch((err) => {
      console.warn('[TaskScheduler] syncAllTasks background error:', err.message);
    });
  } catch (err) {
    console.warn('[TaskScheduler] triggerTaskSync error:', err.message);
  }
}

function setupStoreWatchers() {
  const dir = store.getDataDir();
  let debounceTimer = null;
  const notifyUpdated = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const rules = store.getRules();
        mainWindow.webContents.send('rules:updated', rules);
      }
    }, 300);
  };

  try {
    fs.watch(dir, (_eventType, filename) => {
      if (filename && (filename.includes('rules.json') || filename.includes('history.json'))) {
        notifyUpdated();
      }
    });
  } catch (err) {
    console.warn('[Main] Store directory watcher failed:', err.message);
  }
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let lastKnownWifiState = null;
let wifiPollInterval = null;
let schedulerRunner = null;

// Initialize app store early
store.init();

/**
 * Creates dynamic SVG icon or loads native icon for tray / window.
 */
function createTrayIcon() {
  const icoPath = path.join(__dirname, 'build', 'icon.ico');
  const pngPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(icoPath)) {
    try {
      return nativeImage.createFromPath(icoPath);
    } catch {}
  }
  if (fs.existsSync(pngPath)) {
    try {
      return nativeImage.createFromPath(pngPath);
    } catch {}
  }

  // Fallback 16x16 icon created from PNG buffer or empty
  return nativeImage.createEmpty();
}

/**
 * Creates the main application window.
 */
function createWindow() {
  const settings = store.getSettings();

  mainWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 440,
    minHeight: 560,
    center: true,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: settings.theme === 'light' ? '#f4f4f5' : '#18181b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!settings.startMinimized) {
      mainWindow.show();
    }
  });

  // Handle close: minimize to tray if enabled
  mainWindow.on('close', (event) => {
    const currentSettings = store.getSettings();
    if (!isQuitting && currentSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();

      // Show toast on first minimization to inform user
      if (!currentSettings.firstRunTrayToastShown) {
        store.updateSettings({ firstRunTrayToastShown: true });
        showNotification(
          'Wi-Fi OFF Scheduler',
          'App minimized to the system tray. Right-click the tray icon for options.'
        );
      }
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:state-changed', { maximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:state-changed', { maximized: false });
  });
}

/**
 * Displays native desktop notification if user enabled notifications.
 */
function showNotification(title, body) {
  const settings = store.getSettings();
  if (settings.notifyOnRun === false) return;

  if (Notification.isSupported()) {
    const notification = new Notification({
      title,
      body,
      silent: false
    });
    notification.show();
  }
}

/**
 * Builds or refreshes the system tray and its context menu.
 */
function setupTray() {
  if (tray) return;

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Wi-Fi OFF Scheduler');

  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const settings = store.getSettings();
  const isPaused = !!settings.pauseAll;
  const isStartWithWindows = !!settings.startWithWindows;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Wi-Fi OFF Scheduler',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: isPaused ? 'Resume all schedules' : 'Pause all schedules',
      click: () => {
        const updated = store.updateSettings({ pauseAll: !isPaused });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('settings:updated', updated);
        }
        updateTrayMenu();
        triggerTaskSync();
        showNotification(
          'Wi-Fi OFF Scheduler',
          updated.pauseAll ? 'All schedules are now paused.' : 'Schedules resumed.'
        );
      }
    },
    {
      label: 'Run on startup',
      type: 'checkbox',
      checked: isStartWithWindows,
      click: (menuItem) => {
        const newValue = menuItem.checked;
        app.setLoginItemSettings({
          openAtLogin: newValue,
          openAsHidden: !!settings.startMinimized
        });
        const updated = store.updateSettings({ startWithWindows: newValue });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('settings:updated', updated);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Handles executing a scheduled rule.
 */
async function handleExecuteRule(rule, triggerType = 'scheduled', runKey = '') {
  try {
    const result = await executeRule(rule);

    // Update rule state
    const rules = store.getRules();
    const targetRule = rules.find((r) => r.id === rule.id);
    if (targetRule) {
      targetRule.lastRunAt = new Date().toISOString();
      targetRule.lastRunResult = result.success ? 'success' : 'error';
      targetRule.lastRunMessage = result.message;
      targetRule.lastRunKey = runKey;
      store.saveRules(rules);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rules:updated', rules);
      }
    }

    // Add entry to history log
    store.addHistoryEntry({
      ruleId: rule.id,
      ruleName: rule.name,
      action: rule.action,
      result: result.success,
      message: result.message
    });

    // Notify user
    const actionLabel =
      rule.action === 'disconnect'
        ? 'Wi-Fi Disconnected'
        : rule.action === 'connect'
        ? 'Wi-Fi Connected'
        : rule.action === 'toggle'
        ? 'Wi-Fi Toggled'
        : 'IP Renewed';

    showNotification(
      `${actionLabel} (${rule.name})`,
      result.message || 'Scheduled rule executed.'
    );

    // If auto-reconnect requested for disconnect rule
    if (
      result.success &&
      rule.action === 'disconnect' &&
      rule.autoReconnectMinutes > 0 &&
      schedulerRunner
    ) {
      schedulerRunner.scheduleAutoReconnect(rule, async (r) => {
        const reconnectProfile = r.targetProfile || (r.targetSsids && r.targetSsids[0]);
        if (reconnectProfile) {
          const recResult = await connectWifi(reconnectProfile);
          store.addHistoryEntry({
            ruleId: r.id,
            ruleName: `${r.name} (Auto-reconnect)`,
            action: 'connect',
            result: recResult.success,
            message: `Auto-reconnected after ${r.autoReconnectMinutes} minutes: ${recResult.message}`
          });
          showNotification(
            'Wi-Fi Reconnected',
            `Reconnected to "${reconnectProfile}" after ${r.autoReconnectMinutes} minutes.`
          );
        }
      });
    }

    // Refresh Wi-Fi state broadcast
    pollWifiState();
  } catch (err) {
    console.error('[Main] Error executing rule:', err);
  }
}

/**
 * Periodically polls and broadcasts the live Wi-Fi adapter state.
 */
async function pollWifiState() {
  try {
    const currentState = await getCurrentWifiState();
    const hasChanged =
      !lastKnownWifiState ||
      lastKnownWifiState.connected !== currentState.connected ||
      lastKnownWifiState.ssid !== currentState.ssid ||
      lastKnownWifiState.state !== currentState.state;

    lastKnownWifiState = currentState;

    if (mainWindow && !mainWindow.isDestroyed() && hasChanged) {
      mainWindow.webContents.send('wifi:state-changed', currentState);
    }
    return currentState;
  } catch (err) {
    return {
      available: false,
      connected: false,
      state: 'no_adapter',
      ssid: null,
      error: err.message
    };
  }
}

// Setup IPC Handlers
function setupIpcHandlers() {
  // Wi-Fi operations
  ipcMain.handle('wifi:get-state', async () => {
    return await pollWifiState();
  });

  ipcMain.handle('wifi:get-profiles', async () => {
    return await getSavedProfiles();
  });

  ipcMain.handle('wifi:disconnect', async () => {
    const res = await disconnectWifi();
    store.addHistoryEntry({
      ruleName: 'Manual Quick Disconnect',
      action: 'disconnect',
      result: res.success,
      message: res.message
    });
    pollWifiState();
    return res;
  });

  ipcMain.handle('wifi:connect', async (_event, profile) => {
    const res = await connectWifi(profile);
    store.addHistoryEntry({
      ruleName: `Manual Quick Connect (${profile})`,
      action: 'connect',
      result: res.success,
      message: res.message
    });
    pollWifiState();
    return res;
  });

  ipcMain.handle('wifi:renew-ip', async () => {
    const res = await renewIp();
    store.addHistoryEntry({
      ruleName: 'Manual Quick IP Renew',
      action: 'renew_ip',
      result: res.success,
      message: res.message
    });
    return res;
  });

  // Rules
  ipcMain.handle('rules:get-all', () => {
    return store.getRules();
  });

  ipcMain.handle('rules:save', (_event, rule) => {
    const rules = store.addOrUpdateRule(rule);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rules:updated', rules);
    }
    triggerTaskSync();
    return rules;
  });

  ipcMain.handle('rules:delete', (_event, ruleId) => {
    const rules = store.deleteRule(ruleId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rules:updated', rules);
    }
    triggerTaskSync();
    return rules;
  });

  ipcMain.handle('rules:duplicate', (_event, ruleId) => {
    const rules = store.getRules();
    const target = rules.find((r) => r.id === ruleId);
    if (!target) return rules;

    const copy = {
      ...target,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${target.name} (Copy)`,
      enabled: false,
      lastRunAt: null,
      lastRunResult: null,
      lastRunMessage: 'Duplicated rule.'
    };
    const updatedRules = store.addOrUpdateRule(copy);
    triggerTaskSync();
    return updatedRules;
  });

  ipcMain.handle('rules:toggle', (_event, ruleId, enabled) => {
    const rules = store.getRules();
    const target = rules.find((r) => r.id === ruleId);
    if (target) {
      target.enabled = !!enabled;
      if (target.enabled) {
        target.completed = false; // Reset completed flag if re-enabled
      }
      store.saveRules(rules);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rules:updated', rules);
      }
      triggerTaskSync();
    }
    return rules;
  });

  ipcMain.handle('rules:run-now', async (_event, ruleId) => {
    const rules = store.getRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) {
      return { success: false, message: 'Rule not found' };
    }
    await handleExecuteRule(rule, 'manual_test', `manual_${Date.now()}`);
    return { success: true, message: `Rule "${rule.name}" triggered.` };
  });

  // Rules Import / Export
  ipcMain.handle('rules:export', async () => {
    if (!mainWindow) return { success: false };
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Wi-Fi OFF Scheduler Rules',
      defaultPath: `wifi-off-rules-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    try {
      const data = JSON.stringify(store.getRules(), null, 2);
      fs.writeFileSync(filePath, data, 'utf8');
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('rules:import', async () => {
    if (!mainWindow) return { success: false };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Rules JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    try {
      const raw = fs.readFileSync(filePaths[0], 'utf8');
      const parsed = JSON.parse(raw);
      if (!store.validateRulesData(parsed)) {
        return { success: false, error: 'Invalid rules file structure.' };
      }
      store.saveRules(parsed);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rules:updated', parsed);
      }
      triggerTaskSync();
      return { success: true, count: parsed.length };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Settings
  ipcMain.handle('settings:get', () => {
    return store.getSettings();
  });

  ipcMain.handle('settings:save', (_event, updates) => {
    const updated = store.updateSettings(updates);
    if (updates.startWithWindows !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: !!updated.startWithWindows,
        openAsHidden: !!updated.startMinimized
      });
    }
    if (updates.pauseAll !== undefined) {
      triggerTaskSync();
    }
    updateTrayMenu();
    return updated;
  });

  // History
  ipcMain.handle('history:get', () => {
    return store.getHistory();
  });

  ipcMain.handle('history:clear', () => {
    store.clearHistory();
    return [];
  });

  ipcMain.handle('history:export', async (_event, format = 'json') => {
    if (!mainWindow) return { success: false };
    const ext = format === 'csv' ? 'csv' : 'json';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Activity Log',
      defaultPath: `wifi-off-activity-${new Date().toISOString().slice(0, 10)}.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }]
    });

    if (canceled || !filePath) return { success: false, canceled: true };

    try {
      const history = store.getHistory();
      let outputData = '';
      if (format === 'csv') {
        const headers = ['Timestamp', 'Rule Name', 'Action', 'Result', 'Message'];
        const rows = history.map((h) => [
          `"${h.timestamp}"`,
          `"${(h.ruleName || '').replace(/"/g, '""')}"`,
          `"${h.action}"`,
          `"${h.result}"`,
          `"${(h.message || '').replace(/"/g, '""')}"`
        ]);
        outputData = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      } else {
        outputData = JSON.stringify(history, null, 2);
      }

      fs.writeFileSync(filePath, outputData, 'utf8');
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Window Controls
  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('window:is-maximized', () => {
    return mainWindow ? mainWindow.isMaximized() : false;
  });
}

// App lifecycle
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();
  setupTray();
  setupIpcHandlers();
  setupStoreWatchers();
  triggerTaskSync();

  // Initialize scheduler runner
  schedulerRunner = new SchedulerRunner({
    getRules: () => store.getRules(),
    getSettings: () => store.getSettings(),
    onExecuteRule: handleExecuteRule,
    onRuleUpdated: (updatedRule) => {
      const rules = store.getRules();
      const idx = rules.findIndex((r) => r.id === updatedRule.id);
      if (idx >= 0) {
        rules[idx] = updatedRule;
        store.saveRules(rules);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rules:updated', rules);
        }
      }
    }
  });

  schedulerRunner.start();

  // App start catch-up check
  setTimeout(() => {
    if (schedulerRunner) schedulerRunner.checkCatchUp();
  }, 3000);

  // PowerMonitor resume listener for PC wake-up catch-up check
  powerMonitor.on('resume', () => {
    console.log('[PowerMonitor] System resumed from sleep. Checking catch-up rules...');
    if (schedulerRunner) {
      schedulerRunner.checkCatchUp();
    }
    pollWifiState();
  });

  // Start polling Wi-Fi state every 5 seconds
  pollWifiState();
  wifiPollInterval = setInterval(pollWifiState, 5000);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (wifiPollInterval) clearInterval(wifiPollInterval);
  if (schedulerRunner) schedulerRunner.stop();
});
