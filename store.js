/**
 * Wi-Fi OFF Scheduler - Store Module
 * Handles atomic JSON persistence in app.getPath("userData").
 * Safely recovers from missing or corrupted files with defaults.
 */

const fs = require('fs');
const path = require('path');

let userDataPath = null;

/**
 * Initializes or resolves the storage directory path.
 * In Electron, uses app.getPath('userData').
 * In test or headless mode, falls back to a local '.data' folder.
 */
function getDataDir() {
  if (userDataPath) return userDataPath;

  try {
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && typeof app.getPath === 'function') {
      userDataPath = path.join(app.getPath('userData'), 'wifi-off-scheduler');
    }
  } catch {
    // Electron not available or in non-electron runner
  }

  if (!userDataPath) {
    userDataPath = path.join(process.cwd(), '.data');
  }

  if (!fs.existsSync(userDataPath)) {
    try {
      fs.mkdirSync(userDataPath, { recursive: true });
    } catch (err) {
      console.error('[Store] Could not create storage directory:', err);
    }
  }

  return userDataPath;
}

/**
 * Atomically writes data to a JSON file.
 * Writes to a temporary file first, then renames to avoid partial corruptions.
 */
function writeJsonAtomic(fileName, data) {
  const dir = getDataDir();
  const targetPath = path.join(dir, fileName);
  const tempPath = path.join(dir, `${fileName}.${Date.now()}.tmp`);

  try {
    const payload = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, payload, 'utf8');
    fs.renameSync(tempPath, targetPath);
    return true;
  } catch (err) {
    console.error(`[Store] Atomic write failed for ${fileName}:`, err);
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup error
    }
    return false;
  }
}

/**
 * Reads and parses a JSON file. Returns fallback on missing or corrupt file.
 */
function readJsonSafe(fileName, fallback) {
  const dir = getDataDir();
  const filePath = path.join(dir, fileName);

  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Store] File ${fileName} corrupted or unreadable. Using fallback.`, err.message);
    // Back up the corrupt file so user data is not completely lost
    try {
      const backupPath = path.join(dir, `${fileName}.corrupt-${Date.now()}`);
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // ignore
    }
    return fallback;
  }
}

// Default settings
const DEFAULT_SETTINGS = {
  timeFormat: '12h', // '12h' | '24h'
  theme: 'dark', // 'dark' | 'light' | 'system'
  pauseAll: false,
  startWithWindows: false,
  startMinimized: false,
  minimizeToTray: true,
  notifyOnRun: true,
  catchUpMinutes: 10,
  firstRunTrayToastShown: false
};

// Default initial rules (starts empty so new installs show clean empty state)
const DEFAULT_RULES = [];

class AppStore {
  constructor() {
    this.settings = null;
    this.rules = null;
    this.history = null;
    this.rulesMtime = 0;
    this.historyMtime = 0;
  }

  getFileMtime(fileName) {
    try {
      const filePath = path.join(getDataDir(), fileName);
      if (fs.existsSync(filePath)) {
        return fs.statSync(filePath).mtimeMs;
      }
    } catch {}
    return 0;
  }

  init() {
    this.getSettings();
    this.getRules();
    this.getHistory();
  }

  getSettings() {
    if (!this.settings) {
      this.settings = { ...DEFAULT_SETTINGS, ...readJsonSafe('settings.json', DEFAULT_SETTINGS) };
    }
    return this.settings;
  }

  updateSettings(updates) {
    this.settings = { ...this.getSettings(), ...updates };
    writeJsonAtomic('settings.json', this.settings);
    return this.settings;
  }

  getRules() {
    const currentMtime = this.getFileMtime('rules.json');
    if (!this.rules || currentMtime !== this.rulesMtime) {
      this.rulesMtime = currentMtime;
      const loaded = readJsonSafe('rules.json', null);
      if (!loaded || !Array.isArray(loaded)) {
        this.rules = [...DEFAULT_RULES];
        writeJsonAtomic('rules.json', this.rules);
        this.rulesMtime = this.getFileMtime('rules.json');
      } else {
        // One-time cleanup: automatically remove example rule if present and still disabled
        const filtered = loaded.filter(
          (r) => !(r.id === 'example_rule_hemis_wifi' && !r.enabled)
        );
        if (filtered.length !== loaded.length) {
          writeJsonAtomic('rules.json', filtered);
          this.rulesMtime = this.getFileMtime('rules.json');
        }
        this.rules = filtered;
      }
    }
    return this.rules;
  }

  saveRules(newRules) {
    if (!Array.isArray(newRules)) return false;
    this.rules = newRules;
    const ok = writeJsonAtomic('rules.json', this.rules);
    this.rulesMtime = this.getFileMtime('rules.json');
    return ok;
  }

  addOrUpdateRule(rule) {
    const rules = this.getRules();
    const index = rules.findIndex((r) => r.id === rule.id);
    if (index >= 0) {
      rules[index] = { ...rules[index], ...rule, updatedAt: new Date().toISOString() };
    } else {
      rules.unshift({
        ...rule,
        id: rule.id || `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString()
      });
    }
    this.saveRules(rules);
    return rules;
  }

  deleteRule(ruleId) {
    const rules = this.getRules().filter((r) => r.id !== ruleId);
    this.saveRules(rules);
    return rules;
  }

  getHistory() {
    const currentMtime = this.getFileMtime('history.json');
    if (!this.history || currentMtime !== this.historyMtime) {
      this.historyMtime = currentMtime;
      this.history = readJsonSafe('history.json', []);
      if (!Array.isArray(this.history)) this.history = [];
    }
    return this.history;
  }

  addHistoryEntry({ ruleId, ruleName, action, result, message, ssid }) {
    const history = this.getHistory();
    const entry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ruleId: ruleId || null,
      ruleName: ruleName || 'Manual Action',
      action: action || 'disconnect',
      result: result ? 'success' : 'error',
      message: message || '',
      ssid: ssid || null
    };

    history.unshift(entry);
    // Keep max 500 entries
    if (history.length > 500) {
      history.length = 500;
    }

    this.history = history;
    writeJsonAtomic('history.json', history);
    this.historyMtime = this.getFileMtime('history.json');
    return entry;
  }

  clearHistory() {
    this.history = [];
    writeJsonAtomic('history.json', []);
    this.historyMtime = this.getFileMtime('history.json');
    return true;
  }

  validateRulesData(data) {
    if (!Array.isArray(data)) return false;
    for (const item of data) {
      if (!item || typeof item !== 'object') return false;
      if (!item.when || !item.action) return false;
    }
    return true;
  }
}

const storeInstance = new AppStore();

module.exports = {
  AppStore,
  store: storeInstance,
  getDataDir
};
