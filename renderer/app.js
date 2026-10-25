/**
 * Wi-Fi OFF Scheduler - NetMod Flat Renderer
 * Handles state, responsive UI, slide-up sheet, live tickers, custom time picker, and IPC bridge.
 */

const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

// Inline SVG Icon Dictionary
const ICONS = {
  disconnect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="22" y2="22"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
  connect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>',
  toggle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  renew_ip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>'
};

function icon(name) {
  return ICONS[name] || '';
}

// In-browser mock store for standalone preview (starts empty as requested)
const mockStore = {
  wifiState: { available: true, connected: true, state: 'connected', ssid: 'Dialog 5G 1255', signal: '92%' },
  savedProfiles: ['Dialog 5G 1255', 'Hemis WiFi', 'Home-Office', 'Guest-Net'],
  settings: { timeFormat: '12h', theme: 'system', pauseAll: false, notifyOnRun: true, startWithWindows: false, startMinimized: false, minimizeToTray: true, catchUpMinutes: 10 },
  rules: [],
  history: []
};

// Direct Electron API bridge with browser fallback
const api = {
  getWifiState: () => (isElectron ? window.electronAPI.getWifiState() : Promise.resolve(mockStore.wifiState)),
  getSavedProfiles: () => (isElectron ? window.electronAPI.getSavedProfiles() : Promise.resolve(mockStore.savedProfiles)),
  disconnectWifi: () => {
    if (isElectron) return window.electronAPI.disconnectWifi();
    mockStore.wifiState.connected = false;
    mockStore.wifiState.state = 'disconnected';
    mockStore.wifiState.ssid = null;
    return Promise.resolve({ success: true, message: 'Disconnected from Wi-Fi.' });
  },
  connectWifi: (p) => {
    if (isElectron) return window.electronAPI.connectWifi(p);
    mockStore.wifiState.connected = true;
    mockStore.wifiState.state = 'connected';
    mockStore.wifiState.ssid = p;
    return Promise.resolve({ success: true, message: `Connected to "${p}".` });
  },
  renewIp: () => (isElectron ? window.electronAPI.renewIp() : Promise.resolve({ success: true, message: 'IP configuration renewed.' })),
  getRules: () => (isElectron ? window.electronAPI.getRules() : Promise.resolve(mockStore.rules)),
  saveRule: (r) => {
    if (isElectron) return window.electronAPI.saveRule(r);
    const idx = mockStore.rules.findIndex((x) => x.id === r.id);
    if (idx >= 0) mockStore.rules[idx] = { ...r };
    else mockStore.rules.unshift({ ...r });
    return Promise.resolve(mockStore.rules);
  },
  deleteRule: (id) => {
    if (isElectron) return window.electronAPI.deleteRule(id);
    mockStore.rules = mockStore.rules.filter((r) => r.id !== id);
    return Promise.resolve(mockStore.rules);
  },
  runRuleNow: (id) => {
    if (isElectron) return window.electronAPI.runRuleNow(id);
    const rule = mockStore.rules.find((r) => r.id === id);
    return Promise.resolve({ success: true, message: `Executed "${rule ? rule.name : 'Rule'}" manually.` });
  },
  duplicateRule: (id) => {
    if (isElectron) return window.electronAPI.duplicateRule(id);
    const orig = mockStore.rules.find((r) => r.id === id);
    if (orig) {
      mockStore.rules.unshift({ ...orig, id: `r_${Date.now()}`, name: `${orig.name} (Copy)`, enabled: false });
    }
    return Promise.resolve(mockStore.rules);
  },
  toggleRuleEnabled: (id, en) => {
    if (isElectron) return window.electronAPI.toggleRuleEnabled(id, en);
    const r = mockStore.rules.find((x) => x.id === id);
    if (r) { r.enabled = en; if (en) r.completed = false; }
    return Promise.resolve(mockStore.rules);
  },
  exportRules: () => (isElectron ? window.electronAPI.exportRules() : Promise.resolve({ success: false, message: 'Desktop feature.' })),
  importRules: () => (isElectron ? window.electronAPI.importRules() : Promise.resolve({ success: false, message: 'Desktop feature.' })),
  getSettings: () => (isElectron ? window.electronAPI.getSettings() : Promise.resolve(mockStore.settings)),
  saveSettings: (s) => {
    if (isElectron) return window.electronAPI.saveSettings(s);
    mockStore.settings = { ...mockStore.settings, ...s };
    return Promise.resolve(mockStore.settings);
  },
  getHistory: () => (isElectron ? window.electronAPI.getHistory() : Promise.resolve(mockStore.history)),
  clearHistory: () => {
    if (isElectron) return window.electronAPI.clearHistory();
    mockStore.history = [];
    return Promise.resolve(true);
  },
  exportHistory: (fmt) => (isElectron ? window.electronAPI.exportHistory(fmt) : Promise.resolve({ success: false, message: 'Desktop feature.' })),
  minimizeWindow: () => (isElectron ? window.electronAPI.minimizeWindow() : null),
  closeWindow: () => (isElectron ? window.electronAPI.closeWindow() : null)
};

// Application State
const state = {
  wifi: null,
  profiles: [],
  rules: [],
  settings: { timeFormat: '12h', theme: 'system', pauseAll: false },
  history: [],
  page: 'home',
  ruleSearch: '',
  ruleActionFilter: 'all',
  logSearch: '',
  logFilter: 'all',
  editingId: null,
  deleteId: null,
  editor: {
    action: 'disconnect',
    targetType: 'any',
    targetSsids: [],
    targetProfile: '',
    onlyIfNotConnected: true,
    when: 'daily',
    date: '',
    days: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    time: '08:00',
    name: '',
    autoReconnectMinutes: 0,
    catchUpMissed: true,
    enabled: true
  }
};

// DOM References
const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const hub = $('toastHub');
  const t = document.createElement('div');
  t.className = 'toast-item';
  t.textContent = msg;
  hub.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 180ms ease';
    setTimeout(() => t.remove(), 200);
  }, 3000);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme || 'system');
}

// UI Updaters
function updateWifiUI(wifi) {
  state.wifi = wifi;
  const isConn = wifi && wifi.connected;
  const isErr = wifi && (wifi.state === 'no_adapter' || wifi.state === 'service_stopped');

  const dot = $('wifiDot');
  const txt = $('wifiText');
  dot.className = `status-dot ${isConn ? 'connected' : isErr ? 'error' : 'disconnected'}`;
  txt.textContent = isConn ? (wifi.ssid || 'Connected') : isErr ? 'No adapter' : 'Disconnected';

  $('cardSsid').textContent = isConn ? (wifi.ssid || 'Connected') : isErr ? 'No Wi-Fi Adapter' : 'Disconnected';
  $('cardSub').textContent = isConn ? `Connected · Signal ${wifi.signal || 'Good'}` : isErr ? (wifi.error || 'Hardware disabled') : 'Wi-Fi is off';

  $('btnQuickDisc').style.display = isConn ? 'inline-block' : 'none';
  $('btnQuickConn').style.display = isConn ? 'none' : 'inline-block';
}

function updateNextAndLastUI() {
  const now = new Date();
  const enabled = state.rules.filter((r) => r.enabled && !r.completed);

  if (state.settings.pauseAll || enabled.length === 0) {
    $('nextSummary').textContent = state.settings.pauseAll ? 'Paused' : 'No upcoming schedule';
  } else {
    let earliest = null, targetRule = null;
    for (const r of enabled) {
      const d = computeNext(r, now);
      if (d && (!earliest || d < earliest)) { earliest = d; targetRule = r; }
    }
    if (earliest && targetRule) {
      const countdown = fmtCountdown(earliest, now);
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][earliest.getDay()];
      const timeStr = fmtTime(`${earliest.getHours()}:${earliest.getMinutes()}`, state.settings.timeFormat);
      $('nextSummary').textContent = `${targetRule.name} - ${countdown} (${dayName} ${timeStr})`;
    } else {
      $('nextSummary').textContent = 'No upcoming schedule';
    }
  }

  // Last execution summary line
  const last = state.history[0];
  if (last) {
    $('lastSummary').textContent = `${last.ruleName}: ${last.message} · ${fmtAgo(last.timestamp)}`;
  } else {
    $('lastSummary').textContent = 'No recent activity';
  }
}

function renderRules() {
  let list = [...state.rules];
  if (state.ruleActionFilter !== 'all') list = list.filter((r) => r.action === state.ruleActionFilter);
  if (state.ruleSearch.trim()) {
    const q = state.ruleSearch.toLowerCase();
    list = list.filter((r) => r.name.toLowerCase().includes(q) || (r.targetSsids || []).some((s) => s.toLowerCase().includes(q)) || (r.targetProfile || '').toLowerCase().includes(q));
  }

  $('rulesEmpty').classList.toggle('hidden', state.rules.length > 0);
  $('btnToggleSearch').style.display = state.rules.length > 5 ? 'inline-flex' : 'none';
  if (state.rules.length <= 5 && !state.ruleSearch) $('searchRow').classList.add('hidden');

  const container = $('rulesList');
  container.innerHTML = list.map((r) => {
    let target = 'Any Wi-Fi';
    if (r.action === 'connect') target = r.targetProfile ? `Profile: ${r.targetProfile}` : 'No profile';
    else if (r.targetType === 'only') target = `Only: ${(r.targetSsids || []).join(', ') || 'Any'}`;
    else if (r.targetType === 'except') target = `Except: ${(r.targetSsids || []).join(', ')}`;

    const sched = fmtSchedule(r, state.settings.timeFormat);
    const isCompleted = !!r.completed;
    const isFailed = r.lastRunResult === 'error';

    return `
      <div class="rule-card ${!r.enabled || isCompleted ? 'disabled' : ''}" data-id="${r.id}">
        <div class="rule-icon-box">${icon(r.action)}</div>
        <div class="rule-main">
          <div class="rule-head-row">
            <span class="rule-title">${escape(r.name)}</span>
            ${isCompleted ? '<span class="badge-completed">Completed</span>' : ''}
            ${isFailed ? `<span class="dot-err" title="Last run failed: ${escape(r.lastRunMessage)}"></span>` : ''}
          </div>
          <div class="rule-sub">${escape(sched)} · ${escape(target)}</div>
        </div>
        <div class="rule-end">
          <label class="switch-ui" title="Enable/disable" onclick="event.stopPropagation()">
            <input type="checkbox" class="rule-toggle" data-id="${r.id}" ${r.enabled && !isCompleted ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <button type="button" class="icon-btn btn-rule-edit" data-id="${r.id}" title="Edit" aria-label="Edit">
            ${icon('pencil')}
          </button>
          <button type="button" class="icon-btn btn-rule-del danger" data-id="${r.id}" title="Delete" aria-label="Delete">
            ${icon('trash')}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Clicking card body or pencil button opens the rule editor sheet
  container.querySelectorAll('.rule-card').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('.switch-ui') || e.target.closest('.rule-toggle') || e.target.closest('.btn-rule-del')) return;
      const id = card.dataset.id;
      const rule = state.rules.find((r) => r.id === id);
      if (rule) openEditor(rule);
    };
  });

  // Clicking delete icon button on rule card
  container.querySelectorAll('.btn-rule-del').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const rule = state.rules.find((r) => r.id === id);
      if (rule) openDeleteDialog(rule.id, rule.name);
    };
  });

  // Enable / disable switch toggle
  container.querySelectorAll('.rule-toggle').forEach((chk) => {
    chk.onchange = async (e) => {
      const id = e.target.dataset.id;
      const enabled = e.target.checked;
      state.rules = await api.toggleRuleEnabled(id, enabled);
      renderRules();
      updateNextAndLastUI();
      showToast(enabled ? 'Schedule enabled' : 'Schedule disabled');
    };
  });
}

function renderLog() {
  let list = [...state.history];
  if (state.logFilter === 'error') list = list.filter((x) => x.result === 'error');
  if (state.logSearch.trim()) {
    const q = state.logSearch.toLowerCase();
    list = list.filter((x) => x.ruleName.toLowerCase().includes(q) || (x.message || '').toLowerCase().includes(q));
  }

  $('logEmpty').classList.toggle('hidden', list.length > 0);
  const container = $('logList');
  container.innerHTML = list.map((item) => {
    const isErr = item.result === 'error';
    const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `
      <div class="log-row">
        <div class="log-r1">
          <span>${escape(item.ruleName)}</span>
          <span class="status-dot ${isErr ? 'error' : 'connected'}"></span>
        </div>
        <div class="log-r2">
          <span class="log-r2-msg">${escape(item.message || item.action)}</span>
          <span>${time} (${fmtAgo(item.timestamp)})</span>
        </div>
      </div>
    `;
  }).join('');
}

// Custom Typeable Time Control Helpers
function syncTimeInputsFromState() {
  const is12h = (state.settings.timeFormat !== '24h');
  const [hStr, mStr] = (state.editor.time || '08:00').split(':');
  let h24 = parseInt(hStr, 10);
  if (isNaN(h24) || h24 < 0 || h24 > 23) h24 = 8;
  let min = parseInt(mStr, 10);
  if (isNaN(min) || min < 0 || min > 59) min = 0;

  $('timeAmpmGroup').style.display = is12h ? 'inline-flex' : 'none';

  if (is12h) {
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    let displayH = h24 % 12;
    if (displayH === 0) displayH = 12;

    $('timeHour').value = String(displayH).padStart(2, '0');
    $('timeMinute').value = String(min).padStart(2, '0');
    $('btnAm').classList.toggle('active', ampm === 'AM');
    $('btnPm').classList.toggle('active', ampm === 'PM');
  } else {
    $('timeHour').value = String(h24).padStart(2, '0');
    $('timeMinute').value = String(min).padStart(2, '0');
  }

  renderTimeQuickChips();
}

function readTimeFromInputs() {
  const is12h = (state.settings.timeFormat !== '24h');
  let rawH = parseInt($('timeHour').value, 10);
  let rawM = parseInt($('timeMinute').value, 10);

  if (isNaN(rawM)) rawM = 0;
  rawM = Math.max(0, Math.min(59, rawM));

  let h24 = 8;
  if (is12h) {
    if (isNaN(rawH)) rawH = 8;
    rawH = Math.max(1, Math.min(12, rawH));
    const ampm = $('btnPm').classList.contains('active') ? 'PM' : 'AM';
    if (ampm === 'PM' && rawH < 12) h24 = rawH + 12;
    else if (ampm === 'AM' && rawH === 12) h24 = 0;
    else h24 = rawH;
  } else {
    if (isNaN(rawH)) rawH = 8;
    h24 = Math.max(0, Math.min(23, rawH));
  }

  state.editor.time = `${String(h24).padStart(2, '0')}:${String(rawM).padStart(2, '0')}`;
  updateEditorSummary();
}

function stepTimeHour(delta) {
  const is12h = (state.settings.timeFormat !== '24h');
  let val = parseInt($('timeHour').value, 10);
  if (isNaN(val)) val = is12h ? 8 : 8;

  if (is12h) {
    val += delta;
    if (val > 12) val = 1;
    if (val < 1) val = 12;
  } else {
    val = (val + delta + 24) % 24;
  }
  $('timeHour').value = String(val).padStart(2, '0');
  readTimeFromInputs();
}

function stepTimeMinute(delta) {
  let val = parseInt($('timeMinute').value, 10);
  if (isNaN(val)) val = 0;
  val = (val + delta + 60) % 60;
  $('timeMinute').value = String(val).padStart(2, '0');
  readTimeFromInputs();
}

function renderTimeQuickChips() {
  const is12h = (state.settings.timeFormat !== '24h');
  const chipsContainer = $('timeQuickChips');
  const presets = is12h ? [
    { label: '06:00 AM', time: '06:00' },
    { label: '12:00 AM', time: '00:00' },
    { label: '08:00 PM', time: '20:00' },
    { label: '10:00 PM', time: '22:00' }
  ] : [
    { label: '06:00', time: '06:00' },
    { label: '00:00', time: '00:00' },
    { label: '20:00', time: '20:00' },
    { label: '22:00', time: '22:00' }
  ];

  chipsContainer.innerHTML = presets.map((p) => `
    <button type="button" class="chip-sm ${state.editor.time === p.time ? 'active' : ''}" data-time="${p.time}">${p.label}</button>
  `).join('');

  chipsContainer.querySelectorAll('.chip-sm').forEach((btn) => {
    btn.onclick = () => {
      state.editor.time = btn.dataset.time;
      syncTimeInputsFromState();
      updateEditorSummary();
    };
  });
}

// Editor Sheet Logic
function openEditor(rule = null) {
  state.editingId = rule ? rule.id : null;
  $('sheetTitle').textContent = rule ? 'Edit Schedule' : 'New Schedule';

  // Toggle existing-rule actions bar
  $('editorExistingActions').classList.toggle('hidden', !rule);

  const f = rule ? {
    action: rule.action || 'disconnect',
    targetType: rule.targetType || 'any',
    targetSsids: [...(rule.targetSsids || [])],
    targetProfile: rule.targetProfile || '',
    onlyIfNotConnected: rule.onlyIfNotConnected !== false,
    when: rule.when || 'daily',
    date: rule.date || '',
    days: [...(rule.days || [1, 2, 3, 4, 5])],
    dayOfMonth: rule.dayOfMonth || 1,
    time: rule.time || '08:00',
    name: rule.name || '',
    autoReconnectMinutes: rule.autoReconnectMinutes || 0,
    catchUpMissed: rule.catchUpMissed !== false,
    enabled: rule.enabled !== false
  } : {
    action: 'disconnect',
    targetType: 'any',
    targetSsids: [],
    targetProfile: '',
    onlyIfNotConnected: true,
    when: 'daily',
    date: new Date().toISOString().slice(0, 10),
    days: [1, 2, 3, 4, 5],
    dayOfMonth: 1,
    time: '08:00',
    name: '',
    autoReconnectMinutes: 0,
    catchUpMissed: true,
    enabled: true
  };

  state.editor = f;
  syncEditorForm();
  $('editorBackdrop').classList.remove('hidden');
}

function closeEditor() {
  $('editorBackdrop').classList.add('hidden');
  state.editingId = null;
}

function syncEditorForm() {
  const f = state.editor;

  // Actions
  document.querySelectorAll('#editorActions .action-chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.action === f.action);
  });

  // Network targets
  const isRenew = f.action === 'renew_ip';
  const isConnect = f.action === 'connect';
  $('blockTarget').classList.toggle('hidden', isRenew);
  $('subTargetDisc').classList.toggle('hidden', isConnect);
  $('subTargetConn').classList.toggle('hidden', !isConnect);

  document.querySelectorAll('#editorTargetType .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === f.targetType));
  $('boxSsidTags').classList.toggle('hidden', f.targetType === 'any');
  renderEditorTags();

  $('checkOnlyIfNotConn').checked = f.onlyIfNotConnected;
  $('selectProfile').value = f.targetProfile || '';

  // Cadence
  document.querySelectorAll('#editorWhen .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === f.when));
  $('boxWeekly').classList.toggle('hidden', f.when !== 'weekly');
  $('boxOnce').classList.toggle('hidden', f.when !== 'once');
  $('boxMonthly').classList.toggle('hidden', f.when !== 'monthly');

  document.querySelectorAll('#daysRow .day-chip').forEach((c) => c.classList.toggle('active', f.days.includes(parseInt(c.dataset.day, 10))));

  $('inputOnceDate').value = f.date || new Date().toISOString().slice(0, 10);
  $('inputMonthlyDay').value = f.dayOfMonth;

  // Custom Time picker sync
  syncTimeInputsFromState();

  // More options
  $('inputRuleName').value = f.name;
  $('boxAutoReconnect').classList.toggle('hidden', f.action !== 'disconnect');
  $('inputReconnect').value = f.autoReconnectMinutes;
  $('checkCatchUp').checked = f.catchUpMissed;
  $('checkEnabled').checked = f.enabled;

  updateEditorSummary();
}

function renderEditorTags() {
  const wrap = $('tagListWrap');
  const input = $('tagInput');
  wrap.querySelectorAll('.tag-chip').forEach((t) => t.remove());

  state.editor.targetSsids.forEach((s, idx) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${escape(s)}<button type="button" class="tag-del" data-idx="${idx}">&times;</button>`;
    wrap.insertBefore(chip, input);
  });
}

function updateEditorSummary() {
  const f = state.editor;
  let act = 'disconnect from Wi-Fi';
  if (f.action === 'disconnect') {
    if (f.targetType === 'only') act = `disconnect only from ${(f.targetSsids || []).join(', ') || 'selected network'}`;
    else if (f.targetType === 'except') act = `disconnect unless connected to ${(f.targetSsids || []).join(', ')}`;
    else act = 'disconnect from any Wi-Fi';
  } else if (f.action === 'connect') {
    act = `connect to "${f.targetProfile || 'saved profile'}"`;
  } else if (f.action === 'toggle') {
    act = 'toggle Wi-Fi state';
  } else if (f.action === 'renew_ip') {
    act = 'renew IP configuration';
  }

  const sched = fmtSchedule(f, state.settings.timeFormat);
  let text = `${act} ${sched.toLowerCase()}`;
  if (f.action === 'disconnect' && f.autoReconnectMinutes > 0) text += ` (reconnects in ${f.autoReconnectMinutes}m)`;
  $('editorSummary').textContent = text;
}

/**
 * Shortened auto-generated rule name: "<Action> - <network>"
 * Examples: "Disconnect - Dialog 5G 1255", "Connect - Hemis WiFi", "Disconnect - Any Wi-Fi", "Renew IP"
 */
function genRuleName(f) {
  if (f.action === 'renew_ip') {
    return 'Renew IP';
  }
  if (f.action === 'connect') {
    const net = (f.targetProfile || '').trim() || 'Wi-Fi';
    return `Connect - ${net}`;
  }
  if (f.action === 'toggle') {
    let net = 'Any Wi-Fi';
    if (f.targetType === 'only' && f.targetSsids && f.targetSsids.length) {
      net = f.targetSsids.join(', ');
    } else if (f.targetType === 'except' && f.targetSsids && f.targetSsids.length) {
      net = `Except ${f.targetSsids.join(', ')}`;
    }
    return `Toggle - ${net}`;
  }
  // Disconnect
  let net = 'Any Wi-Fi';
  if (f.targetType === 'only' && f.targetSsids && f.targetSsids.length) {
    net = f.targetSsids.join(', ');
  } else if (f.targetType === 'except' && f.targetSsids && f.targetSsids.length) {
    net = `Except ${f.targetSsids.join(', ')}`;
  }
  return `Disconnect - ${net}`;
}

async function saveEditor() {
  const f = state.editor;
  if (f.when === 'once' && (!f.date || new Date(`${f.date}T${f.time}:00`).getTime() <= Date.now())) {
    showToast('One-time schedule must be in the future');
    return;
  }
  if (f.when === 'weekly' && f.days.length === 0) {
    showToast('Select at least one weekday');
    return;
  }
  if (f.action === 'connect' && !f.targetProfile) {
    showToast('Select a profile to connect to');
    return;
  }

  const name = (f.name || '').trim() || genRuleName(f);
  const rule = {
    id: state.editingId || `r_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    action: f.action,
    targetType: f.targetType,
    targetSsids: [...f.targetSsids],
    targetProfile: f.targetProfile,
    onlyIfNotConnected: f.onlyIfNotConnected,
    when: f.when,
    date: f.date,
    days: [...f.days],
    dayOfMonth: parseInt(f.dayOfMonth, 10) || 1,
    time: f.time,
    autoReconnectMinutes: parseInt(f.autoReconnectMinutes, 10) || 0,
    catchUpMissed: f.catchUpMissed,
    enabled: f.enabled,
    completed: false
  };

  state.rules = await api.saveRule(rule);
  closeEditor();
  renderRules();
  updateNextAndLastUI();
  showToast(`Saved "${name}"`);
}

// Quick Connect Profile Picker
function openQuickConnect() {
  const list = $('quickProfileChoices');
  if (state.profiles.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0;">No saved profiles detected.</div>';
  } else {
    list.innerHTML = state.profiles.map((p) => `<button type="button" class="profile-choice-btn" data-p="${escape(p)}">${escape(p)}</button>`).join('');
  }
  $('connectPickerBackdrop').classList.remove('hidden');
}

function escape(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function closePopovers() {
  document.querySelectorAll('.dropdown-popover').forEach((p) => p.classList.remove('open'));
}

// Setup Event Handlers
function initEvents() {
  // Navigation Rail
  document.querySelectorAll('.rail-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.rail-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.page = b.dataset.page;
      document.querySelectorAll('.page-view').forEach((v) => v.classList.toggle('active', v.id === `view-${state.page}`));
      if (state.page === 'log') renderLog();
      closePopovers();
    };
  });

  // Titlebar
  $('btnMin').onclick = () => api.minimizeWindow();
  $('btnClose').onclick = () => api.closeWindow();

  // Header options & pause switch
  $('wifiChip').onclick = refreshWifi;
  $('masterPause').onchange = async (e) => {
    state.settings.pauseAll = e.target.checked;
    await api.saveSettings({ pauseAll: e.target.checked });
    updateNextAndLastUI();
    showToast(e.target.checked ? 'All schedules paused' : 'Schedules active');
  };

  $('btnToggleSearch').onclick = () => {
    const row = $('searchRow');
    row.classList.toggle('hidden');
    if (!row.classList.contains('hidden')) $('ruleSearch').focus();
  };

  $('ruleSearch').oninput = (e) => { state.ruleSearch = e.target.value; renderRules(); };
  $('ruleActionFilter').onchange = (e) => { state.ruleActionFilter = e.target.value; renderRules(); };

  // Dropdown Popovers (Home & Log only)
  $('btnHomeMenu').onclick = (e) => {
    e.stopPropagation();
    const drop = $('homeDropdown');
    const wasOpen = drop.classList.contains('open');
    closePopovers();
    if (!wasOpen) drop.classList.add('open');
  };

  $('menuRefreshWifi').onclick = () => { refreshWifi(); closePopovers(); };
  $('menuImportRules').onclick = async () => {
    closePopovers();
    const res = await api.importRules();
    if (res && res.success) {
      state.rules = await api.getRules();
      renderRules();
      updateNextAndLastUI();
      showToast('Rules imported successfully');
    }
  };
  $('menuExportRules').onclick = async () => {
    closePopovers();
    const res = await api.exportRules();
    if (res && res.success) showToast('Rules exported');
  };

  // Quick Action Buttons
  $('btnQuickDisc').onclick = async () => {
    const res = await api.disconnectWifi();
    showToast(res.message);
    await refreshWifi();
  };
  $('btnQuickConn').onclick = openQuickConnect;
  $('btnQuickRenew').onclick = async () => {
    showToast('Renewing IP...');
    const res = await api.renewIp();
    showToast(res.message);
  };
  $('lastSummaryBtn').onclick = () => {
    document.querySelector('.rail-btn[data-page="log"]').click();
  };

  // FAB (+) button
  $('btnNewRule').onclick = () => openEditor(null);

  // Editor Actions Bar (for existing rules)
  $('btnSheetRunNow').onclick = async () => {
    if (!state.editingId) return;
    const ruleId = state.editingId;
    closeEditor();
    const res = await api.runRuleNow(ruleId);
    showToast(res ? res.message : 'Schedule executed');
    state.rules = await api.getRules();
    state.history = await api.getHistory();
    renderRules();
    updateNextAndLastUI();
  };

  $('btnSheetDuplicate').onclick = async () => {
    if (!state.editingId) return;
    const ruleId = state.editingId;
    closeEditor();
    state.rules = await api.duplicateRule(ruleId);
    renderRules();
    updateNextAndLastUI();
    showToast('Schedule duplicated');
  };

  // Editor Form Fields
  document.querySelectorAll('#editorActions .action-chip').forEach((c) => {
    c.onclick = () => {
      state.editor.action = c.dataset.action;
      syncEditorForm();
    };
  });

  document.querySelectorAll('#editorTargetType .seg-btn').forEach((b) => {
    b.onclick = () => {
      state.editor.targetType = b.dataset.val;
      syncEditorForm();
    };
  });

  $('tagInput').onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = e.target.value.trim();
      if (val && !state.editor.targetSsids.includes(val)) {
        state.editor.targetSsids.push(val);
        renderEditorTags();
        updateEditorSummary();
      }
      e.target.value = '';
    }
  };

  $('tagListWrap').onclick = (e) => {
    const btn = e.target.closest('.tag-del');
    if (btn) {
      const idx = parseInt(btn.dataset.idx, 10);
      state.editor.targetSsids.splice(idx, 1);
      renderEditorTags();
      updateEditorSummary();
    }
  };

  $('selectProfile').onchange = (e) => {
    state.editor.targetProfile = e.target.value;
    updateEditorSummary();
  };
  $('checkOnlyIfNotConn').onchange = (e) => {
    state.editor.onlyIfNotConnected = e.target.checked;
  };

  document.querySelectorAll('#editorWhen .seg-btn').forEach((b) => {
    b.onclick = () => {
      state.editor.when = b.dataset.val;
      syncEditorForm();
    };
  });

  document.querySelectorAll('#daysRow .day-chip').forEach((c) => {
    c.onclick = () => {
      const day = parseInt(c.dataset.day, 10);
      const idx = state.editor.days.indexOf(day);
      if (idx >= 0) state.editor.days.splice(idx, 1);
      else state.editor.days.push(day);
      syncEditorForm();
    };
  });

  $('presetWeekdays').onclick = () => { state.editor.days = [1, 2, 3, 4, 5]; syncEditorForm(); };
  $('presetWeekends').onclick = () => { state.editor.days = [0, 6]; syncEditorForm(); };
  $('presetEveryday').onclick = () => { state.editor.days = [0, 1, 2, 3, 4, 5, 6]; syncEditorForm(); };

  // Once Date & Quick Chips
  $('inputOnceDate').onchange = (e) => {
    state.editor.date = e.target.value;
    updateEditorSummary();
  };
  $('btnDateToday').onclick = () => {
    const today = new Date().toISOString().slice(0, 10);
    $('inputOnceDate').value = today;
    state.editor.date = today;
    updateEditorSummary();
  };
  $('btnDateTomorrow').onclick = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const tom = d.toISOString().slice(0, 10);
    $('inputOnceDate').value = tom;
    state.editor.date = tom;
    updateEditorSummary();
  };

  $('inputMonthlyDay').oninput = (e) => {
    state.editor.dayOfMonth = parseInt(e.target.value, 10) || 1;
    updateEditorSummary();
  };

  // Custom Time Inputs: Stepper & Keyboard & Wheel
  $('btnHourUp').onclick = () => stepTimeHour(1);
  $('btnHourDown').onclick = () => stepTimeHour(-1);
  $('btnMinUp').onclick = () => stepTimeMinute(1);
  $('btnMinDown').onclick = () => stepTimeMinute(-1);

  $('timeHour').onfocus = function() { this.select(); };
  $('timeMinute').onfocus = function() { this.select(); };

  $('timeHour').oninput = function() {
    this.value = this.value.replace(/\D/g, '').slice(0, 2);
    readTimeFromInputs();
  };
  $('timeMinute').oninput = function() {
    this.value = this.value.replace(/\D/g, '').slice(0, 2);
    readTimeFromInputs();
  };

  $('timeHour').onblur = function() {
    const is12h = (state.settings.timeFormat !== '24h');
    let val = parseInt(this.value, 10);
    if (is12h) {
      if (isNaN(val) || val < 1 || val > 12) val = 8;
    } else {
      if (isNaN(val) || val < 0 || val > 23) val = 8;
    }
    this.value = String(val).padStart(2, '0');
    readTimeFromInputs();
  };

  $('timeMinute').onblur = function() {
    let val = parseInt(this.value, 10);
    if (isNaN(val) || val < 0 || val > 59) val = 0;
    this.value = String(val).padStart(2, '0');
    readTimeFromInputs();
  };

  $('timeHour').onkeydown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); stepTimeHour(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepTimeHour(-1); }
  };
  $('timeMinute').onkeydown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); stepTimeMinute(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); stepTimeMinute(-1); }
  };

  $('timeHour').addEventListener('wheel', (e) => {
    e.preventDefault();
    stepTimeHour(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  $('timeMinute').addEventListener('wheel', (e) => {
    e.preventDefault();
    stepTimeMinute(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  // AM / PM Segmented Switch
  $('btnAm').onclick = () => {
    $('btnAm').classList.add('active');
    $('btnPm').classList.remove('active');
    readTimeFromInputs();
  };
  $('btnPm').onclick = () => {
    $('btnPm').classList.add('active');
    $('btnAm').classList.remove('active');
    readTimeFromInputs();
  };

  $('inputRuleName').oninput = (e) => { state.editor.name = e.target.value; };
  $('inputReconnect').oninput = (e) => {
    state.editor.autoReconnectMinutes = parseInt(e.target.value, 10) || 0;
    updateEditorSummary();
  };
  $('checkCatchUp').onchange = (e) => { state.editor.catchUpMissed = e.target.checked; };
  $('checkEnabled').onchange = (e) => { state.editor.enabled = e.target.checked; };

  // Editor Buttons
  $('btnSheetClose').onclick = closeEditor;
  $('btnSheetCancel').onclick = closeEditor;
  $('btnSheetSave').onclick = saveEditor;

  // Dialogs
  $('btnCancelConnectPicker').onclick = () => $('connectPickerBackdrop').classList.add('hidden');
  $('quickProfileChoices').onclick = async (e) => {
    const btn = e.target.closest('.profile-choice-btn');
    if (btn) {
      const p = btn.dataset.p;
      $('connectPickerBackdrop').classList.add('hidden');
      showToast(`Connecting to "${p}"...`);
      const res = await api.connectWifi(p);
      showToast(res.message);
      await refreshWifi();
    }
  };

  $('btnCancelDelete').onclick = () => $('deleteDialog').classList.add('hidden');
  $('btnConfirmDelete').onclick = async () => {
    if (state.deleteId) {
      state.rules = await api.deleteRule(state.deleteId);
      $('deleteDialog').classList.add('hidden');
      closeEditor();
      renderRules();
      updateNextAndLastUI();
      showToast('Schedule deleted');
    }
  };

  // Activity Log
  $('logSearch').oninput = (e) => { state.logSearch = e.target.value; renderLog(); };
  document.querySelectorAll('#logFilter .seg-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#logFilter .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.logFilter = b.dataset.val;
      renderLog();
    };
  });

  $('btnLogMenu').onclick = (e) => {
    e.stopPropagation();
    const drop = $('logDropdown');
    const wasOpen = drop.classList.contains('open');
    closePopovers();
    if (!wasOpen) drop.classList.add('open');
  };
  $('menuExportJson').onclick = () => { api.exportHistory('json'); closePopovers(); };
  $('menuExportCsv').onclick = () => { api.exportHistory('csv'); closePopovers(); };
  $('menuClearLog').onclick = async () => {
    await api.clearHistory();
    state.history = [];
    renderLog();
    closePopovers();
    showToast('Activity log cleared');
  };

  // Settings
  document.querySelectorAll('#setTimeFormat .seg-btn').forEach((b) => {
    b.onclick = async () => {
      document.querySelectorAll('#setTimeFormat .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.settings.timeFormat = b.dataset.val;
      await api.saveSettings({ timeFormat: b.dataset.val });
      renderRules();
      updateNextAndLastUI();
      syncTimeInputsFromState();
    };
  });

  document.querySelectorAll('#setTheme .seg-btn').forEach((b) => {
    b.onclick = async () => {
      document.querySelectorAll('#setTheme .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.settings.theme = b.dataset.val;
      applyTheme(b.dataset.val);
      await api.saveSettings({ theme: b.dataset.val });
    };
  });

  $('setNotify').onchange = (e) => api.saveSettings({ notifyOnRun: e.target.checked });
  $('setStartup').onchange = (e) => api.saveSettings({ startWithWindows: e.target.checked });
  $('setMinimized').onchange = (e) => api.saveSettings({ startMinimized: e.target.checked });
  $('setMinToTray').onchange = (e) => api.saveSettings({ minimizeToTray: e.target.checked });
  $('setCatchUp').onchange = (e) => api.saveSettings({ catchUpMinutes: parseInt(e.target.value, 10) || 10 });
  $('btnSettingExport').onclick = api.exportRules;
  $('btnSettingImport').onclick = async () => {
    const res = await api.importRules();
    if (res && res.success) {
      state.rules = await api.getRules();
      renderRules();
      updateNextAndLastUI();
      showToast('Rules imported');
    }
  };

  // Keyboard Shortcuts: Esc to close sheet, Enter to save sheet
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('connectPickerBackdrop').classList.contains('hidden')) $('connectPickerBackdrop').classList.add('hidden');
      else if (!$('deleteDialog').classList.contains('hidden')) $('deleteDialog').classList.add('hidden');
      else if (!$('editorBackdrop').classList.contains('hidden')) closeEditor();
      closePopovers();
    } else if (e.key === 'Enter' && !$('editorBackdrop').classList.contains('hidden') && e.target.tagName !== 'TEXTAREA') {
      if (document.activeElement !== $('tagInput')) {
        saveEditor();
      }
    }
  });

  document.addEventListener('click', closePopovers);
}

function openDeleteDialog(ruleId, ruleName) {
  state.deleteId = ruleId;
  $('deleteMsg').textContent = `Are you sure you want to delete "${ruleName}"?`;
  $('deleteDialog').classList.remove('hidden');
}

async function refreshWifi() {
  const w = await api.getWifiState();
  updateWifiUI(w);
  state.profiles = await api.getSavedProfiles();
  populateProfilesDropdown();
}

function populateProfilesDropdown() {
  const sel = $('selectProfile');
  sel.innerHTML = '<option value="">Select saved Wi-Fi profile...</option>' + state.profiles.map((p) => `<option value="${escape(p)}">${escape(p)}</option>`).join('');

  const qp = $('quickProfilesWrap');
  qp.innerHTML = state.profiles.map((p) => `<span class="qp-chip" data-p="${escape(p)}">+ ${escape(p)}</span>`).join('');
  qp.querySelectorAll('.qp-chip').forEach((c) => {
    c.onclick = () => {
      const p = c.dataset.p;
      if (!state.editor.targetSsids.includes(p)) {
        state.editor.targetSsids.push(p);
        renderEditorTags();
        updateEditorSummary();
      }
    };
  });
}

// Helpers
function fmtSchedule(r, fmt) {
  const t = fmtTime(r.time, fmt);
  if (r.when === 'once') return `Once: ${r.date || 'TBD'} ${t}`;
  if (r.when === 'daily') return `Daily at ${t}`;
  if (r.when === 'monthly') return `Day ${r.dayOfMonth} monthly at ${t}`;
  if (r.when === 'weekly') {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = (r.days || []).map((d) => names[d]).join(', ');
    return `Every ${days || 'day'} at ${t}`;
  }
  return t;
}

function fmtTime(time24, fmt) {
  if (!time24) return '';
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (fmt === '24h') return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtCountdown(target, ref) {
  const diff = Math.max(0, target.getTime() - ref.getTime());
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

function fmtAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function computeNext(r, refDate) {
  const [h, m] = (r.time || '00:00').split(':').map((x) => parseInt(x, 10));
  const now = refDate || new Date();

  if (r.when === 'once') {
    if (!r.date) return null;
    const [y, mo, d] = r.date.split('-').map((x) => parseInt(x, 10));
    const target = new Date(y, mo - 1, d, h, m, 0, 0);
    return target > now ? target : null;
  }

  if (r.when === 'daily') {
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target;
  }

  if (r.when === 'weekly') {
    const days = (r.days && r.days.length ? r.days : [1, 2, 3, 4, 5]).slice().sort((a, b) => a - b);
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0, 0);
      if (days.includes(candidate.getDay()) && candidate > now) return candidate;
    }
    return null;
  }

  if (r.when === 'monthly') {
    const targetDay = r.dayOfMonth || 1;
    let target = new Date(now.getFullYear(), now.getMonth(), targetDay, h, m, 0, 0);
    if (target <= now) target = new Date(now.getFullYear(), now.getMonth() + 1, targetDay, h, m, 0, 0);
    return target;
  }

  return null;
}

// Global Initialization
async function init() {
  initEvents();

  state.settings = await api.getSettings();
  applyTheme(state.settings.theme);
  $('masterPause').checked = !!state.settings.pauseAll;
  $('setNotify').checked = state.settings.notifyOnRun !== false;
  $('setStartup').checked = !!state.settings.startWithWindows;
  $('setMinimized').checked = !!state.settings.startMinimized;
  $('setMinToTray').checked = state.settings.minimizeToTray !== false;
  $('setCatchUp').value = state.settings.catchUpMinutes || 10;

  document.querySelectorAll('#setTimeFormat .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === state.settings.timeFormat));
  document.querySelectorAll('#setTheme .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.val === state.settings.theme));

  state.rules = await api.getRules();
  state.history = await api.getHistory();
  renderRules();
  await refreshWifi();
  updateNextAndLastUI();

  // 1-second live countdown ticker
  setInterval(updateNextAndLastUI, 1000);

  // Setup IPC Push Listeners
  if (isElectron) {
    window.electronAPI.onWifiStateChanged((w) => updateWifiUI(w));
    window.electronAPI.onRulesUpdated((r) => {
      state.rules = r;
      renderRules();
      updateNextAndLastUI();
    });
    window.electronAPI.onScheduleTicked(() => updateNextAndLastUI());
    window.electronAPI.onToastNotification((msg) => showToast(msg));
  }
}

document.addEventListener('DOMContentLoaded', init);
