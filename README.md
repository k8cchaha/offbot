# Leave Automation

自動抓取 ApolloHR 出缺勤異常紀錄，寫入 Google Sheet 並透過 Slack 提醒未補申請的未打卡員工。

---

## 功能說明

- 抓取上個月的出缺勤異常紀錄（遲到、早退、未打卡等）
- 將資料寫入 Google Sheet（每月一個分頁）
- 針對有未打卡且未補申請的員工，發送 Slack @mention 提醒

---

## 環境需求

- Node.js 18+
- Google Cloud Service Account（有 Google Sheets API 權限）
- Slack User Token（`xoxp-` 開頭）

---

## 初次設定

### 1. 安裝套件

```bash
npm install
```

### 2. 設定 `.env`

複製以下內容建立 `.env` 檔，填入對應值：

```env
SHEET_ID=                  # Google Sheet 的 ID（URL 中間那段）
SLACK_TOKEN=               # Slack User Token（xoxp-...）
SLACK_CHANNEL=             # Slack 頻道 ID（例如 C03B6KW6C9K）
SEND_SLACK=false           # true = 發送 Slack 通知，false = 只寫 Sheet
# 每次執行前更新
APOLLO_COOKIE=
```

**取得 Google Sheet ID：**
從 URL 中複製：
```
https://docs.google.com/spreadsheets/d/<這段就是 SHEET_ID>/edit
```

**取得 Slack 頻道 ID：**
在 Slack 點擊頻道名稱 → 下拉選單最底部可看到頻道 ID。

### 3. 放入 Google Service Account 憑證

將 GCP 下載的 JSON key 檔案重新命名為 `credentials.json`，放到本專案根目錄。

> 確認這個 Service Account 的 email 已被加入 Google Sheet 的編輯權限。

### 4. 設定員工 Slack ID 對應表

編輯 `slack-users.js`，填入員工編號（ApolloHR 的 `EmployeeNumber`）與 Slack User ID 的對應：

```js
export const slackUsers = {
  '1911004': 'U01XXXXXXXX',
  '2008004': 'U02XXXXXXXX',
};
```

**取得 Slack User ID：**
點對方頭像 → View profile → 右上角 `⋯` → Copy member ID

---

## 每月執行步驟

### Step 1：更新 Cookie

由於 ApolloHR 的 session 約 **7 天**過期，每次執行前需要更新 Cookie。

1. 登入 `apollo.mayohr.com`
2. 開啟 DevTools → Network tab
3. 進入出缺勤查詢頁面，點擊查詢
4. 找到 API request → 右鍵 → **Copy → Copy as cURL**
5. 從 cURL 指令中取出 `-b '...'` 的 Cookie 字串
6. 貼入 `.env` 的 `APOLLO_COOKIE=` 後面

### Step 2：執行腳本

```bash
node run.js
```

預設只寫入 Google Sheet，不發 Slack 通知。

### Step 3：確認 Google Sheet 內容

確認新分頁（例如 `2026-05`）的摘要與明細資料正確。

### Step 4：發送 Slack 提醒

確認內容無誤後，將 `.env` 的開關改為 `true`：

```env
SEND_SLACK=true
```

再執行一次：

```bash
node run.js
```

執行完畢後記得將 `SEND_SLACK` 改回 `false`。

---

## Google Sheet 格式

每月產生一個分頁，分頁名稱格式為 `YYYY-MM`（例如 `2026-05`）。

**摘要區塊**（每位員工一行）

| 姓名 | 遲到次數 | 遲到總分鐘 | 早退次數 | 早退總分鐘 | 未打卡天數 | 未補申請天數 |
|------|---------|-----------|---------|-----------|-----------|------------|

**明細區塊**（每筆異常一行）

| 日期 | 姓名 | 異常類型 | 說明 | 分鐘數 | 已補申請 |
|------|------|---------|------|-------|---------|

---

## Slack 通知格式

只有「有未打卡且未補申請」的員工才會收到通知：

```
@員工 嗨！5 月份有 3 天未打卡紀錄（2026/05/08、2026/05/15、2026/05/22）
尚未補申請，請記得至 Apollo 補打卡申請或補請假，以免被記曠職。
```

---

## 檔案結構

```
leave-automation/
├── run.js            # 主程式
├── slack-users.js    # 員工編號 → Slack User ID 對應表
├── .env              # 設定值（勿提交至 git）
├── credentials.json  # Google Service Account 憑證（勿提交至 git）
└── package.json
```
