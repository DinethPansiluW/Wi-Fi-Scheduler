/**
 * Wi-Fi OFF Scheduler - Windows Task Scheduler Integration
 * Synchronizes application schedule rules with the Windows Task Scheduler (schtasks)
 * so rules fire on time even when the app is completely closed.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WIN = process.platform === 'win32';

/**
 * Escapes special XML characters to prevent malformed Task XML or injection.
 */
function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes day representation (number 0-6 or string 'mon', 'monday', etc.)
 */
const DAY_NAME_MAP = {
  0: 'Sunday', sun: 'Sunday', sunday: 'Sunday',
  1: 'Monday', mon: 'Monday', monday: 'Monday',
  2: 'Tuesday', tue: 'Tuesday', tuesday: 'Tuesday',
  3: 'Wednesday', wed: 'Wednesday', wednesday: 'Wednesday',
  4: 'Thursday', thu: 'Thursday', thursday: 'Thursday',
  5: 'Friday', fri: 'Friday', friday: 'Friday',
  6: 'Saturday', sat: 'Saturday', saturday: 'Saturday'
};

function normalizeDayTag(d) {
  if (typeof d === 'string') {
    const k = d.trim().toLowerCase();
    return DAY_NAME_MAP[k] || null;
  }
  if (typeof d === 'number' && d >= 0 && d <= 6) {
    return DAY_NAME_MAP[d] || null;
  }
  return null;
}

/**
 * Resolves current user account identifier for Windows Task Principal.
 */
function getCurrentUserPrincipal() {
  const domain = process.env.USERDOMAIN;
  const user = process.env.USERNAME;
  if (domain && user) {
    return `${domain}\\${user}`;
  }
  return user || 'Users';
}

/**
 * Resolves the application executable and launch arguments for task action.
 */
function getExeInfo(ruleId) {
  let command = process.execPath;
  let args = `--run-rule "${ruleId}"`;

  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    command = process.env.PORTABLE_EXECUTABLE_FILE;
  } else {
    try {
      const electron = require('electron');
      const app = electron.app || (electron.remote && electron.remote.app);
      if (app && !app.isPackaged) {
        command = process.execPath;
        const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
        args = `"${appPath}" --run-rule "${ruleId}"`;
      }
    } catch {}
  }

  return { command, args };
}

/**
 * Pure function returning Task Scheduler v1.2 XML string.
 *
 * @param {Object} rule Rule configuration object.
 * @param {Object} [settings={}] Application settings.
 * @param {Object} [exeInfo] Optional custom command/args { command, args }.
 * @returns {string} XML string.
 */
function buildTaskXml(rule, settings = {}, exeInfo = null) {
  if (!rule) throw new Error('Rule is required');

  const exe = exeInfo || getExeInfo(rule.id);
  const principal = getCurrentUserPrincipal();
  const time = (rule.time || '00:00').trim();
  const timeFormatted = time.length === 5 ? `${time}:00` : time;

  // Determine Triggers
  let triggersXml = '';

  if (rule.when === 'once') {
    const dateStr = rule.date || new Date().toISOString().slice(0, 10);
    const startBoundary = `${dateStr}T${timeFormatted}`;
    triggersXml = `    <TimeTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>`;
  } else if (rule.when === 'daily') {
    const today = new Date().toISOString().slice(0, 10);
    const startBoundary = `${today}T${timeFormatted}`;
    triggersXml = `    <CalendarTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>`;
  } else if (rule.when === 'weekly') {
    const today = new Date().toISOString().slice(0, 10);
    const startBoundary = `${today}T${timeFormatted}`;
    const rawDays = Array.isArray(rule.days) && rule.days.length > 0 ? rule.days : [1, 2, 3, 4, 5];
    const tags = Array.from(new Set(rawDays.map(normalizeDayTag).filter(Boolean)));
    const dayElements = tags.map((t) => `          <${t} />`).join('\n');

    triggersXml = `    <CalendarTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>
${dayElements}
        </DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>`;
  } else if (rule.when === 'monthly') {
    const today = new Date().toISOString().slice(0, 10);
    const startBoundary = `${today}T${timeFormatted}`;
    const day = Math.max(1, Math.min(31, parseInt(rule.dayOfMonth, 10) || 1));
    const allMonths = `        <Months>
          <January />
          <February />
          <March />
          <April />
          <May />
          <June />
          <July />
          <August />
          <September />
          <October />
          <November />
          <December />
        </Months>`;

    // Primary trigger for specific day
    triggersXml = `    <CalendarTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>${day}</Day>
        </DaysOfMonth>
${allMonths}
      </ScheduleByMonth>
    </CalendarTrigger>`;

    // For days 29-31, add a second trigger for the last day of shorter months
    if (day >= 29 && day <= 31) {
      triggersXml += `\n    <CalendarTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth>
        <DaysOfMonth>
          <Day>Last</Day>
        </DaysOfMonth>
${allMonths}
      </ScheduleByMonth>
    </CalendarTrigger>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Wi-Fi OFF Scheduler - Automated Rule ${escapeXml(rule.name || rule.id)}</Description>
  </RegistrationInfo>
  <Triggers>
${triggersXml}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(principal)}</UserId>
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
      <Command>${escapeXml(exe.command)}</Command>
      <Arguments>${escapeXml(exe.args)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Builds XML for a one-time auto-reconnection task.
 */
function buildReconnectTaskXml(ruleId, ssid, delayMinutes, exeInfo = null) {
  let command = process.execPath;
  let args = `--reconnect "${ssid}" --rule-id "${ruleId}"`;

  if (process.env.PORTABLE_EXECUTABLE_FILE) {
    command = process.env.PORTABLE_EXECUTABLE_FILE;
  } else {
    try {
      const electron = require('electron');
      const app = electron.app || (electron.remote && electron.remote.app);
      if (app && !app.isPackaged) {
        command = process.execPath;
        const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
        args = `"${appPath}" --reconnect "${ssid}" --rule-id "${ruleId}"`;
      }
    } catch {}
  }

  const exe = exeInfo || { command, args };
  const principal = getCurrentUserPrincipal();
  const triggerTime = new Date(Date.now() + Math.max(1, delayMinutes) * 60 * 1000);
  const startBoundary = triggerTime.toISOString().slice(0, 19);

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Wi-Fi OFF Scheduler - Auto-reconnect to ${escapeXml(ssid)}</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${escapeXml(startBoundary)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(principal)}</UserId>
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
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(exe.command)}</Command>
      <Arguments>${escapeXml(exe.args)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Creates or updates a scheduled task in Windows Task Scheduler using schtasks /Create.
 */
function createScheduledTask(taskName, xmlContent) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      return resolve({ ok: true });
    }

    const tempFile = path.join(os.tmpdir(), `wifioff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.xml`);

    try {
      // Write XML as UTF-16 LE with BOM (0xFF, 0xFE)
      const bom = Buffer.from([0xff, 0xfe]);
      const content = Buffer.from(xmlContent, 'utf16le');
      fs.writeFileSync(tempFile, Buffer.concat([bom, content]));

      execFile(
        'schtasks',
        ['/Create', '/TN', taskName, '/XML', tempFile, '/F'],
        { windowsHide: true, timeout: 15000 },
        (err, stdout, stderr) => {
          try {
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          } catch {}

          if (err) {
            resolve({ ok: false, error: (stderr || err.message || '').trim() });
          } else {
            resolve({ ok: true, output: (stdout || '').trim() });
          }
        }
      );
    } catch (err) {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {}
      resolve({ ok: false, error: err.message });
    }
  });
}

/**
 * Deletes a scheduled task by task path/name using schtasks /Delete.
 */
function deleteTask(taskName) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      return resolve({ ok: true });
    }

    execFile(
      'schtasks',
      ['/Delete', '/TN', taskName, '/F'],
      { windowsHide: true, timeout: 15000 },
      (err, stdout, stderr) => {
        // schtasks returns error if task does not exist; treat as ok
        if (err && stderr && !stderr.toLowerCase().includes('cannot find') && !stderr.toLowerCase().includes('not exist')) {
          resolve({ ok: false, error: stderr.trim() });
        } else {
          resolve({ ok: true });
        }
      }
    );
  });
}

/**
 * Schedules a one-time auto-reconnect task at now + delayMinutes.
 */
async function scheduleReconnectTask(ruleId, ssid, delayMinutes) {
  if (!IS_WIN) return { ok: true };
  try {
    const taskName = `\\WiFiOffScheduler\\Reconnect_${ruleId}`;
    const xml = buildReconnectTaskXml(ruleId, ssid, delayMinutes);
    return await createScheduledTask(taskName, xml);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Synchronizes all rules to Windows Task Scheduler.
 * Creates/updates \WiFiOffScheduler\Rule_<ruleId> for every enabled, uncompleted rule,
 * and deletes tasks for disabled, completed, or removed rules.
 *
 * Never throws; returns { ok, error }.
 *
 * @param {Array} rules
 * @param {Object} [settings={}]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function syncAllTasks(rules, settings = {}) {
  if (!IS_WIN) {
    return { ok: true, platform: process.platform };
  }

  if (!Array.isArray(rules)) {
    return { ok: true, count: 0 };
  }

  const isPaused = !!(settings && settings.pauseAll);
  const idRegex = /^[A-Za-z0-9_-]+$/;

  try {
    for (const rule of rules) {
      if (!rule || !rule.id) continue;
      if (!idRegex.test(rule.id)) {
        console.warn(`[TaskScheduler] Skipping rule with invalid ID format: "${rule.id}"`);
        continue;
      }

      const taskName = `\\WiFiOffScheduler\\Rule_${rule.id}`;
      const shouldBeActive = rule.enabled && !rule.completed && !isPaused;

      if (shouldBeActive) {
        try {
          const xml = buildTaskXml(rule, settings);
          const res = await createScheduledTask(taskName, xml);
          rule.hasOsTask = res.ok;
          if (!res.ok) {
            console.warn(`[TaskScheduler] Failed to register task for rule "${rule.name}":`, res.error);
          }
        } catch (err) {
          rule.hasOsTask = false;
          console.warn(`[TaskScheduler] Error building task for rule "${rule.name}":`, err.message);
        }
      } else {
        await deleteTask(taskName);
        rule.hasOsTask = false;
      }
    }

    return { ok: true };
  } catch (err) {
    console.error('[TaskScheduler] syncAllTasks caught error:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  buildTaskXml,
  buildReconnectTaskXml,
  syncAllTasks,
  createScheduledTask,
  deleteTask,
  scheduleReconnectTask,
  escapeXml,
  getExeInfo,
  IS_WIN
};
