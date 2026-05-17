// ─── Settings ───────────────────────────────────────────────────────────────

function doGet(e) {
  if (e && e.parameter && e.parameter.code) {
    var t = HtmlService.createTemplate(
      '<!DOCTYPE html><html>' +
      '<head><meta charset="UTF-8"><style>' +
      'body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f7;' +
      'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}' +
      '.box{background:#fff;border-radius:16px;padding:32px 40px;text-align:center;' +
      'box-shadow:0 4px 24px rgba(0,0,0,.08);}' +
      'p{color:#1d1d1f;font-size:15px;margin-top:12px;}' +
      '.spinner{width:32px;height:32px;border:3px solid #e8e8ed;border-top-color:#0071e3;' +
      'border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '<\/style><\/head>' +
      '<body><div class="box"><div class="spinner"><\/div><p id="m">正在連接 Slack...<\/p>' +
      '<a id="r" href="<?!= appUrl ?>" target="_top" style="display:none;margin-top:16px;color:#0071e3;font-size:14px;text-decoration:none;">返回 App →<\/a><\/div>' +
      '<script>' +
      'google.script.run' +
      '.withSuccessHandler(function(){' +
      'document.querySelector(".spinner").style.display="none";' +
      'document.getElementById("m").textContent="Slack 已成功連接！";' +
      'var r=document.getElementById("r");r.style.display="block";' +
      'setTimeout(function(){r.click();},800);})' +
      '.withFailureHandler(function(err){' +
      'document.querySelector(".spinner").style.display="none";' +
      'var s=document.getElementById("m");' +
      's.textContent="錯誤："+(err.message||err);' +
      's.style.color="#c0392b";})' +
      '.handleSlackOAuthCallback(<?!= code ?>,<?!= state ?>);' +
      '<\/script><\/body><\/html>'
    );
    t.code = JSON.stringify(e.parameter.code);
    t.state = JSON.stringify(e.parameter.state || '');
    t.appUrl = _getRedirectUri();
    return t.evaluate().setTitle('連接 Slack...');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('OffBot 休假寶')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveSettings(employeeId, newSettings) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('settings_' + employeeId);
  var existing = raw ? JSON.parse(raw) : {};
  for (var key in newSettings) {
    existing[key] = newSettings[key];
  }
  props.setProperty('settings_' + employeeId, JSON.stringify(existing));
  return { success: true };
}

function getSettings(employeeId) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('settings_' + employeeId);
  if (!raw) return { slackUserToken: '', slackChannelId: '', slackBaseName: '', slackNotifyUserId: '' };
  return JSON.parse(raw);
}

// ─── Slack OAuth ─────────────────────────────────────────────────────────────

function _getRedirectUri() {
  return ScriptApp.getService().getUrl().replace(/\/a\/[^\/]+\/macros\//, '/macros/');
}

function startSlackOAuth(employeeId) {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('SLACK_CLIENT_ID');
  if (!clientId) throw new Error('Slack 應用程式尚未設定，請聯絡管理員。');
  var nonce = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  CacheService.getScriptCache().put('oauth_state_' + nonce, employeeId, 300);
  var redirectUri = _getRedirectUri();
  return 'https://slack.com/oauth/v2/authorize'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&user_scope=' + encodeURIComponent('users.profile:write,chat:write,channels:read')
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(employeeId + ':' + nonce);
}

function handleSlackOAuthCallback(code, state) {
  var parts = (state || '').split(':');
  if (parts.length < 2) throw new Error('無效的 state 參數');
  var employeeId = parts[0];
  var nonce = parts[1];

  var cache = CacheService.getScriptCache();
  var cached = cache.get('oauth_state_' + nonce);
  if (cached !== employeeId) throw new Error('驗證失敗，請重新嘗試登入');
  cache.remove('oauth_state_' + nonce);

  var props = PropertiesService.getScriptProperties();
  var response = UrlFetchApp.fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    payload: {
      client_id:     props.getProperty('SLACK_CLIENT_ID'),
      client_secret: props.getProperty('SLACK_CLIENT_SECRET'),
      code:          code,
      redirect_uri:  _getRedirectUri()
    },
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (!result.ok) throw new Error('授權失敗：' + result.error);

  var allowedTeamId = props.getProperty('SLACK_TEAM_ID');
  if (allowedTeamId && result.team && result.team.id !== allowedTeamId) {
    throw new Error('請使用 KKCompany Slack 帳號登入');
  }

  var userToken = result.authed_user && result.authed_user.access_token;
  if (!userToken) throw new Error('未取得使用者 Token');

  var raw = props.getProperty('settings_' + employeeId);
  var settings = raw ? JSON.parse(raw) : {};
  settings.slackUserToken = userToken;
  props.setProperty('settings_' + employeeId, JSON.stringify(settings));
  return { success: true };
}

function disconnectSlack(employeeId) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('settings_' + employeeId);
  if (!raw) return { success: true };
  var settings = JSON.parse(raw);
  delete settings.slackUserToken;
  props.setProperty('settings_' + employeeId, JSON.stringify(settings));
  return { success: true };
}

// ─── Claude Image Analysis ───────────────────────────────────────────────────

function analyzeScreenshot(imageBase64, mimeType) {
  var apiKey = 'sk-NYJidL2lcouXZlJe4dPh2A';

  var prompt = [
    '這是一張公司請假系統的截圖（中英混合介面）。',
    '請從截圖中找出以下資訊，並以 JSON 格式回傳：',
    '- userName: 請假人姓名。若姓名包含中文與英文（例如「張偉豪 Alex Wang」），只取英文部分（「Alex Wang」）。若只有英文則直接回傳。',
    '- substitute: 代理人姓名（欄位名稱可能是「代理人」或「Substitute」）。同樣只取英文部分。若找不到則為空字串。',
    '- rationale: 請假事由（欄位名稱可能是「事由」或「Rationale」）。若找不到則為空字串。',
    '- startDate: 開始日期，格式 YYYY-MM-DD',
    '- endDate: 結束日期，格式 YYYY-MM-DD（若為單日與 startDate 相同）',
    '- isFullDay: 是否為全天假（true/false）',
    '- startTime: 開始時間，格式 HH:mm（24 小時制）。若為全天假則為空字串。',
    '- endTime: 結束時間，格式 HH:mm（24 小時制）。若為全天假則為空字串。',
    '',
    '只回傳 JSON 物件，不要其他說明文字。'
  ].join('\n');

  var payload = {
    model: 'claude-opus-4-7',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: prompt }
      ]
    }]
  };

  var response = UrlFetchApp.fetch('https://llm-gateway.kkcompany-internal.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (result.error) throw new Error('Claude API 錯誤：' + result.error.message);

  var text = result.content[0].text.trim();
  text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(text);
}

// ─── Google Calendar ─────────────────────────────────────────────────────────

function createCalendarEvent(data) {
  var calendars = CalendarApp.getCalendarsByName('Leave.MT');
  if (!calendars.length) throw new Error('找不到名稱為 Leave.MT 的 Calendar');
  var calendar = calendars[0];
  var title = data.calendarTitle || (data.userName + ':Personal Leave [' + (data.substitute || '') + ']');
  var description = data.rationale || '';

  if (data.isFullDay) {
    var start = _parseDate(data.startDate);
    var end = _parseDate(data.endDate);
    end.setDate(end.getDate() + 1);
    calendar.createAllDayEvent(title, start, end, { description: description });
  } else {
    var startDt = _parseDateTime(data.startDate, data.startTime);
    var endDt = _parseDateTime(data.endDate, data.endTime);
    calendar.createEvent(title, startDt, endDt, { description: description });
  }

  return { success: true };
}

function _parseDate(dateStr) {
  var parts = dateStr.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

function _parseDateTime(dateStr, timeStr) {
  var parts = dateStr.split('-');
  var timeParts = timeStr.split(':');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]),
                  parseInt(timeParts[0]), parseInt(timeParts[1]));
}

// ─── Slack ───────────────────────────────────────────────────────────────────

function updateSlackDisplayName(token, displayName) {
  var response = UrlFetchApp.fetch('https://slack.com/api/users.profile.set', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=utf-8'
    },
    payload: JSON.stringify({
      profile: { display_name: displayName }
    }),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (!result.ok) throw new Error('Slack 更新名稱失敗：' + result.error);
  return { success: true };
}

function sendSlackNotification(token, channelId, message) {
  var response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json; charset=utf-8'
    },
    payload: JSON.stringify({
      channel: channelId,
      text: message
    }),
    muteHttpExceptions: true
  });

  var result = JSON.parse(response.getContentText());
  if (!result.ok) throw new Error('Slack 發送通知失敗：' + result.error);
  return { success: true };
}

function getSlackChannelName(employeeId, channelId) {
  if (!employeeId || !channelId) return '';
  var settings = getSettings(employeeId);
  var token = settings.slackUserToken;
  if (!token) return '';
  var response = UrlFetchApp.fetch('https://slack.com/api/conversations.info?channel=' + channelId, {
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });
  var result = JSON.parse(response.getContentText());
  if (!result.ok) return '';
  return '#' + result.channel.name;
}

// ─── Execute All ─────────────────────────────────────────────────────────────

function executeAll(employeeId, data) {
  var settings = getSettings(employeeId);
  var slackToken = settings.slackUserToken;
  var channelId = settings.slackChannelId;

  var results = {
    calendar:    null,
    slackName:   null,
    slackNotify: null
  };

  if (data.enableCalendar) {
    results.calendar = { success: false, error: '' };
    try {
      createCalendarEvent(data);
      results.calendar.success = true;
    } catch (e) {
      results.calendar.error = e.message;
    }
  }

  if (data.enableSlackName) {
    results.slackName = { success: false, error: '' };
    try {
      updateSlackDisplayName(slackToken, data.displayName);
      results.slackName.success = true;
    } catch (e) {
      results.slackName.error = e.message;
    }
  }

  if (data.enableSlackNotify) {
    results.slackNotify = { success: false, error: '' };
    try {
      sendSlackNotification(slackToken, channelId, data.notifyMessage);
      results.slackNotify.success = true;
    } catch (e) {
      results.slackNotify.error = e.message;
    }
  }

  return results;
}
