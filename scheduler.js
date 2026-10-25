/**
 * Wi-Fi OFF Scheduler - Scheduler Engine
 * Handles next-run calculations, catch-up evaluation, and periodic schedule ticks.
 */

/**
 * Returns number of days in a given month of a given year (1-based month: 1=Jan, 12=Dec).
 */
function getDaysInMonth(year, month1Based) {
  return new Date(year, month1Based, 0).getDate();
}

/**
 * Normalizes day strings or numbers to 0 (Sunday) - 6 (Saturday).
 */
const DAY_MAP = {
  sun: 0, sunday: 0, 0: 0,
  mon: 1, monday: 1, 1: 1,
  tue: 2, tuesday: 2, 2: 2,
  wed: 3, wednesday: 3, 3: 3,
  thu: 4, thursday: 4, 4: 4,
  fri: 5, friday: 5, 5: 5,
  sat: 6, saturday: 6, 6: 6
};

function normalizeDay(day) {
  if (typeof day === 'string') {
    const key = day.trim().toLowerCase();
    return DAY_MAP[key] !== undefined ? DAY_MAP[key] : null;
  }
  if (typeof day === 'number' && day >= 0 && day <= 6) {
    return day;
  }
  return null;
}

/**
 * Parses "HH:mm" 24-hour string into { hour, minute }.
 */
function parseTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { hour: 0, minute: 0 };
  }
  const parts = timeStr.trim().split(':');
  const hour = parseInt(parts[0], 10) || 0;
  const minute = parseInt(parts[1], 10) || 0;
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute))
  };
}

/**
 * Computes the exact next occurrence Date for a given rule.
 *
 * @param {Object} rule Rule configuration object.
 * @param {Date} [now=new Date()] Reference time.
 * @returns {Date|null} The next run date, or null if rule has no future run (e.g. expired 'once').
 */
function computeNextRun(rule, now = new Date()) {
  if (!rule || !rule.when) {
    return null;
  }

  const { hour, minute } = parseTime(rule.time || '00:00');

  // Case 1: ONCE - Specific date ('YYYY-MM-DD') and time ('HH:mm')
  if (rule.when === 'once') {
    if (!rule.date) return null;
    const [yStr, mStr, dStr] = rule.date.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10) - 1; // 0-based for JS Date
    const day = parseInt(dStr, 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

    const target = new Date(year, month, day, hour, minute, 0, 0);
    return target.getTime() > now.getTime() ? target : null;
  }

  // Case 2: DAILY - Every day at HH:mm
  if (rule.when === 'daily') {
    const candidateToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0
    );

    if (candidateToday.getTime() > now.getTime()) {
      return candidateToday;
    }

    // Tomorrow at HH:mm
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      hour,
      minute,
      0,
      0
    );
  }

  // Case 3: WEEKLY - Selected days of week (0=Sun .. 6=Sat)
  if (rule.when === 'weekly') {
    const rawDays = Array.isArray(rule.days) ? rule.days : [];
    const validDays = new Set(
      rawDays.map(normalizeDay).filter((d) => d !== null)
    );

    if (validDays.size === 0) {
      return null;
    }

    // Check starting today and up to 7 days ahead
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + offset,
        hour,
        minute,
        0,
        0
      );

      const candidateDay = candidate.getDay();
      if (validDays.has(candidateDay)) {
        if (candidate.getTime() > now.getTime()) {
          return candidate;
        }
      }
    }
    return null;
  }

  // Case 4: MONTHLY - On a day of the month (1-31)
  if (rule.when === 'monthly') {
    const targetDay = parseInt(rule.dayOfMonth, 10) || 1;
    const clampedDay = Math.max(1, Math.min(31, targetDay));

    // Try current month first
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-based
    const maxDaysInCurrentMonth = getDaysInMonth(currentYear, currentMonth + 1);
    const dayInThisMonth = Math.min(clampedDay, maxDaysInCurrentMonth);

    const candidateThisMonth = new Date(
      currentYear,
      currentMonth,
      dayInThisMonth,
      hour,
      minute,
      0,
      0
    );

    if (candidateThisMonth.getTime() > now.getTime()) {
      return candidateThisMonth;
    }

    // Otherwise, check next month (handles year boundary automatically in JS Date)
    const nextMonthDate = new Date(currentYear, currentMonth + 1, 1);
    const nextYear = nextMonthDate.getFullYear();
    const nextMonth = nextMonthDate.getMonth();
    const maxDaysInNextMonth = getDaysInMonth(nextYear, nextMonth + 1);
    const dayInNextMonth = Math.min(clampedDay, maxDaysInNextMonth);

    return new Date(
      nextYear,
      nextMonth,
      dayInNextMonth,
      hour,
      minute,
      0,
      0
    );
  }

  return null;
}

/**
 * Checks if a rule missed a scheduled execution within the last catchUpMinutes (e.g. 10m).
 * Used when the app starts or wakes up from sleep (powerMonitor resume).
 *
 * @param {Object} rule
 * @param {string} lastRunKey The key representing the last executed occurrence.
 * @param {Date} [now=new Date()]
 * @param {number} [catchUpWindowMs=600000] 10 minutes in ms.
 * @returns {Date|null} The missed occurrence Date if eligible, else null.
 */
function checkMissedRun(rule, lastRunKey, now = new Date(), catchUpWindowMs = 10 * 60 * 1000) {
  if (!rule || !rule.enabled || !rule.catchUpMissed) {
    return null;
  }

  const { hour, minute } = parseTime(rule.time || '00:00');
  const windowStart = new Date(now.getTime() - catchUpWindowMs);

  // Determine the most recent occurrence before 'now'
  let mostRecent = null;

  if (rule.when === 'once') {
    if (!rule.date) return null;
    const [yStr, mStr, dStr] = rule.date.split('-');
    const target = new Date(
      parseInt(yStr, 10),
      parseInt(mStr, 10) - 1,
      parseInt(dStr, 10),
      hour,
      minute,
      0,
      0
    );
    if (target.getTime() <= now.getTime() && target.getTime() >= windowStart.getTime()) {
      mostRecent = target;
    }
  } else if (rule.when === 'daily') {
    const candidateToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hour,
      minute,
      0,
      0
    );
    if (candidateToday.getTime() <= now.getTime()) {
      mostRecent = candidateToday;
    } else {
      // Check yesterday
      mostRecent = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
        hour,
        minute,
        0,
        0
      );
    }
  } else if (rule.when === 'weekly') {
    const rawDays = Array.isArray(rule.days) ? rule.days : [];
    const validDays = new Set(rawDays.map(normalizeDay).filter((d) => d !== null));
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - offset,
        hour,
        minute,
        0,
        0
      );
      if (validDays.has(candidate.getDay()) && candidate.getTime() <= now.getTime()) {
        mostRecent = candidate;
        break;
      }
    }
  } else if (rule.when === 'monthly') {
    const targetDay = parseInt(rule.dayOfMonth, 10) || 1;
    const clampedDay = Math.max(1, Math.min(31, targetDay));
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const dayInThisMonth = Math.min(clampedDay, getDaysInMonth(currentYear, currentMonth + 1));
    const candidate = new Date(currentYear, currentMonth, dayInThisMonth, hour, minute, 0, 0);

    if (candidate.getTime() <= now.getTime()) {
      mostRecent = candidate;
    } else {
      const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth();
      const dayInPrevMonth = Math.min(clampedDay, getDaysInMonth(prevYear, prevMonth + 1));
      mostRecent = new Date(prevYear, prevMonth, dayInPrevMonth, hour, minute, 0, 0);
    }
  }

  if (!mostRecent) return null;

  // Occurrence must fall within the catch-up window
  if (mostRecent.getTime() < windowStart.getTime() || mostRecent.getTime() > now.getTime()) {
    return null;
  }

  // Generate occurrence key
  const occurrenceKey = `${rule.id}_${mostRecent.toISOString().slice(0, 16)}`;
  if (lastRunKey === occurrenceKey) {
    // Already ran
    return null;
  }

  return mostRecent;
}

/**
 * Formats a rule's schedule in plain human English.
 * E.g. "Every Mon, Wed, Fri at 08:00 AM" or "Every day at 20:30".
 */
function formatScheduleText(rule, timeFormat = '12h') {
  if (!rule || !rule.when) return 'No schedule';

  const timeStr = formatTimeString(rule.time || '00:00', timeFormat);

  if (rule.when === 'once') {
    if (!rule.date) return `Once at ${timeStr}`;
    const [y, m, d] = rule.date.split('-');
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    const dateFormatted = dateObj.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `Once on ${dateFormatted} at ${timeStr}`;
  }

  if (rule.when === 'daily') {
    return `Every day at ${timeStr}`;
  }

  if (rule.when === 'weekly') {
    const rawDays = Array.isArray(rule.days) ? rule.days : [];
    const validDays = rawDays.map(normalizeDay).filter((d) => d !== null).sort((a, b) => a - b);
    if (validDays.length === 7) return `Every day at ${timeStr}`;
    if (validDays.length === 5 && !validDays.includes(0) && !validDays.includes(6)) {
      return `Weekdays at ${timeStr}`;
    }
    if (validDays.length === 2 && validDays.includes(0) && validDays.includes(6)) {
      return `Weekends at ${timeStr}`;
    }
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const names = validDays.map((d) => dayNames[d]);
    return names.length > 0 ? `Every ${names.join(', ')} at ${timeStr}` : `Weekly at ${timeStr}`;
  }

  if (rule.when === 'monthly') {
    const day = parseInt(rule.dayOfMonth, 10) || 1;
    const suffix = getOrdinalSuffix(day);
    return `Monthly on the ${day}${suffix} at ${timeStr}`;
  }

  return `Scheduled at ${timeStr}`;
}

function getOrdinalSuffix(n) {
  const j = n % 10;
  const k = n % 100;
  if (j === 1 && k !== 11) return 'st';
  if (j === 2 && k !== 12) return 'nd';
  if (j === 3 && k !== 13) return 'rd';
  return 'th';
}

/**
 * Formats "HH:mm" into "hh:mm AM/PM" or "HH:mm" based on timeFormat preference.
 */
function formatTimeString(timeStr, format = '12h') {
  const { hour, minute } = parseTime(timeStr);
  const mm = minute.toString().padStart(2, '0');
  if (format === '24h') {
    return `${hour.toString().padStart(2, '0')}:${mm}`;
  }
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${h12.toString().padStart(2, '0')}:${mm} ${ampm}`;
}

/**
 * Returns a human-friendly live countdown string given a target Date.
 * E.g., "in 1h 23m", "in 42s", "in 2d 4h", "due now".
 */
function formatCountdown(targetDate, now = new Date()) {
  if (!targetDate) return 'Not scheduled';
  const diffMs = targetDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'Due now';

  const totalSecs = Math.floor(diffMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const totalHours = Math.floor(totalMins / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `in ${hours}h ${mins}m`;
  }
  if (mins > 0) {
    return `in ${mins}m ${secs}s`;
  }
  return `in ${secs}s`;
}

/**
 * Formats a Date into standard readable string.
 */
function formatDateTime(date, timeFormat = '12h') {
  if (!date) return 'Never';
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Invalid date';

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = dayNames[d.getDay()];
  const dayNum = d.getDate();
  const monthName = monthNames[d.getMonth()];
  const timeStr = formatTimeString(`${d.getHours()}:${d.getMinutes()}`, timeFormat);

  return `${dayName} ${dayNum} ${monthName}, ${timeStr}`;
}

/**
 * Scheduler runner class that manages the 15-second loop, execution firing, and reconnection timers.
 */
class SchedulerRunner {
  constructor({ getRules, getSettings, onExecuteRule, onRuleUpdated }) {
    this.getRules = getRules;
    this.getSettings = getSettings;
    this.onExecuteRule = onExecuteRule;
    this.onRuleUpdated = onRuleUpdated;
    this.intervalId = null;
    this.reconnectTimers = new Map(); // ruleId -> timeoutId
    this.lastFiredKeys = new Set();
  }

  start() {
    if (this.intervalId) return;
    // Tick immediately, then every 15 seconds
    this.tick();
    this.intervalId = setInterval(() => {
      this.tick();
    }, 15000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
  }

  tick(referenceTime = new Date()) {
    try {
      const settings = this.getSettings ? this.getSettings() : {};
      if (settings.pauseAll) {
        return;
      }

      const rules = this.getRules ? this.getRules() : [];
      const now = referenceTime;

      for (const rule of rules) {
        if (!rule.enabled || rule.completed) continue;

        const nextRun = computeNextRun(rule, now);
        if (!nextRun) {
          // If it's a one-time rule in the past, ensure marked completed
          if (rule.when === 'once' && !rule.completed) {
            rule.completed = true;
            rule.enabled = false;
            if (this.onRuleUpdated) this.onRuleUpdated(rule);
          }
          continue;
        }

        // Fire if due within 15 seconds window or already due
        const diffMs = nextRun.getTime() - now.getTime();
        if (diffMs <= 1000) {
          const runKey = `${rule.id}_${nextRun.toISOString().slice(0, 16)}`;
          if (this.lastFiredKeys.has(runKey)) {
            continue;
          }

          this.lastFiredKeys.add(runKey);
          if (this.lastFiredKeys.size > 2000) {
            // Keep set size bounded
            const arr = Array.from(this.lastFiredKeys);
            this.lastFiredKeys = new Set(arr.slice(arr.length - 1000));
          }

          // Trigger execution (skip in-app execution if handled by OS Task Scheduler)
          if (!rule.hasOsTask && this.onExecuteRule) {
            this.onExecuteRule(rule, 'scheduled', runKey);
          }

          // If once rule, mark completed & disabled (if not handled by OS task)
          if (!rule.hasOsTask && rule.when === 'once') {
            rule.completed = true;
            rule.enabled = false;
            if (this.onRuleUpdated) this.onRuleUpdated(rule);
          }
        }
      }
    } catch (err) {
      console.error('[SchedulerRunner] Error in tick loop:', err);
    }
  }

  checkCatchUp(referenceTime = new Date()) {
    try {
      const settings = this.getSettings ? this.getSettings() : {};
      if (settings.pauseAll) return;

      const catchUpMinutes = settings.catchUpMinutes || 10;
      const windowMs = catchUpMinutes * 60 * 1000;
      const rules = this.getRules ? this.getRules() : [];

      for (const rule of rules) {
        if (!rule.enabled || rule.completed || !rule.catchUpMissed) continue;

        const missed = checkMissedRun(rule, rule.lastRunKey || '', referenceTime, windowMs);
        if (missed) {
          const runKey = `${rule.id}_${missed.toISOString().slice(0, 16)}`;
          if (!this.lastFiredKeys.has(runKey)) {
            this.lastFiredKeys.add(runKey);
            if (!rule.hasOsTask && this.onExecuteRule) {
              this.onExecuteRule(rule, 'catchup', runKey);
            }
            if (!rule.hasOsTask && rule.when === 'once') {
              rule.completed = true;
              rule.enabled = false;
              if (this.onRuleUpdated) this.onRuleUpdated(rule);
            }
          }
        }
      }
    } catch (err) {
      console.error('[SchedulerRunner] Error checking catch-up:', err);
    }
  }

  scheduleAutoReconnect(rule, onReconnect) {
    if (!rule || !rule.autoReconnectMinutes || rule.autoReconnectMinutes <= 0) {
      return;
    }

    const ruleId = rule.id;
    // Clear existing timer if any
    if (this.reconnectTimers.has(ruleId)) {
      clearTimeout(this.reconnectTimers.get(ruleId));
    }

    const delayMs = rule.autoReconnectMinutes * 60 * 1000;
    const timerId = setTimeout(() => {
      this.reconnectTimers.delete(ruleId);
      if (onReconnect) {
        onReconnect(rule);
      }
    }, delayMs);

    this.reconnectTimers.set(ruleId, timerId);
  }
}

module.exports = {
  computeNextRun,
  checkMissedRun,
  formatScheduleText,
  formatTimeString,
  formatCountdown,
  formatDateTime,
  parseTime,
  normalizeDay,
  SchedulerRunner
};
