/**
 * Wi-Fi OFF Scheduler - Windows Task Scheduler Integration
 * Generates Task Scheduler XML, registers background tasks via schtasks.exe,
 * and tracks registered tasks so schedules execute even when the application is exited.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

// In-memory set of rule IDs that currently have a confirmed registered Windows Task
const registeredTaskRuleIds = new Set();

/**
 * Escapes characters for safe inclusion inside XML tags and attributes.
 */
function xmlEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validates rule ID against safe identifier regex.
 */
function isValidRuleId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

/**
 * Resolves current user identifier for Task Scheduler Principal.
 */
function getCurrentUser() {
  const domain = process.env.USERDOMAIN;
  const user = process.env.USERNAME || 'Users';
  return domain ? `${domain}\\${user}` : user;
}

/**
 * Determines current executable path and argument prefix for task execution.
 */
function getExeInfo() {
  let isPackaged = false;
  try {
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && app.isPackaged !== undefined) {
      isPackaged = app.isPackaged;
    }
  } catch {}

  let command = process.execPath;
  let argsPrefix = '';

  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    command = process.env.PORTABLE_EXECUTABLE_FILE;
    argsPrefix = '';
  } else if (isPackaged) {
    command = process.execPath;
    argsPrefix = '';
  } else {
    // Development mode running inside Electron dev runner
    command = process.execPath;
    const appDir = path.resolve(__dirname);
    argsPrefix = `"${appDir}" `;
  }

  return { command, argsPrefix };
}

/**
 * Maps day number (0=Sun..6=Sat) or name to Task Scheduler XML tag.
 */
const DAY_XML_TAGS = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  sun: 'Sunday',
  sunday: 'Sunday',
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday'
};

/**
 * Generates XML for Windows Task Scheduler 2.0 (v1.2).
 * Pure function: takes rule, settings, and exeInfo, returns well-formed XML string.
 *
 * @param {Object} rule Rule configuration object.
 * @param {Object} [settings={}] Application settings object.
 * @param {Object} [exeInfo] Optional custom executable info.
 * @returns {string} Task Scheduler XML.
 */
function buildTaskXml(rule, settings = {}, exeInfo = null) {
  const info = exeInfo || getExeInfo();
  const rawTime = (rule.time || '00:00').trim();
  const [hStr, mStr] = rawTime.split(':');
  const h = String(parseInt(hStr, 10) || 0).padStart(2, '0');
  const m = String(parseInt(mStr, 10) || 0).padStart(2, '0');
  const timeStr = `${h}:${m}:00`;

  const user = getCurrentUser();
  const exeCommand = info.command;
  const exeArguments = `${info.argsPrefix || ''}--run-rule "${rule.id}"`;

  let triggersXml = '';

  if (rule.when === 'daily') {
    triggersXml = `    <CalendarTrigger>
      <StartBoundary>2020-01-01T${timeStr}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>`;
  } else if (rule.when === 'weekly') {
    const rawDays = Array.isArray(rule.days) && rule.days.length ? rule.days : [1, 2, 3, 4, 5];
    const tags = Array.from(
      new Set(rawDays.map((d) => DAY_XML_TAGS[typeof d === 'string' ? d.toLowerCase() : d]).filter(Boolean))
    );

    const daysXml = tags.map((t) => `          <${t} />`).join('\n');
    triggersXml = `    <CalendarTrigger>
      <StartBoundary>2020-01-01T${timeStr}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
${daysXml}
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>`;
  } else if (rule.when === 'once') {
    const dateStr = rule.date || new Date().toISOString().slice(0, 10);
    triggersXml = `    <TimeTrigger>
      <StartBoundary>${dateStr}T${timeStr}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>`;
  } else if (rule.when === 'monthly') {
    const day = Math.max(1, Math.min(31, parseInt(rule.dayOfMonth, 10) || 1));
    const monthsXml = `        <Months>
          <January /><February /><March /><April /><May /><June /><July /><August /><September /><October /><November /><December />
        </Months>`;

    triggersXml = `    <CalendarTrigger>
      <StartBoundary>2020-01-01T${timeStr}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>${day}</Day>
        </DaysOfMonth>
${monthsXml}
      </ScheduleByMonth>
    </CalendarTrigger>`;

    // For days 29-31, add a second trigger with <Day>Last</Day> so shorter months execute on the last day
    if (day >= 29) {
      triggersXml += `\n    <CalendarTrigger>
      <StartBoundary>2020-01-01T${timeStr}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>Last</Day>
        </DaysOfMonth>
${monthsXml}
      </ScheduleByMonth>
    </CalendarTrigger>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xmlEscape(rule.name || 'Wi-Fi OFF Scheduler Rule')}</Description>
    <URI>\\WiFiOffScheduler\\Rule_${xmlEscape(rule.id)}</URI>
  </RegistrationInfo>
  <Triggers>
${triggersXml}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(exeCommand)}</Command>
      <Arguments>${xmlEscape(exeArguments)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Builds task XML for auto-reconnect after N minutes.
 */
function buildReconnectTaskXml(ruleId, ssid, targetDate, exeInfo = null) {
  const info = exeInfo || getExeInfo();
  const user = getCurrentUser();
  const exeCommand = info.command;
  const exeArguments = `${info.argsPrefix || ''}--reconnect "${ssid}" --rule-id "${ruleId}"`;

  const iso = targetDate.toISOString();
  // Local YYYY-MM-DDTHH:mm:ss
  const pad = (n) => String(n).padStart(2, '0');
  const localIso = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}T${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())}:${pad(targetDate.getSeconds())}`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Wi-Fi OFF Scheduler Auto-Reconnect</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${localIso}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEscape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(exeCommand)}</Command>
      <Arguments>${xmlEscape(exeArguments)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Executes a child process via execFile using an argument array.
 */
function runExecFile(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: err.message, stderr, code: err.code });
      } else {
        resolve({ ok: true, stdout });
      }
    });
  });
}

/**
 * Registers a Windows Task using schtasks.exe with XML input written in UTF-16 LE with BOM.
 */
async function registerTaskFromXml(taskName, xmlContent) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows Task Scheduler is only supported on Windows.' };
  }

  const tmpPath = path.join(os.tmpdir(), `wifioff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.xml`);

  try {
    // Write UTF-16 LE with BOM (0xFF, 0xFE)
    const bom = Buffer.from([0xFF, 0xFE]);
    const payload = Buffer.concat([bom, Buffer.from(xmlContent, 'utf16le')]);
    fs.writeFileSync(tmpPath, payload);

    // Call schtasks /Create /TN <taskName> /XML <tmpPath> /F
    const res = await runExecFile('schtasks', ['/Create', '/TN', taskName, '/XML', tmpPath, '/F']);
    return res;
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {}
  }
}

/**
 * Deletes a task from Windows Task Scheduler.
 */
async function deleteTask(taskName) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Not on Windows' };
  }
  return await runExecFile('schtasks', ['/Delete', '/TN', taskName, '/F']);
}

/**
 * Creates an auto-reconnect task scheduled for now + delayMinutes.
 */
async function createReconnectTask(ruleId, ssid, delayMinutes, exeInfo = null) {
  if (process.platform !== 'win32') return { ok: false };
  if (!isValidRuleId(ruleId) || !ssid) return { ok: false };

  const targetDate = new Date(Date.now() + Math.max(1, delayMinutes) * 60 * 1000);
  const xml = buildReconnectTaskXml(ruleId, ssid, targetDate, exeInfo);
  const taskName = `\\WiFiOffScheduler\\Reconnect_${ruleId}`;
  return await registerTaskFromXml(taskName, xml);
}

/**
 * Synchronizes all rules to Windows Task Scheduler.
 * Creates/updates tasks for enabled active rules, removes disabled/completed/missing rules.
 * Never throws; returns { ok, error }.
 *
 * @param {Array} rules List of rule objects from store.
 * @param {Object} [settings={}] Application settings.
 * @param {Object} [exeInfo] Custom executable info.
 * @returns {Promise<Object>} Result object { ok: boolean, created: number, deleted: number }.
 */
async function syncAllTasks(rules = [], settings = {}, exeInfo = null) {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true, platform: process.platform };
  }

  try {
    const isPaused = !!settings.pauseAll;
    const activeRules = [];
    const inactiveRuleIds = [];

    for (const rule of rules) {
      if (!rule || !isValidRuleId(rule.id)) continue;

      if (!isPaused && rule.enabled && !rule.completed) {
        activeRules.push(rule);
      } else {
        inactiveRuleIds.push(rule.id);
      }
    }

    let createdCount = 0;
    let deletedCount = 0;

    // Register active rules
    for (const rule of activeRules) {
      try {
        const taskName = `\\WiFiOffScheduler\\Rule_${rule.id}`;
        const xml = buildTaskXml(rule, settings, exeInfo);
        const res = await registerTaskFromXml(taskName, xml);
        if (res.ok) {
          registeredTaskRuleIds.add(rule.id);
          createdCount++;
        } else {
          console.warn(`[TaskScheduler] Failed to register task for rule ${rule.id}:`, res.error || res.stderr);
        }
      } catch (err) {
        console.warn(`[TaskScheduler] Error building task for rule ${rule.id}:`, err.message);
      }
    }

    // Delete inactive rules
    for (const id of inactiveRuleIds) {
      try {
        const taskName = `\\WiFiOffScheduler\\Rule_${id}`;
        await deleteTask(taskName);
        registeredTaskRuleIds.delete(id);
        deletedCount++;
      } catch {}
    }

    return { ok: true, created: createdCount, deleted: deletedCount };
  } catch (err) {
    console.warn('[TaskScheduler] syncAllTasks encountered error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Checks if a rule ID is currently registered with Windows Task Scheduler.
 */
function hasRegisteredTask(ruleId) {
  return registeredTaskRuleIds.has(ruleId);
}

module.exports = {
  buildTaskXml,
  buildReconnectTaskXml,
  syncAllTasks,
  deleteTask,
  createReconnectTask,
  getExeInfo,
  hasRegisteredTask,
  xmlEscape,
  isValidRuleId
};
