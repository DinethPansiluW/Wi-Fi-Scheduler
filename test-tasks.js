/**
 * Wi-Fi OFF Scheduler - Task Scheduler XML Generation Tests
 * Verifies XML format, triggers, principal, settings, and escaping rules.
 */

const assert = require('assert');
const { buildTaskXml, isValidRuleId, xmlEscape } = require('./taskscheduler');

let passedCount = 0;
let totalCount = 0;

function it(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

/**
 * Basic XML tag balance checker to verify well-formedness.
 */
function verifyXmlBalanced(xml) {
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>'), 'Must start with XML declaration');
  assert(xml.includes('<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">'), 'Must have Task root element with correct schema');

  // Strip XML declaration
  const body = xml.replace(/<\?xml.*?\?>/g, '');

  const tagRegex = /<\/?([A-Za-z0-9_:-]+)(\s+[^>]*)?\/?>/g;
  const stack = [];
  let match;

  while ((match = tagRegex.exec(body)) !== null) {
    const fullTag = match[0];
    const tagName = match[1];

    if (fullTag.endsWith('/>')) {
      // Self-closing tag
      continue;
    } else if (fullTag.startsWith('</')) {
      // Closing tag
      assert(stack.length > 0, `Unexpected closing tag </${tagName}> without opening tag`);
      const openTag = stack.pop();
      assert.strictEqual(openTag, tagName, `Mismatched tags: expected </${openTag}>, got </${tagName}>`);
    } else {
      // Opening tag
      stack.push(tagName);
    }
  }

  assert.strictEqual(stack.length, 0, `Unclosed tags remaining: ${stack.join(', ')}`);
}

console.log('--- Running Wi-Fi OFF Task Scheduler XML Tests ---');

// 1. Daily rule
it('Daily rule creates ScheduleByDay trigger with 1 day interval', () => {
  const rule = {
    id: 'rule_daily_1',
    name: 'Disconnect Nightly',
    when: 'daily',
    time: '23:30',
    action: 'disconnect'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\App\\app.exe', argsPrefix: '' });
  assert(xml.includes('<ScheduleByDay>'), 'Should include ScheduleByDay');
  assert(xml.includes('<DaysInterval>1</DaysInterval>'), 'Interval must be 1');
  assert(xml.includes('<StartBoundary>2020-01-01T23:30:00</StartBoundary>'), 'StartBoundary must match time');
  assert(xml.includes('<Arguments>--run-rule &quot;rule_daily_1&quot;</Arguments>'), 'Arguments must match rule ID');
  assert(xml.includes('<ExecutionTimeLimit>PT5M</ExecutionTimeLimit>'), 'ExecutionTimeLimit must be PT5M');
  assert(xml.includes('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>'), 'Must allow battery start');
  assert(xml.includes('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>'), 'Must not stop on battery');
  assert(xml.includes('<StartWhenAvailable>true</StartWhenAvailable>'), 'StartWhenAvailable must be true');
  assert(xml.includes('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>'), 'MultipleInstancesPolicy must be IgnoreNew');
});

// 2. Weekly Mon/Wed/Fri rule
it('Weekly rule creates ScheduleByWeek with Monday, Wednesday, Friday tags', () => {
  const rule = {
    id: 'rule_weekly_mwf',
    name: 'School Week Wi-Fi',
    when: 'weekly',
    days: [1, 3, 5],
    time: '08:00',
    action: 'connect'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\App\\app.exe', argsPrefix: '' });
  assert(xml.includes('<ScheduleByWeek>'), 'Should include ScheduleByWeek');
  assert(xml.includes('<DaysOfWeek>'), 'Should include DaysOfWeek');
  assert(xml.includes('<Monday />'), 'Should include Monday');
  assert(xml.includes('<Wednesday />'), 'Should include Wednesday');
  assert(xml.includes('<Friday />'), 'Should include Friday');
  assert(!xml.includes('<Sunday />'), 'Should NOT include Sunday');
  assert(!xml.includes('<Tuesday />'), 'Should NOT include Tuesday');
  assert(!xml.includes('<Thursday />'), 'Should NOT include Thursday');
  assert(!xml.includes('<Saturday />'), 'Should NOT include Saturday');
});

// 3. Once rule
it('Once rule creates TimeTrigger at exact date and time', () => {
  const rule = {
    id: 'rule_once_test',
    name: 'One Time Exam Mode',
    when: 'once',
    date: '2026-11-15',
    time: '14:45',
    action: 'disconnect'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\App\\app.exe', argsPrefix: '' });
  assert(xml.includes('<TimeTrigger>'), 'Should include TimeTrigger');
  assert(!xml.includes('<CalendarTrigger>'), 'Should not include CalendarTrigger');
  assert(xml.includes('<StartBoundary>2026-11-15T14:45:00</StartBoundary>'), 'Exact start boundary must match');
});

// 4. Monthly day 15 rule
it('Monthly day 15 rule creates single ScheduleByMonth trigger with Day 15', () => {
  const rule = {
    id: 'rule_monthly_15',
    name: 'Mid Month Reset',
    when: 'monthly',
    dayOfMonth: 15,
    time: '04:00',
    action: 'renew_ip'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\App\\app.exe', argsPrefix: '' });
  assert(xml.includes('<ScheduleByMonth>'), 'Should include ScheduleByMonth');
  assert(xml.includes('<Day>15</Day>'), 'Must specify Day 15');
  assert(!xml.includes('<Day>Last</Day>'), 'Day 15 must NOT have Day Last');
  const count = (xml.match(/<CalendarTrigger>/g) || []).length;
  assert.strictEqual(count, 1, 'Day 15 should have exactly 1 trigger');
});

// 5. Monthly day 31 rule with two triggers (Day 31 and Day Last)
it('Monthly day 31 rule creates two triggers including Day Last', () => {
  const rule = {
    id: 'rule_monthly_31',
    name: 'End Month Cutoff',
    when: 'monthly',
    dayOfMonth: 31,
    time: '23:59',
    action: 'disconnect'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\App\\app.exe', argsPrefix: '' });
  assert(xml.includes('<Day>31</Day>'), 'Should contain Day 31');
  assert(xml.includes('<Day>Last</Day>'), 'Should contain Day Last for clamped short months');
  const triggerCount = (xml.match(/<CalendarTrigger>/g) || []).length;
  assert.strictEqual(triggerCount, 2, 'Day 31 must have 2 triggers (exact day + Last day)');
});

// 6. Special characters in paths, names, and arguments
it('Escapes XML special characters in descriptions, paths, and arguments', () => {
  const rule = {
    id: 'rule_esc_1',
    name: 'Test & <Special> "Quotes" \'SSID\'',
    when: 'daily',
    time: '12:00',
    action: 'disconnect'
  };
  const exeInfo = {
    command: 'C:\\Program Files (x86)\\Wi-Fi & App\\Wi-Fi "OFF".exe',
    argsPrefix: '"C:\\Path & With <Sp>\\app" '
  };
  const xml = buildTaskXml(rule, {}, exeInfo);

  assert(!xml.includes('Test & <Special>'), 'Raw unescaped & < > must not be present');
  assert(xml.includes('Test &amp; &lt;Special&gt; &quot;Quotes&quot; &apos;SSID&apos;'), 'Name must be XML-escaped');
  assert(xml.includes('C:\\Program Files (x86)\\Wi-Fi &amp; App\\Wi-Fi &quot;OFF&quot;.exe'), 'Path must be XML-escaped');
  assert(xml.includes('--run-rule &quot;rule_esc_1&quot;'), 'Arguments must be XML-escaped');
});

// 7. Well-formed XML structural validation
it('Generates completely well-formed balanced XML with valid Principals and Settings', () => {
  const rule = {
    id: 'rule_xml_valid',
    name: 'Validation Rule',
    when: 'weekly',
    days: [0, 6],
    time: '10:15',
    action: 'toggle'
  };
  const xml = buildTaskXml(rule, {}, { command: 'C:\\test\\app.exe', argsPrefix: '' });

  // Check XML syntax structure
  verifyXmlBalanced(xml);

  // Check Principals
  assert(xml.includes('<Principal id="Author">'), 'Principal id must be Author');
  assert(xml.includes('<LogonType>InteractiveToken</LogonType>'), 'LogonType must be InteractiveToken');
  assert(xml.includes('<RunLevel>LeastPrivilege</RunLevel>'), 'RunLevel must be LeastPrivilege');
});

// 8. Rule ID validation regex test
it('Validates ruleId using /^[A-Za-z0-9_-]+$/', () => {
  assert.strictEqual(isValidRuleId('rule_123_abc'), true);
  assert.strictEqual(isValidRuleId('Rule-Nightly-99'), true);
  assert.strictEqual(isValidRuleId('rule 123 with spaces'), false);
  assert.strictEqual(isValidRuleId('rule;rmdir'), false);
  assert.strictEqual(isValidRuleId('rule/task'), false);
  assert.strictEqual(isValidRuleId(''), false);
});

console.log(`\nResults: ${passedCount}/${totalCount} tests passed.`);
if (passedCount === totalCount) {
  console.log('ALL TASK TESTS PASSED SUCCESSFULLY! ✓');
  process.exit(0);
} else {
  console.error('SOME TASK TESTS FAILED!');
  process.exit(1);
}
