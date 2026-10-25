/**
 * Wi-Fi OFF Scheduler - Scheduler Self-Test Script
 * Plain Node.js (no dependencies required)
 * Run with: node test-schedule.js
 */

const {
  computeNextRun,
  checkMissedRun,
  formatScheduleText,
  formatCountdown,
  parseTime
} = require('./scheduler.js');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('--- Running Wi-Fi OFF Scheduler Next-Run Tests ---\n');

// 1. Once rule in the future
{
  const ref = new Date('2026-10-24T10:00:00');
  const rule = {
    when: 'once',
    date: '2026-10-25',
    time: '14:30'
  };
  const next = computeNextRun(rule, ref);
  assert(next !== null, 'Once rule in future returns a valid date');
  assert(
    next && next.getFullYear() === 2026 && next.getMonth() === 9 && next.getDate() === 25 && next.getHours() === 14 && next.getMinutes() === 30,
    'Once rule matches exact future date and time (2026-10-25 14:30)'
  );
}

// 2. Once rule in the past (must return null)
{
  const ref = new Date('2026-10-25T15:00:00');
  const rule = {
    when: 'once',
    date: '2026-10-25',
    time: '14:30'
  };
  const next = computeNextRun(rule, ref);
  assert(next === null, 'Once rule in past returns null');
}

// 3. Daily rule for today (future time)
{
  const ref = new Date('2026-10-24T06:15:00');
  const rule = {
    when: 'daily',
    time: '08:00'
  };
  const next = computeNextRun(rule, ref);
  assert(next !== null, 'Daily rule for later today returns a valid date');
  assert(
    next && next.getDate() === 24 && next.getHours() === 8 && next.getMinutes() === 0,
    'Daily rule executes today at 08:00'
  );
}

// 4. Daily rule when time has already passed today (day rollover)
{
  const ref = new Date('2026-10-24T09:30:00');
  const rule = {
    when: 'daily',
    time: '08:00'
  };
  const next = computeNextRun(rule, ref);
  assert(next !== null, 'Daily rule after today\'s time returns tomorrow');
  assert(
    next && next.getDate() === 25 && next.getHours() === 8 && next.getMinutes() === 0,
    'Daily rule rolls over to next day (25th) at 08:00'
  );
}

// 5. Weekly multi-day rule (Mon, Wed, Fri)
{
  // 2026-10-24 is a Saturday (Day 6)
  const ref = new Date('2026-10-24T12:00:00');
  const rule = {
    when: 'weekly',
    days: ['mon', 'wed', 'fri'], // 1, 3, 5
    time: '08:00'
  };
  const next = computeNextRun(rule, ref);
  assert(next !== null, 'Weekly multi-day rule finds next upcoming day');
  // Next should be Monday, Oct 26
  assert(
    next && next.getDay() === 1 && next.getDate() === 26 && next.getHours() === 8,
    'From Saturday, next run for [Mon, Wed, Fri] is Monday Oct 26 at 08:00'
  );

  // If reference is Monday morning before 8:00
  const refMon = new Date('2026-10-26T07:15:00');
  const nextMon = computeNextRun(rule, refMon);
  assert(
    nextMon && nextMon.getDate() === 26 && nextMon.getHours() === 8,
    'On Monday before 08:00, returns same-day Monday 08:00'
  );
}

// 6. Monthly rule on day 31 (checks month length clamping)
{
  // In February (non-leap year 2027 has 28 days)
  const refFeb = new Date('2027-02-01T10:00:00');
  const rule31 = {
    when: 'monthly',
    dayOfMonth: 31,
    time: '23:00'
  };
  const nextFeb = computeNextRun(rule31, refFeb);
  assert(nextFeb !== null, 'Monthly day 31 computes in February');
  assert(
    nextFeb && nextFeb.getMonth() === 1 && nextFeb.getDate() === 28,
    'Monthly day 31 clamps to Feb 28 in non-leap year'
  );

  // In April (30 days)
  const refApr = new Date('2026-04-10T10:00:00');
  const nextApr = computeNextRun(rule31, refApr);
  assert(
    nextApr && nextApr.getMonth() === 3 && nextApr.getDate() === 30,
    'Monthly day 31 clamps to Apr 30'
  );

  // When time already passed this month (rolls over to next month)
  const refJanPast = new Date('2026-01-31T23:30:00');
  const nextAfterJan = computeNextRun(rule31, refJanPast);
  assert(
    nextAfterJan && nextAfterJan.getMonth() === 1 && nextAfterJan.getDate() === 28,
    'After Jan 31 23:00, rolls over to Feb 28'
  );
}

// 7. Human text formatting & countdown
{
  const rule = { when: 'weekly', days: ['mon', 'wed', 'fri'], time: '08:00' };
  const text12 = formatScheduleText(rule, '12h');
  const text24 = formatScheduleText(rule, '24h');
  assert(text12 === 'Every Mon, Wed, Fri at 08:00 AM', `formatScheduleText 12h: "${text12}"`);
  assert(text24 === 'Every Mon, Wed, Fri at 08:00', `formatScheduleText 24h: "${text24}"`);

  const now = new Date('2026-10-24T10:00:00');
  const future = new Date('2026-10-24T11:23:45');
  const countdown = formatCountdown(future, now);
  assert(countdown === 'in 1h 23m', `formatCountdown matches: "${countdown}"`);
}

// 8. Catch-up check within N minutes
{
  // Scheduled daily at 08:00. App wakes up at 08:06. Missed by 6 minutes (within 10m window).
  const wakeUpTime = new Date('2026-10-24T08:06:00');
  const rule = {
    id: 'test_rule_1',
    enabled: true,
    catchUpMissed: true,
    when: 'daily',
    time: '08:00'
  };
  const missed = checkMissedRun(rule, '', wakeUpTime, 10 * 60 * 1000);
  assert(missed !== null, 'Missed run detected within 10-minute catch-up window');
  assert(
    missed && missed.getDate() === 24 && missed.getHours() === 8 && missed.getMinutes() === 0,
    'Missed run corresponds to 08:00 occurrence'
  );

  // If already ran with that key, should not catch up again
  const occurrenceKey = `${rule.id}_${missed.toISOString().slice(0, 16)}`;
  const alreadyRan = checkMissedRun(rule, occurrenceKey, wakeUpTime, 10 * 60 * 1000);
  assert(alreadyRan === null, 'Does not catch up if lastRunKey matches occurrence');

  // If wake-up was 45 minutes later (outside 10m window)
  const lateWakeUp = new Date('2026-10-24T08:45:00');
  const missedLate = checkMissedRun(rule, '', lateWakeUp, 10 * 60 * 1000);
  assert(missedLate === null, 'Ignores missed run outside 10-minute window');
}

console.log(`\nResults: ${passedTests}/${totalTests} tests passed.`);
if (passedTests === totalTests) {
  console.log('ALL TESTS PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME TESTS FAILED!\n');
  process.exit(1);
}
