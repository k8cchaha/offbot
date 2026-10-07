// ─── Settings ───────────────────────────────────────────────────────────────

var GOOGLE_CALENDAR_SCOPE_ = 'https://www.googleapis.com/auth/calendar.events.owned';

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  if (params.code || params.error) {
    var provider = getOAuthProvider_(params.state || '');
    if (provider === 'slack' || provider === 'google') {
      return renderOAuthCallback_(provider, params);
    }
    return renderOAuthError_();
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('OffBot 休假寶')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderOAuthCallback_(provider, params) {
  var isGoogle = provider === 'google';
  var handler = isGoogle ? 'handleGoogleOAuthCallback' : 'handleSlackOAuthCallback';
  var serviceName = isGoogle ? 'Google' : 'Slack';
  var successScript = isGoogle
    ? 'var status=(res&&res.status)||"failed";' +
      'try{localStorage.setItem("googleOAuthResult",JSON.stringify({status:status}));}catch(e){}' +
      'document.getElementById("m").textContent="Google 授權處理完成，正在返回設定...";' +
      'returnToApp();'
    : 'try{localStorage.setItem("slackUserId",res.slackUserId);}catch(e){}' +
      'document.getElementById("m").textContent="Slack 已成功連接！";' +
      'returnToApp();';
  var failureScript = isGoogle
    ? 'try{localStorage.setItem("googleOAuthResult",JSON.stringify({status:"failed"}));}catch(e){}' +
      'document.getElementById("m").textContent="Google 授權處理失敗，正在返回設定...";' +
      'document.getElementById("m").style.color="#c0392b";' +
      'returnToApp();'
    : 'document.getElementById("m").textContent="錯誤："+(err.message||err);' +
      'document.getElementById("m").style.color="#c0392b";' +
      'document.getElementById("r").style.display="block";';

  var t = HtmlService.createTemplate(
    '<!DOCTYPE html><html>' +
    '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f5f7;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}' +
    '.box{background:#fff;border-radius:16px;padding:32px 40px;text-align:center;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.08);}' +
    'p{color:#1d1d1f;font-size:15px;margin-top:12px;}' +
    '.spinner{width:32px;height:32px;border:3px solid #e8e8ed;border-top-color:#0071e3;' +
    'border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '<\/style><\/head>' +
    '<body><div class="box"><div class="spinner"><\/div><p id="m">正在連接 ' + serviceName + '...<\/p>' +
    '<a id="r" target="_top" style="display:none;margin-top:16px;color:#0071e3;font-size:14px;text-decoration:none;">返回 App →<\/a><\/div>' +
    '<script>' +
    'var appUrl=<?!= appUrl ?>;' +
    'var r=document.getElementById("r");r.href=appUrl;' +
    'function returnToApp(){document.querySelector(".spinner").style.display="none";r.style.display="block";setTimeout(function(){r.click();},800);}' +
    'google.script.run' +
    '.withSuccessHandler(function(res){document.querySelector(".spinner").style.display="none";' + successScript + '})' +
    '.withFailureHandler(function(err){document.querySelector(".spinner").style.display="none";' + failureScript + '})' +
    '.' + handler + '(<?!= code ?>,<?!= state ?>,<?!= oauthError ?>);' +
    '<\/script><\/body><\/html>'
  );
  t.code = jsonForInlineScript_(params.code || '');
  t.state = jsonForInlineScript_(params.state || '');
  t.oauthError = jsonForInlineScript_(params.error || '');
  t.appUrl = jsonForInlineScript_(_getRedirectUri());
  return t.evaluate()
    .setTitle('連接 ' + serviceName + '...')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function renderOAuthError_() {
  var t = HtmlService.createTemplate(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><\/head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:48px 20px;">' +
    '<p style="color:#c0392b;">授權流程已失效，請返回 App 後重新嘗試。<\/p>' +
    '<a href="<?= appUrl ?>" target="_top" style="color:#0071e3;">返回 App →<\/a><\/body><\/html>'
  );
  t.appUrl = _getRedirectUri();
  return t.evaluate()
    .setTitle('授權失敗')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function saveSettings(slackUserId, newSettings) {
  var allowedKeys = ['slackChannelId', 'slackBaseName', 'slackNotifyUserId'];
  var updates = {};
  newSettings = newSettings || {};
  allowedKeys.forEach(function(key) {
    if (Object.prototype.hasOwnProperty.call(newSettings, key)) {
      updates[key] = String(newSettings[key] || '');
    }
  });
  updateSettingsInternal_(slackUserId, updates);
  return { success: true };
}

function getSettings(slackUserId) {
  var settings = getSettingsInternal_(slackUserId);
  var googleConnection = getGoogleConnectionStatus_(slackUserId);
  return {
    slackChannelId: settings.slackChannelId || '',
    slackBaseName: settings.slackBaseName || '',
    slackNotifyUserId: settings.slackNotifyUserId || '',
    googleConnection: googleConnection
  };
}

function getSettingsInternal_(slackUserId) {
  var raw = PropertiesService.getScriptProperties().getProperty('settings_' + slackUserId);
  return raw ? JSON.parse(raw) : {};
}

function updateSettingsInternal_(slackUserId, updates) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty('settings_' + slackUserId);
    var settings = raw ? JSON.parse(raw) : {};
    Object.keys(updates).forEach(function(key) {
      settings[key] = updates[key];
    });
    props.setProperty('settings_' + slackUserId, JSON.stringify(settings));
  } finally {
    lock.releaseLock();
  }
}

// ─── OAuth helpers ───────────────────────────────────────────────────────────

function _getRedirectUri() {
  return ScriptApp.getService().getUrl().replace(/\/a\/[^\/]+\/macros\//, '/macros/');
}

function jsonForInlineScript_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function createOAuthState_(provider, payload) {
  var state = provider + '.' + Utilities.getUuid().replace(/-/g, '');
  var record = payload || {};
  record.provider = provider;
  record.createdAt = Date.now();
  record.expiresAt = Date.now() + 15 * 60 * 1000;

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var allProperties = props.getProperties();
    Object.keys(allProperties).forEach(function(key) {
      if (key.indexOf('oauth_state_') !== 0) return;
      try {
        var existing = JSON.parse(allProperties[key]);
        if (!existing.expiresAt || existing.expiresAt < Date.now()) props.deleteProperty(key);
      } catch (err) {
        props.deleteProperty(key);
      }
    });
    props.setProperty('oauth_state_' + state, JSON.stringify(record));
  } finally {
    lock.releaseLock();
  }
  return state;
}

function getOAuthProvider_(state) {
  if (typeof state !== 'string') return '';
  if (state.indexOf('slack.') === 0) return 'slack';
  if (state.indexOf('google.') === 0) return 'google';
  return '';
}

function consumeOAuthState_(state, expectedProvider) {
  if (getOAuthProvider_(state) !== expectedProvider) {
    throw new Error('驗證失敗，請重新嘗試');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'oauth_state_' + state;
    var raw = props.getProperty(key);
    if (!raw) throw new Error('授權已逾時，請重新嘗試');
    props.deleteProperty(key);
    var record = JSON.parse(raw);
    if (record.provider !== expectedProvider) throw new Error('驗證失敗，請重新嘗試');
    if (!record.expiresAt || record.expiresAt < Date.now()) throw new Error('授權已逾時，請重新嘗試');
    return record;
  } finally {
    lock.releaseLock();
  }
}

// ─── Slack OAuth ─────────────────────────────────────────────────────────────

function startSlackOAuth() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('SLACK_CLIENT_ID');
  if (!clientId) throw new Error('Slack 應用程式尚未設定，請聯絡管理員。');
  var state = createOAuthState_('slack', {});
  var redirectUri = _getRedirectUri();
  var teamId = props.getProperty('SLACK_TEAM_ID');
  var url = 'https://slack.com/oauth/v2/authorize'
    + '?client_id=' + encodeURIComponent(clientId)
    + '&user_scope=' + encodeURIComponent('users.profile:write,chat:write,channels:read,groups:read')
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state=' + encodeURIComponent(state);
  if (teamId) url += '&team=' + encodeURIComponent(teamId);
  return url;
}

function handleSlackOAuthCallback(code, state, oauthError) {
  consumeOAuthState_(state, 'slack');
  if (oauthError) throw new Error(oauthError === 'access_denied' ? 'Slack 授權已取消' : 'Slack 授權失敗');
  if (!code) throw new Error('未取得 Slack 授權碼');

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

  var slackUserId = result.authed_user.id;
  updateSettingsInternal_(slackUserId, { slackUserToken: userToken });
  return { success: true, slackUserId: slackUserId };
}

// ─── Google OAuth ────────────────────────────────────────────────────────────

function startGoogleOAuth(slackUserId) {
  var settings = getSettingsInternal_(slackUserId);
  if (!slackUserId || !settings.slackUserToken) {
    throw new Error('Slack 登入狀態無效，請重新登入。');
  }
  if (getGoogleCredential_(slackUserId)) {
    throw new Error('此帳號已綁定 Google，請先解除綁定。');
  }

  var config = getGoogleOAuthConfig_();
  var state = createOAuthState_('google', { slackUserId: slackUserId });
  return 'https://accounts.google.com/o/oauth2/v2/auth'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(config.clientId)
    + '&redirect_uri=' + encodeURIComponent(_getRedirectUri())
    + '&scope=' + encodeURIComponent('openid email ' + GOOGLE_CALENDAR_SCOPE_)
    + '&access_type=offline'
    + '&prompt=' + encodeURIComponent('select_account consent')
    + '&include_granted_scopes=true'
    + '&hd=' + encodeURIComponent(config.domain)
    + '&state=' + encodeURIComponent(state);
}

function handleGoogleOAuthCallback(code, state, oauthError) {
  var stateRecord = consumeOAuthState_(state, 'google');
  if (oauthError) {
    return { success: false, status: oauthError === 'access_denied' ? 'cancelled' : 'failed' };
  }
  if (!code) return { success: false, status: 'failed' };

  var slackUserId = stateRecord.slackUserId;
  if (!slackUserId || getGoogleCredential_(slackUserId)) {
    return { success: false, status: 'already_connected' };
  }

  try {
    var config = getGoogleOAuthConfig_();
    var tokenResult = exchangeGoogleCode_(code, config);
    if (!tokenResult.access_token) return { success: false, status: 'failed' };
    if (!tokenResult.refresh_token) {
      revokeGoogleToken_(tokenResult.access_token);
      return { success: false, status: 'missing_refresh_token' };
    }

    var grantedScopes = (tokenResult.scope || '').split(/\s+/).filter(String);
    if (grantedScopes.length && grantedScopes.indexOf(GOOGLE_CALENDAR_SCOPE_) === -1) {
      revokeGoogleToken_(tokenResult.refresh_token);
      return { success: false, status: 'missing_scope' };
    }

    var userInfo = fetchGoogleUserInfo_(tokenResult.access_token);
    if (!isAllowedGoogleUser_(userInfo, config.domain)) {
      revokeGoogleToken_(tokenResult.refresh_token);
      return { success: false, status: 'wrong_domain' };
    }

    var credential = {
      version: 1,
      subject: userInfo.sub,
      email: userInfo.email,
      refreshToken: tokenResult.refresh_token,
      scopes: grantedScopes,
      connectedAt: new Date().toISOString()
    };

    var alreadyConnected = false;
    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      var props = PropertiesService.getScriptProperties();
      var key = 'google_oauth_' + slackUserId;
      alreadyConnected = !!props.getProperty(key);
      if (!alreadyConnected) props.setProperty(key, JSON.stringify(credential));
    } finally {
      lock.releaseLock();
    }
    if (alreadyConnected) {
      revokeGoogleToken_(tokenResult.refresh_token);
      return { success: false, status: 'already_connected' };
    }

    return { success: true, status: 'connected' };
  } catch (err) {
    if (typeof tokenResult !== 'undefined' && tokenResult.refresh_token) {
      revokeGoogleToken_(tokenResult.refresh_token);
    }
    return { success: false, status: 'failed' };
  }
}

function unlinkGoogleAccount(slackUserId) {
  var settings = getSettingsInternal_(slackUserId);
  if (!slackUserId || !settings.slackUserToken) {
    throw new Error('Slack 登入狀態無效，請重新登入。');
  }

  var credential = getGoogleCredential_(slackUserId);
  if (!credential) return { success: true };

  if (!revokeGoogleToken_(credential.refreshToken)) {
    throw new Error('Google 解除綁定失敗，請稍後再試。');
  }

  PropertiesService.getScriptProperties().deleteProperty('google_oauth_' + slackUserId);
  return { success: true };
}

function revokeGoogleToken_(token) {
  if (!token) return true;
  try {
    var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      payload: { token: token },
      muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    return status === 200 || status === 400;
  } catch (err) {
    return false;
  }
}

function getGoogleOAuthConfig_() {
  var props = PropertiesService.getScriptProperties();
  var config = {
    clientId: props.getProperty('GOOGLE_CLIENT_ID'),
    clientSecret: props.getProperty('GOOGLE_CLIENT_SECRET'),
    domain: (props.getProperty('GOOGLE_WORKSPACE_DOMAIN') || '').replace(/^@/, '').toLowerCase()
  };
  if (!config.clientId || !config.clientSecret || !config.domain) {
    throw new Error('Google OAuth 尚未設定完成，請聯絡管理員。');
  }
  return config;
}

function exchangeGoogleCode_(code, config) {
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: code,
      redirect_uri: _getRedirectUri(),
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Google token exchange failed');
  }
  return JSON.parse(response.getContentText());
}

function fetchGoogleUserInfo_(accessToken) {
  var response = UrlFetchApp.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Google user info failed');
  }
  return JSON.parse(response.getContentText());
}

function isAllowedGoogleUser_(userInfo, expectedDomain) {
  if (!userInfo || !userInfo.sub || !userInfo.email || userInfo.email_verified !== true) return false;
  var parts = userInfo.email.toLowerCase().split('@');
  if (parts.length !== 2 || parts[1] !== expectedDomain) return false;
  return !!userInfo.hd && userInfo.hd.toLowerCase() === expectedDomain;
}

function getGoogleCredential_(slackUserId) {
  var props = PropertiesService.getScriptProperties();
  var key = 'google_oauth_' + slackUserId;
  var raw = props.getProperty(key);
  if (!raw) return null;

  var credential;
  try {
    credential = JSON.parse(raw);
  } catch (err) {
    deleteGoogleCredentialRawIfCurrent_(key, raw);
    return null;
  }
  if (!credential || !credential.refreshToken || !credential.email) {
    deleteGoogleCredentialRawIfCurrent_(key, raw);
    return null;
  }
  return credential;
}

function deleteGoogleCredentialRawIfCurrent_(key, raw) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty(key) === raw) props.deleteProperty(key);
  } finally {
    lock.releaseLock();
  }
}

function getGoogleConnectionStatus_(slackUserId) {
  var credential = getGoogleCredential_(slackUserId);
  return {
    connected: !!credential,
    email: credential ? credential.email : ''
  };
}

// ─── Claude Image Analysis ───────────────────────────────────────────────────

function analyzeScreenshot(imageBase64, mimeType) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');

  var prompt = [
    '這是一張公司請假系統的截圖（中英混合介面）。',
    '請從截圖中找出以下資訊，並以 JSON 格式回傳：',
    '- userName: 請假人姓名。若姓名包含中文與英文（例如「張偉豪 Alex Wang」），只取英文部分（「Alex Wang」）。若只有英文則直接回傳。',
    '- substitute: 代理人姓名（欄位名稱可能是「代理人」或「Substitute」）。同樣只取英文部分。若找不到則為空字串。',
    '- startDate: 開始日期，格式 YYYY-MM-DD',
    '- endDate: 結束日期，格式 YYYY-MM-DD（若為單日與 startDate 相同）',
    '- isFullDay: 是否為全天假（true/false）',
    '- startTime: 開始時間，格式 HH:mm（24 小時制）。若為全天假則為空字串。',
    '- endTime: 結束時間，格式 HH:mm（24 小時制）。若為全天假則為空字串。',
    '',
    '只回傳 JSON 物件，不要其他說明文字。'
  ].join('\n');

  var payload = {
    model: 'gpt-6-sol',
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

function createCalendarError_(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function refreshGoogleAccessToken_(slackUserId) {
  var props = PropertiesService.getScriptProperties();
  var key = 'google_oauth_' + slackUserId;
  var hadStoredCredential = !!props.getProperty(key);
  var credential = getGoogleCredential_(slackUserId);
  if (!credential) {
    if (hadStoredCredential) {
      throw createCalendarError_('GOOGLE_REAUTH_REQUIRED', 'Google 綁定資料已失效，請重新綁定 Google 帳號。');
    }
    throw createCalendarError_('GOOGLE_NOT_CONNECTED', '請先至設定綁定 Google 帳號。');
  }
  if (Array.isArray(credential.scopes) && credential.scopes.length &&
      credential.scopes.indexOf(GOOGLE_CALENDAR_SCOPE_) === -1) {
    deleteGoogleCredentialIfCurrent_(slackUserId, credential.refreshToken);
    throw createCalendarError_('GOOGLE_REAUTH_REQUIRED', 'Google Calendar 授權已失效，請重新綁定 Google 帳號。');
  }

  var response;
  try {
    var config = getGoogleOAuthConfig_();
    response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: credential.refreshToken,
        grant_type: 'refresh_token'
      },
      muteHttpExceptions: true
    });
  } catch (err) {
    throw createCalendarError_('GOOGLE_REFRESH_FAILED', '暫時無法取得 Google 授權，請稍後再試。');
  }

  var status = response.getResponseCode();
  var result = {};
  try {
    result = JSON.parse(response.getContentText());
  } catch (err) {}

  if (status >= 200 && status < 300 && result.access_token) {
    var refreshedScopes = (result.scope || '').split(/\s+/).filter(String);
    if (refreshedScopes.length && refreshedScopes.indexOf(GOOGLE_CALENDAR_SCOPE_) === -1) {
      deleteGoogleCredentialIfCurrent_(slackUserId, credential.refreshToken);
      throw createCalendarError_('GOOGLE_REAUTH_REQUIRED', 'Google Calendar 授權已失效，請重新綁定 Google 帳號。');
    }
    return {
      accessToken: result.access_token,
      refreshToken: credential.refreshToken
    };
  }
  if (result.error === 'invalid_grant') {
    deleteGoogleCredentialIfCurrent_(slackUserId, credential.refreshToken);
    throw createCalendarError_('GOOGLE_REAUTH_REQUIRED', 'Google 授權已失效，請重新綁定 Google 帳號。');
  }
  throw createCalendarError_('GOOGLE_REFRESH_FAILED', '暫時無法取得 Google 授權，請稍後再試。');
}

function deleteGoogleCredentialIfCurrent_(slackUserId, refreshToken) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'google_oauth_' + slackUserId;
    var raw = props.getProperty(key);
    if (!raw) return;
    var current;
    try {
      current = JSON.parse(raw);
    } catch (err) {
      props.deleteProperty(key);
      return;
    }
    if (current.refreshToken === refreshToken) props.deleteProperty(key);
  } finally {
    lock.releaseLock();
  }
}

function parseCalendarDate_(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw createCalendarError_('CALENDAR_INVALID_INPUT', '請填寫正確的開始與結束日期。');
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw createCalendarError_('CALENDAR_INVALID_INPUT', '請填寫有效的開始與結束日期。');
  }
  return { year: year, month: month, day: day };
}

function formatCalendarDate_(date) {
  return String(date.year).padStart(4, '0') + '-' +
    String(date.month).padStart(2, '0') + '-' +
    String(date.day).padStart(2, '0');
}

function addCalendarDays_(date, days) {
  var shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate()
  };
}

function parseCalendarTime_(value) {
  var match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw createCalendarError_('CALENDAR_INVALID_INPUT', '請填寫有效的開始與結束時間。');
  }
  return match[1] + ':' + match[2];
}

function buildOutOfOfficePeriod_(data) {
  var startDate = parseCalendarDate_(data.startDate);
  var endDate = parseCalendarDate_(data.endDate);
  var startDateText = formatCalendarDate_(startDate);
  var endDateText = formatCalendarDate_(endDate);
  var startDateTime;
  var endDateTime;

  if (data.isFullDay === true) {
    if (endDateText < startDateText) {
      throw createCalendarError_('CALENDAR_INVALID_INPUT', '結束日期不可早於開始日期。');
    }
    startDateTime = startDateText + 'T00:00:00+08:00';
    endDateTime = formatCalendarDate_(addCalendarDays_(endDate, 1)) + 'T00:00:00+08:00';
  } else {
    var startTime = parseCalendarTime_(data.startTime);
    var endTime = parseCalendarTime_(data.endTime);
    startDateTime = startDateText + 'T' + startTime + ':00+08:00';
    endDateTime = endDateText + 'T' + endTime + ':00+08:00';
    if (endDateTime <= startDateTime) {
      throw createCalendarError_('CALENDAR_INVALID_INPUT', '結束時間必須晚於開始時間。');
    }
  }

  return {
    start: { dateTime: startDateTime, timeZone: 'Asia/Taipei' },
    end: { dateTime: endDateTime, timeZone: 'Asia/Taipei' }
  };
}

function createCalendarEvent(slackUserId, data) {
  var title = String(data.calendarTitle || '').trim();
  if (!title) throw createCalendarError_('CALENDAR_INVALID_INPUT', 'Google Calendar 事件標題不可為空白。');
  if (title.length > 200) throw createCalendarError_('CALENDAR_INVALID_INPUT', 'Google Calendar 事件標題不可超過 200 個字元。');

  var period = buildOutOfOfficePeriod_(data);
  var authorization = refreshGoogleAccessToken_(slackUserId);
  var event = {
    summary: title,
    eventType: 'outOfOffice',
    visibility: 'public',
    transparency: 'opaque',
    status: 'confirmed',
    start: period.start,
    end: period.end,
    outOfOfficeProperties: {
      autoDeclineMode: 'declineAllConflictingInvitations',
      declineMessage: '休假中，無法參加此會議。'
    }
  };

  var response;
  try {
    response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + authorization.accessToken },
      payload: JSON.stringify(event),
      muteHttpExceptions: true
    });
  } catch (err) {
    throw createCalendarError_('CALENDAR_UNAVAILABLE', '暫時無法連線至 Google Calendar，請稍後再試。');
  }

  var status = response.getResponseCode();
  if (status >= 200 && status < 300) return { success: true };
  if (status === 400) throw createCalendarError_('CALENDAR_BAD_REQUEST', 'Google Calendar 無法建立此事件，請確認日期與時間。');
  if (status === 401 || (status === 403 && isGoogleAuthorizationError_(response))) {
    deleteGoogleCredentialIfCurrent_(slackUserId, authorization.refreshToken);
    throw createCalendarError_('GOOGLE_REAUTH_REQUIRED', 'Google Calendar 授權已失效，請重新綁定 Google 帳號。');
  }
  if (status === 403) throw createCalendarError_('CALENDAR_PERMISSION_DENIED', 'Google Calendar 拒絕建立此事件，請確認帳號權限。');
  if (status === 409) throw createCalendarError_('CALENDAR_CONFLICT', 'Google Calendar 回報事件衝突，請稍後再試。');
  if (status === 429) throw createCalendarError_('CALENDAR_RATE_LIMITED', 'Google Calendar 請求過於頻繁，請稍後再試。');
  if (status >= 500) throw createCalendarError_('CALENDAR_UNAVAILABLE', 'Google Calendar 暫時無法使用，請稍後再試。');
  throw createCalendarError_('CALENDAR_REQUEST_FAILED', 'Google Calendar 事件建立失敗，請稍後再試。');
}

function isGoogleAuthorizationError_(response) {
  try {
    var result = JSON.parse(response.getContentText());
    var errors = result.error && result.error.errors;
    if (!Array.isArray(errors)) return false;
    return errors.some(function(error) {
      return error.reason === 'authError' ||
        error.reason === 'insufficientPermissions' ||
        error.reason === 'forbidden';
    });
  } catch (err) {
    return false;
  }
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

function getSlackChannelName(slackUserId, channelId) {
  channelId = String(channelId || '').trim();
  if (!slackUserId || !channelId) return '';
  var settings = getSettingsInternal_(slackUserId);
  var token = settings.slackUserToken;
  if (!token) return '';
  var response = UrlFetchApp.fetch(
    'https://slack.com/api/conversations.info?channel=' + encodeURIComponent(channelId),
    {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    }
  );
  var result = JSON.parse(response.getContentText());
  if (!result.ok || !result.channel) return '';
  return '#' + (result.channel.name || result.channel.name_normalized || channelId);
}

// ─── Execute All ─────────────────────────────────────────────────────────────

function executeAll(slackUserId, data) {
  var settings = getSettingsInternal_(slackUserId);
  var slackToken = settings.slackUserToken;
  var channelId = settings.slackChannelId;

  var results = {
    calendar:    null,
    slackName:   null,
    slackNotify: null
  };

  if (data.enableCalendar) {
    results.calendar = { success: false, error: '', code: '' };
    try {
      createCalendarEvent(slackUserId, data);
      results.calendar.success = true;
    } catch (e) {
      results.calendar.code = e.code || 'CALENDAR_FAILED';
      results.calendar.error = e.message || 'Google Calendar 事件建立失敗，請稍後再試。';
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
