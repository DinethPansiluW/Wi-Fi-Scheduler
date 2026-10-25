/**
 * Wi-Fi OFF Scheduler - Task Scheduler XML Generation Tests
 * Plain Node.js (no dependencies required)
 * Run with: node test-tasks.js
 */

const { buildTaskXml, escapeXml } = require('./taskscheduler.js');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    console.error(`  FAIL: ${message}`);
    process.exitCode = 1;
  }
}

console.log('--- Running Wi-Fi OFF Scheduler Task XML Generation Tests ---\n');

// 1. Daily rule XML
{
  const rule = {
    id: 'rule_daily_1',
    name: 'Daily Disconnect',
    when: 'daily',
    time: '08:00'
  };
  const exeInfo = { command: 'C:\\App\\wifi-off.exe', args: '--run-rule "rule_daily_1"' };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(xml.includes('<ScheduleByDay>'), 'Daily rule contains <ScheduleByDay>');
  assert(xml.includes('<DaysInterval>1</DaysInterval>'), 'Daily rule specifies 1 day interval');
  assert(/<StartBoundary>\d{4}-\d{2}-\d{2}T08:00:00<\/StartBoundary>/.test(xml), 'Daily rule includes correct StartBoundary time (08:00:00)');
  assert(xml.includes('<Command>C:\\App\\wifi-off.exe</Command>'), 'Daily rule includes correct executable command');
  assert(xml.includes('<Arguments>--run-rule &quot;rule_daily_1&quot;</Arguments>'), 'Daily rule arguments are properly escaped');
}

// 2. Weekly multi-day rule (Mon, Wed, Fri)
{
  const rule = {
    id: 'rule_weekly_1',
    name: 'MWF Disconnect',
    when: 'weekly',
    days: ['mon', 'wed', 'fri'],
    time: '20:30'
  };
  const exeInfo = { command: 'C:\\App\\wifi-off.exe', args: '--run-rule "rule_weekly_1"' };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(xml.includes('<ScheduleByWeek>'), 'Weekly rule contains <ScheduleByWeek>');
  assert(xml.includes('<Monday />'), 'Weekly rule includes Monday');
  assert(xml.includes('<Wednesday />'), 'Weekly rule includes Wednesday');
  assert(xml.includes('<Friday />'), 'Weekly rule includes Friday');
  assert(!xml.includes('<Tuesday />'), 'Weekly rule excludes Tuesday');
  assert(!xml.includes('<Sunday />'), 'Weekly rule excludes Sunday');
  assert(xml.includes('<WeeksInterval>1</WeeksInterval>'), 'Weekly rule specifies 1 week interval');
}

// 3. One-time schedule (Once)
{
  const rule = {
    id: 'rule_once_1',
    name: 'One-time Off',
    when: 'once',
    date: '2026-10-25',
    time: '14:30'
  };
  const exeInfo = { command: 'C:\\App\\wifi-off.exe', args: '--run-rule "rule_once_1"' };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(xml.includes('<TimeTrigger>'), 'Once rule uses <TimeTrigger>');
  assert(xml.includes('<StartBoundary>2026-10-25T14:30:00</StartBoundary>'), 'Once rule has exact date and time StartBoundary');
  assert(!xml.includes('<CalendarTrigger>'), 'Once rule does not use <CalendarTrigger>');
}

// 4. Monthly schedule on Day 15
{
  const rule = {
    id: 'rule_monthly_15',
    name: 'Mid-Month Rule',
    when: 'monthly',
    dayOfMonth: 15,
    time: '23:00'
  };
  const exeInfo = { command: 'C:\\App\\wifi-off.exe', args: '--run-rule "rule_monthly_15"' };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(xml.includes('<ScheduleByMonth>'), 'Monthly rule contains <ScheduleByMonth>');
  assert(xml.includes('<Day>15</Day>'), 'Monthly rule specifies Day 15');
  assert(!xml.includes('<Day>Last</Day>'), 'Monthly day 15 does not include Day Last trigger');

  const triggerMatches = xml.match(/<CalendarTrigger>/g);
  assert(triggerMatches && triggerMatches.length === 1, 'Monthly day 15 has exactly 1 calendar trigger');
  assert(xml.includes('<January />') && xml.includes('<December />'), 'Monthly rule includes month definitions');
}

// 5. Monthly schedule on Day 31 with two triggers (Day 31 and Day Last)
{
  const rule = {
    id: 'rule_monthly_31',
    name: 'End-of-Month Rule',
    when: 'monthly',
    dayOfMonth: 31,
    time: '22:00'
  };
  const exeInfo = { command: 'C:\\App\\wifi-off.exe', args: '--run-rule "rule_monthly_31"' };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(xml.includes('<Day>31</Day>'), 'Monthly day 31 specifies Day 31');
  assert(xml.includes('<Day>Last</Day>'), 'Monthly day 31 includes second trigger for Day Last');

  const triggerMatches = xml.match(/<CalendarTrigger>/g);
  assert(triggerMatches && triggerMatches.length === 2, 'Monthly day 31 has exactly 2 calendar triggers');
}

// 6. Special characters in executable path and arguments
{
  const rule = {
    id: 'rule_special',
    name: 'App with "Quotes" & <Brackets>',
    when: 'daily',
    time: '09:00'
  };
  const exeInfo = {
    command: 'C:\\Program Files & Tools\\<Test>"App\'\\wifi-off.exe',
    args: '--run-rule "rule_special" --name "John & Co <5G>"'
  };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(
    xml.includes('<Command>C:\\Program Files &amp; Tools\\&lt;Test&gt;&quot;App&apos;\\wifi-off.exe</Command>'),
    'Special characters in command path are properly XML-escaped'
  );
  assert(
    xml.includes('&amp; Co &lt;5G&gt;'),
    'Special characters in arguments are properly XML-escaped'
  );
}

// 7. Well-formed XML structural validation
{
  const rule = {
    id: 'rule_wf',
    name: 'Well Formed Check',
    when: 'daily',
    time: '12:00'
  };
  const xml = buildTaskXml(rule);

  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>'), 'XML declaration is present at start');
  assert(xml.includes('<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">'), 'Root Task element with schema namespace');
  assert(xml.endsWith('</Task>'), 'XML terminates with closing </Task> tag');

  // Verify principal and settings per requirements
  assert(xml.includes('<LogonType>InteractiveToken</LogonType>'), 'Principal uses InteractiveToken');
  assert(xml.includes('<RunLevel>LeastPrivilege</RunLevel>'), 'Principal uses LeastPrivilege (no admin)');
  assert(xml.includes('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'), 'MultipleInstancesPolicy is IgnoreNew');
  assert(xml.includes('<StartWhenAvailable>true</StartWhenAvailable>'), 'StartWhenAvailable is true');
  assert(xml.includes('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'), 'DisallowStartIfOnBatteries is false');
  assert(xml.includes('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'), 'StopIfGoingOnBatteries is false');
  assert(xml.includes('<ExecutionTimeLimit>PT5M</ExecutionTimeLimit>'), 'ExecutionTimeLimit is PT5M');
}

console.log(`\nResults: ${passedTests}/${totalTests} task tests passed.`);
if (passedTests === totalTests) {
  console.log('ALL TASK TESTS PASSED SUCCESSFULLY! ✓\n');
} else {
  console.error('SOME TASK TESTS FAILED!\n');
  process.exit(1);
}
