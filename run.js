import 'dotenv/config';
import { google } from 'googleapis';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { slackUsers } from './slack-users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHEET_ID = process.env.SHEET_ID;
const SLACK_TOKEN = process.env.SLACK_TOKEN;
const SLACK_CHANNEL = process.env.SLACK_CHANNEL;
const SEND_SLACK = process.env.SEND_SLACK === 'true';

// ─── 日期工具 ─────────────────────────────────────────────────

function getLastMonthRange() {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed

  const pad = n => String(n).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();

  return {
    startDate: `${year}/${pad(month)}/01`,
    endDate: `${year}/${pad(month)}/${lastDay}`,
    tabName: `${year}-${pad(month)}`,
    year,
    month,
  };
}

// ─── ApolloHR API ───────────────────────────────────────────────

async function fetchAttendanceData(startDate, endDate, cookie) {
  const params = new URLSearchParams({
    departmentId: '',
    employeeId: '',
    endDate,
    exceptionIds: '',
    isNoAppliedForm: 'false',
    startDate,
  });

  const res = await fetch(
    `https://apollo.mayohr.com/backend/pt/api/checkinRecords/supervisor/exception?${params}`,
    {
      headers: {
        Cookie: cookie,
        Accept: '*/*',
        'Accept-Language': 'zh-tw',
        'actioncode': 'Default',
        'functioncode': 'SupervisorOddRecords',
        'cache-control': 'no-cache',
        'content-type': 'application/json',
        'pragma': 'no-cache',
        'Referer': 'https://apollo.mayohr.com/ta/supervisor/checkin/checkinrecords/oddrecords',
        'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ApolloHR API 回應錯誤：${res.status}\n${body.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.Data;
}

// ─── 資料處理 ─────────────────────────────────────────────────

const EXCEPTION_LABEL = {
  NoCheckIn: '上班未打卡',
  NoCheckOut: '下班未打卡',
  ComeLate: '遲到',
  LeaveEarly: '早退',
  PostponeCheckOut: '延後打卡異常',
};

function processData(records) {
  const empMap = new Map();
  const details = [];

  for (const record of records) {
    const { EmployeeName: name, EmployeeNumber: empNum, AppliedForms } = record;
    const date = record.Date.split('T')[0]; // YYYY-MM-DD
    const hasApplied = AppliedForms.length > 0;
    const hasNoCheck = record.Exceptions.some(
      e => e.ExceptionId === 'NoCheckIn' || e.ExceptionId === 'NoCheckOut'
    );

    if (!empMap.has(empNum)) {
      empMap.set(empNum, {
        name,
        empNum,
        lateCount: 0,
        lateTotalMin: 0,
        earlyCount: 0,
        earlyTotalMin: 0,
        noCheckDates: new Set(),
        unappliedDates: new Set(),
      });
    }

    const emp = empMap.get(empNum);

    if (hasNoCheck) {
      emp.noCheckDates.add(date);
      if (!hasApplied) emp.unappliedDates.add(date);
    }

    for (const ex of record.Exceptions) {
      if (ex.ExceptionId === 'ComeLate') {
        emp.lateCount++;
        emp.lateTotalMin += ex.Minute || 0;
      } else if (ex.ExceptionId === 'LeaveEarly') {
        emp.earlyCount++;
        emp.earlyTotalMin += ex.Minute || 0;
      }

      details.push({
        date,
        name,
        label: EXCEPTION_LABEL[ex.ExceptionId] || ex.ExceptionId,
        reason: ex.Reason,
        minute: ex.Minute ?? '',
        hasApplied,
      });
    }
  }

  const summary = Array.from(empMap.entries()).map(([, emp]) => ({
    ...emp,
    noCheckDates: [...emp.noCheckDates].sort(),
    unappliedDates: [...emp.unappliedDates].sort(),
  }));

  details.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  return { summary, details };
}

// ─── Google Sheets ────────────────────────────────────────────

async function writeToSheet(tabName, summary, details) {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // 建立新分頁（如果不存在）
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const exists = spreadsheet.data.sheets.some(s => s.properties.title === tabName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  }

  // 組合寫入資料
  const rows = [
    ['【摘要】'],
    ['姓名', '遲到次數', '遲到總分鐘', '早退次數', '早退總分鐘', '未打卡天數', '未補申請天數'],
    ...summary.map(e => [
      e.name,
      e.lateCount,
      e.lateTotalMin,
      e.earlyCount,
      e.earlyTotalMin,
      e.noCheckDates.length,
      e.unappliedDates.length,
    ]),
    [],
    ['【明細】'],
    ['日期', '姓名', '異常類型', '說明', '分鐘數', '已補申請'],
    ...details.map(d => [d.date, d.name, d.label, d.reason, d.minute, d.hasApplied ? '是' : '否']),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log(`  ✓ Google Sheet 寫入完成（tab: ${tabName}）`);
}

// ─── Slack 通知 ───────────────────────────────────────────────

async function sendSlackNotifications(summary, month) {
  const needsAction = summary.filter(e => e.unappliedDates.length > 0);

  if (needsAction.length === 0) {
    console.log('  ✓ 沒有需要提醒的未打卡紀錄');
    return;
  }

  for (const emp of needsAction) {
    const userId = slackUsers[emp.empNum];
    const mention = userId ? `<@${userId}>` : emp.name;
    const dates = emp.unappliedDates.map(d => d.replace(/-/g, '/')).join('、');
    const count = emp.unappliedDates.length;

    const text =
      `${mention} 嗨！${month} 月份有 ${count} 天未打卡紀錄` +
      `（${dates}）尚未補申請，` +
      `請記得至 Apollo 補打卡申請或補請假，以免被記曠職。`;

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: SLACK_CHANNEL, text }),
    });

    const json = await res.json();
    if (json.ok) {
      console.log(`  ✓ Slack 提醒已發送 → ${emp.name}`);
    } else {
      console.error(`  ✗ Slack 發送失敗（${emp.name}）：${json.error}`);
    }
  }
}

// ─── 主程式 ───────────────────────────────────────────────────

async function main() {
  const cookie = process.argv[2] || process.env.APOLLO_COOKIE;

  if (!cookie) {
    console.error('❌ 請提供 Cookie：\n   node run.js "<cookie 字串>"');
    process.exit(1);
  }

  const { startDate, endDate, tabName, month } = getLastMonthRange();
  console.log(`\n📅 處理範圍：${startDate} ~ ${endDate}\n`);

  console.log('📡 正在取得出缺勤資料...');
  const records = await fetchAttendanceData(startDate, endDate, cookie);
  console.log(`  ✓ 取得 ${records.length} 筆異常紀錄`);

  const { summary, details } = processData(records);

  console.log('\n📊 正在寫入 Google Sheet...');
  await writeToSheet(tabName, summary, details);

  if (SEND_SLACK) {
    console.log('\n📢 正在發送 Slack 提醒...');
    await sendSlackNotifications(summary, month);
  } else {
    console.log('\n📢 Slack 通知已關閉（SEND_SLACK=false）');
  }

  console.log('\n✅ 完成！\n');
}

main().catch(err => {
  console.error('\n❌ 錯誤：', err.message);
  process.exit(1);
});
