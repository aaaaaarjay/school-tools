/**
 * Apps Script backend for Attendance System
 * - Set `SPREADSHEET_ID` and `ADMIN_SECRET` below
 * - Deploy as Web App (Execute as: Me, Who has access: Anyone, even anonymous)
 */

var SPREADSHEET_ID = '1ITfCPWAi-pyFS2ZSRyRoXDfYGPhlWZL0nbhz58ZnceI';
var SCHOOL_LAT = 10.2943724;
var SCHOOL_LON = 123.8960114;
var GEOFENCE_M = 100;
var COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
var ADMIN_SECRET = '120823';

/**
 * Handle POST JSON requests. Accepts JSON payload with `action`.
 */
function doPost(e) {
  try {
    var payload = null;
    // Try JSON body first
    if (e.postData && e.postData.contents) {
      try { payload = JSON.parse(e.postData.contents); } catch (err) { payload = null; }
    }
    // Fall back to form-encoded parameters if JSON parse failed or had no action
    if (!payload || !payload.action) {
      if (e.parameter && e.parameter.action) {
        payload = {};
        Object.keys(e.parameter).forEach(function(k){ payload[k] = e.parameter[k]; });
      }
    }
    if (!payload || !payload.action) {
      return jsonResponse({ success:false, message: 'No POST payload or missing action' });
    }

    var action = payload.action;
    if (!action) return jsonResponse({ success:false, message: 'Missing action' });

    if (action === 'submit_attendance') return jsonResponse(handleSubmitAttendance(payload));
    if (action === 'upload_roster') {
      if (payload.adminSecret !== ADMIN_SECRET) return jsonResponse({ success:false, message:'unauthorized' });
      return jsonResponse(handleUploadRoster(payload));
    }
    if (action === 'get_roster') return jsonResponse({ success:true, roster:getRoster() });
    if (action === 'get_active_section') return jsonResponse({ success:true, active:getActiveSection() });
    if (action === 'get_attendance') return jsonResponse({ success:true, attendance:getAttendance() });
    if (action === 'set_active_section') {
      if (payload.adminSecret !== ADMIN_SECRET) return jsonResponse({ success:false, message:'unauthorized' });
      setActiveSection(payload.section);
      return jsonResponse({ success:true });
    }
    return jsonResponse({ success:false, message:'unknown action' });
  } catch (err) {
    return jsonResponse({ success:false, message: err.toString() });
  }
}


/**
 * Support GET requests and JSONP for read-only endpoints (and safe fallbacks).
 * Example: <script src="WEB_APP_URL?action=get_attendance&callback=cb"></script>
 */
function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) ? e.parameter.action : '';
    var callback = (e.parameter && e.parameter.callback) ? e.parameter.callback : null;
    var result = { success:false, message:'unknown action' };

    if (action === 'get_attendance') {
      var sinceRowParam = (e.parameter && e.parameter.sinceRow) ? e.parameter.sinceRow : null;
      var sinceParam = (e.parameter && e.parameter.since) ? e.parameter.since : null;
      var attSheet = getSheet('Attendance');
      var lastRow = attSheet.getLastRow();
      if (sinceRowParam) {
        var sr = parseInt(sinceRowParam, 10) || 0;
        result = { success:true, attendance: getAttendanceSinceRow(sr), lastRow: lastRow };
      } else if (sinceParam) {
        result = { success:true, attendance: getAttendanceSince(sinceParam), lastRow: lastRow };
      } else {
        result = { success:true, attendance: getAttendance(), lastRow: lastRow };
      }
    } else if (action === 'get_roster') {
      result = { success:true, roster: getRoster() };
    } else if (action === 'submit_attendance') {
      var payload = {
        name: e.parameter.name || '',
        lat: e.parameter.lat || '',
        lon: e.parameter.lon || '',
        fingerprint: e.parameter.fingerprint || ''
      };
      result = handleSubmitAttendance(payload);
    } else if (action === 'set_active_section') {
      var secret = e.parameter && e.parameter.adminSecret ? e.parameter.adminSecret : '';
      if (secret !== ADMIN_SECRET) {
        result = { success:false, message:'unauthorized' };
      } else {
        var sec = e.parameter && e.parameter.section ? e.parameter.section : '';
        setActiveSection(sec);
        result = { success:true };
      }
    } else if (action === 'get_active_section') {
      result = { success:true, active: getActiveSection() };
    } else if (action === 'ping') {
      result = { success:true, message:'pong' };
    } else if (action === 'upload_roster') {
      var secret = e.parameter && e.parameter.adminSecret ? e.parameter.adminSecret : '';
      if (secret !== ADMIN_SECRET) {
        result = { success:false, message:'unauthorized' };
      } else {
        var rosterStr = e.parameter && e.parameter.roster ? e.parameter.roster : '[]';
        var rosterArr;
        try { rosterArr = JSON.parse(rosterStr); } catch(pe) { rosterArr = []; }
        // Support batched uploads: batchIndex 0 clears the sheet, subsequent batches append
        var batchIndex = e.parameter && e.parameter.batchIndex !== undefined ? parseInt(e.parameter.batchIndex, 10) : -1;
        var clearFirst = (batchIndex <= 0); // clear on first batch or single upload
        result = handleUploadRoster({ roster: rosterArr, clearFirst: clearFirst });
      }
    } else {
      result = { success:false, message:'unsupported GET action' };
    }

    if (callback) {
      var payload = callback + '(' + JSON.stringify(result) + ');';
      return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JAVASCRIPT);
    } else {
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    var errRes = { success:false, message: err.toString() };
    if (e && e.parameter && e.parameter.callback) {
      return ContentService.createTextOutput(e.parameter.callback + '(' + JSON.stringify(errRes) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errRes)).setMimeType(ContentService.MimeType.JSON);
  }
}

function jsonResponse(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function getSheet(name){ var ss = SpreadsheetApp.openById(SPREADSHEET_ID); var sh = ss.getSheetByName(name); if(!sh){ sh = ss.insertSheet(name); } return sh; }

function handleUploadRoster(payload){
  var roster = payload.roster || [];
  // If roster is a string (from GET param), parse it
  if (typeof roster === 'string') {
    try { roster = JSON.parse(roster); } catch(pe) { roster = []; }
  }
  var sh = getSheet('Roster');
  // clearFirst defaults to true for backwards compat (POST always clears)
  var clearFirst = payload.clearFirst !== undefined ? payload.clearFirst : true;
  if (clearFirst) {
    sh.clearContents();
    sh.appendRow(['Section','RawName','FirstName','Middle','LastName','Normalized','StudentId']);
  }
  // For appending, get current max StudentId
  var id = 1;
  if (!clearFirst) {
    var lastRow = sh.getLastRow();
    if (lastRow > 1) {
      var lastId = sh.getRange(lastRow, 7).getValue();
      id = (parseInt(lastId, 10) || 0) + 1;
    }
  }
  roster.forEach(function(r){
    var section = r.section || '';
    var raw = (r.name || '').toString();
    var parsed = parseName(raw);
    var norm = normalize(raw);
    sh.appendRow([section, raw, parsed.first, parsed.middle, parsed.last, norm, id++]);
  });

  // Re-build Attendance_Grid layout immediately using the full updated roster!
  try {
    var fullRoster = getRoster(); // fetches the just-written list
    buildAttendanceGrid(fullRoster);
  } catch(e) {}

  return {success:true, message:'roster uploaded', count: roster.length};
}

// Function to build/overwrite the multicolumn Attendance_Grid sheet
function buildAttendanceGrid(rosterList) {
  var gridSh = getSheet('Attendance_Grid');
  gridSh.clear();
  
  var sectionsData = {};
  rosterList.forEach(function(r){
    var sec = (r.section || '').toString();
    if (!sectionsData[sec]) sectionsData[sec] = [];
    sectionsData[sec].push(r.rawName);
  });
  
  var sections = Object.keys(sectionsData);
  if (sections.length === 0) return;
  
  var headerRow = [];
  var subHeaderRow = [];
  var maxRows = 0;
  
  sections.forEach(function(sec){
    headerRow.push(sec);
    headerRow.push(''); // blank space for Att column
    subHeaderRow.push('Name');
    subHeaderRow.push('Att');
    if (sectionsData[sec].length > maxRows) maxRows = sectionsData[sec].length;
  });
  
  gridSh.appendRow(headerRow);
  gridSh.appendRow(subHeaderRow);
  
  var gridData = [];
  for (var i = 0; i < maxRows; i++) {
    var row = [];
    sections.forEach(function(sec){
      var studentName = sectionsData[sec][i];
      if (studentName) {
        row.push(studentName);
        row.push(''); // Initial empty attendance
      } else {
        row.push('');
        row.push('');
      }
    });
    gridData.push(row);
  }
  
  if (gridData.length > 0) {
    gridSh.getRange(3, 1, gridData.length, headerRow.length).setValues(gridData);
  }
}

function parseName(raw){
  var s = (raw || '').toString().trim();
  if(!s) return {first:'', middle:'', last:'', raw:s};
  if(s.indexOf(',')>-1){ var parts = s.split(','); var last = parts[0].trim(); var rest = parts[1].trim().split(/\s+/); var first = rest[0] || ''; var middle = rest.length>1? rest.slice(1).join(' '):''; return {first:first, middle:middle, last:last, raw:s}; }
  var tokens = s.split(/\s+/);
  var first = tokens[0] || '';
  var last = tokens.length>1? tokens[tokens.length-1]: '';
  var middle = tokens.length>2? tokens.slice(1,tokens.length-1).join(' '):'';
  return {first:first, middle:middle, last:last, raw:s};
}

function normalize(s){
  if(!s) return '';
  var t = s.toString().toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g,''); } catch(e) {}
  // explicitly map enye to 'n' to be robust across JS environments
  t = t.replace(/\u00f1/g,'n').replace(/\u00d1/g,'n');
  // remove punctuation, keep alphanumerics and spaces
  t = t.replace(/[^a-z0-9\s]/g,' ');
  t = t.replace(/\s+/g,' ').trim();
  return t;
}

function tokenizeName(s){
  var n = normalize(s || '');
  if(!n) return [];
  var toks = n.split(' ');
  var out = [];
  for(var i=0;i<toks.length;i++){ if(toks[i]) out.push(toks[i]); }
  return out;
}

function nameMatches(rosterRaw, submittedRaw){
  var rn = normalize(rosterRaw || '');
  var sn = normalize(submittedRaw || '');
  if(!sn || !rn) return false;
  if(rn === sn) return true;
  var rTokens = tokenizeName(rosterRaw);
  var sTokens = tokenizeName(submittedRaw);
  if(rTokens.length === 0 || sTokens.length === 0) return false;

  // exact token-set match (order-insensitive)
  if(rTokens.length === sTokens.length){
    var rSorted = rTokens.slice().sort().join(' ');
    var sSorted = sTokens.slice().sort().join(' ');
    if(rSorted === sSorted) return true;
  }

  // quick last-name match + first-name prefix/initial check
  var rLast = rTokens[rTokens.length - 1];
  var sLast = sTokens[sTokens.length - 1];
  if(rLast && sLast && rLast === sLast){
    var rFirst = rTokens[0] || '';
    var sFirst = sTokens[0] || '';
    if(rFirst && sFirst){
      if(rFirst.indexOf(sFirst) === 0 || sFirst.indexOf(rFirst) === 0) return true;
      if(sFirst.length === 1 && rFirst.indexOf(sFirst) === 0) return true;
    }
    var rSet = {};
    for(var i=0;i<rTokens.length;i++) rSet[rTokens[i]] = true;
    var shared = 0;
    for(var j=0;j<sTokens.length;j++){ if(rSet[sTokens[j]]) shared++; }
    if(shared >= 2) return true;
  }

  // token-set similarity (Jaccard-like)
  var rSet2 = {};
  for(i=0;i<rTokens.length;i++) rSet2[rTokens[i]] = (rSet2[rTokens[i]] || 0) + 1;
  var sharedCount = 0;
  for(j=0;j<sTokens.length;j++){ if(rSet2[sTokens[j]]) sharedCount++; }
  var denom = Math.max(rTokens.length, sTokens.length);
  if(denom > 0){ var ratio = sharedCount / denom; if(ratio >= 0.6 && sharedCount >= 1) return true; }

  // accept short-name matches and initials (e.g., "J Garcia", "Juan G.")
  if(rTokens.length <= 2 && sTokens.length <= 2 && sharedCount >= 1){
    // if any submitted token is a single-letter initial, match against roster tokens
    for(var a=0;a<sTokens.length;a++){
      var st = sTokens[a];
      if(st.length === 1){
        for(var b=0;b<rTokens.length;b++){
          if(rTokens[b].indexOf(st) === 0) return true;
        }
      }
    }
    // for short names, one shared token is often sufficient (first/last swapped or initial used)
    if(sharedCount >= 1) return true;
  }

  // fallback: allow small edit distance on joined tokens
  var joinedR = rTokens.join(' ');
  var joinedS = sTokens.join(' ');
  if(levenshtein(joinedR, joinedS) <= 2) return true;
  return false;
}

function getRoster(){ var sh = getSheet('Roster'); var data = sh.getDataRange().getValues(); var out = []; for(var i=1;i<data.length;i++){ var row=data[i]; out.push({section:row[0], rawName:row[1], first:row[2], middle:row[3], last:row[4], normalized:row[5], studentId:row[6]}); } return out; }

function getActiveSection(){ var sh = getSheet('Config'); var v = sh.getRange('A1').getValue(); return v ? v.toString() : ''; }

function setActiveSection(section){ var sh = getSheet('Config'); sh.getRange('A1').setValue(section); }

function haversine(lat1,lon1,lat2,lon2){ var toRad = function(d){return d*Math.PI/180;}; var R=6371000; var dLat=toRad(lat2-lat1); var dLon=toRad(lon2-lon1); var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)*Math.sin(dLon/2); var c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R*c; }

function handleSubmitAttendance(payload){
  var name = (payload.name||'').toString();
  var lat = parseFloat(payload.lat);
  var lon = parseFloat(payload.lon);
  var fingerprint = (payload.fingerprint||'').toString();
  if(!name) return {success:false, message:'Name required'};
  var active = getActiveSection();
  if(!active) return {success:false, message:'No active section accepting attendance'};
  if(isNaN(lat) || isNaN(lon)) return {success:false, message:'Location required'};
  var dist = haversine(lat,lon,SCHOOL_LAT,SCHOOL_LON);
  if(dist > GEOFENCE_M) return {success:false, message:'Outside School'};
  // cooldown check
  var atSh = getSheet('Attendance');
  var aData = atSh.getDataRange().getValues();
  var now = new Date().getTime();
  for(var i=1;i<aData.length;i++){
    var r = aData[i];
    var rf = r[7] ? r[7].toString() : '';
    var ts = r[0] ? new Date(r[0]).getTime() : 0;
    if(rf && rf===fingerprint && (now - ts) < COOLDOWN_MS) return {success:false, message:'Device Blocked'};
  }
  // find student in roster for active section
  var roster = getRoster().filter(function(x){return (x.section||'').toString()===active;});
  var matched = null;
  for(var j=0;j<roster.length;j++){
    var r = roster[j];
    if(!r) continue;
    if(nameMatches(r.rawName, name)) { matched = r; break; }
  }
  // Second pass: try looser substring matching if strict match failed
  if(!matched){
    var subNorm = normalize(name);
    var subTokens = subNorm.split(' ').filter(function(t){return t.length>1;});
    for(var k=0;k<roster.length;k++){
      var rk = roster[k];
      if(!rk) continue;
      var rkNorm = rk.normalized || normalize(rk.rawName);
      // check if ALL submitted tokens (>1 char) appear in the roster name
      var allFound = true;
      for(var t=0;t<subTokens.length;t++){
        if(rkNorm.indexOf(subTokens[t]) < 0){ allFound = false; break; }
      }
      if(allFound && subTokens.length >= 1){ matched = rk; break; }
    }
  }
  if(!matched){
    var hint = 'Name "' + name + '" not found in ' + active + ' (' + roster.length + ' students). ';
    if(roster.length > 0) hint += 'Example: ' + roster[0].rawName;
    return {success:false, message:hint};
  }
  // record attendance
  var tsISO = (new Date()).toISOString();
  atSh.appendRow([tsISO, active, matched.studentId, matched.rawName, name, lat, lon, fingerprint, 1]);
  var db = getSheet('DeviceBlocks');
  db.appendRow([fingerprint, new Date(now + COOLDOWN_MS).toISOString()]);

  // Update Attendance_Grid
  try {
    var gridSh = getSheet('Attendance_Grid');
    var maxCols = gridSh.getLastColumn();
    var maxRows = gridSh.getLastRow();
    if (maxCols > 0 && maxRows >= 3) {
      // Find section column
      var headers = gridSh.getRange(1, 1, 1, maxCols).getValues()[0];
      var secColIndex = -1;
      for (var c = 0; c < headers.length; c++) {
        if ((headers[c] || '').toString() === active) {
          secColIndex = c + 1; // 1-indexed
          break;
        }
      }
      if (secColIndex > 0) {
        // Look for student in that column
        var colData = gridSh.getRange(3, secColIndex, maxRows - 2, 1).getValues();
        for (var i = 0; i < colData.length; i++) {
          if ((colData[i][0] || '').toString() === matched.rawName) {
            // Write '1' into the Att column (section column + 1)
            gridSh.getRange(3 + i, secColIndex + 1).setValue(1);
            break;
          }
        }
      }
    }
  } catch(e) {}

  return {success:true, message:'Attendance recorded', student: matched.rawName, section: active};
}

function getAttendance(){
  var sh = getSheet('Attendance');
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var maxRows = 500; // limit rows fetched to keep responses fast
  var startRow = Math.max(2, lastRow - maxRows + 1);
  var numRows = lastRow - startRow + 1;
  var out = [];
  if (numRows <= 0) return out;
  var range = sh.getRange(startRow, 1, numRows, 9);
  var data = range.getValues();
  for (var i = 0; i < data.length; i++){
    var r = data[i];
    out.push({ row: startRow + i, timestamp: r[0], section: r[1], studentId: r[2], rosterName: r[3], submittedName: r[4], lat: r[5], lon: r[6], fingerprint: r[7], confirmed: r[8] });
  }
  return out;
}

  /**
   * Return attendance rows newer than the provided `since` timestamp (ISO or ms).
   * To keep reads fast, only the last N rows are scanned.
   */
  function getAttendanceSince(since) {
    var sh = getSheet('Attendance');
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    var maxRows = 1000; // limit to most recent rows to avoid slow queries
    var startRow = Math.max(2, lastRow - maxRows + 1);
    var numRows = lastRow - startRow + 1;
    if (numRows <= 0) return [];
    var range = sh.getRange(startRow, 1, numRows, 9);
    var data = range.getValues();
    var out = [];

    var sinceMs = 0;
    if (since) {
      var parsed = new Date(since);
      if (!isNaN(parsed.getTime())) {
        sinceMs = parsed.getTime();
      } else {
        var n = parseInt(since, 10);
        if (!isNaN(n)) sinceMs = n;
      }
    }

    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      var tsVal = r[0];
      var ts = tsVal ? (new Date(tsVal)).getTime() : 0;
      if (ts > sinceMs) {
        out.push({ row: startRow + i, timestamp: r[0], section: r[1], studentId: r[2], rosterName: r[3], submittedName: r[4], lat: r[5], lon: r[6], fingerprint: r[7], confirmed: r[8] });
      }
    }
    return out;
  }

  /**
   * Return attendance rows newer than the given sheet row number `sinceRow`.
   * This reads only the recent rows and returns rows with their sheet row index.
   */
  function getAttendanceSinceRow(sinceRow) {
    var sh = getSheet('Attendance');
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    var startRow = Math.max(2, sinceRow + 1);
    if (startRow > lastRow) return [];
    var maxRows = 2000;
    if (lastRow - startRow + 1 > maxRows) {
      startRow = Math.max(2, lastRow - maxRows + 1);
    }
    var numRows = lastRow - startRow + 1;
    if (numRows <= 0) return [];
    var range = sh.getRange(startRow, 1, numRows, 9);
    var data = range.getValues();
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      out.push({ row: startRow + i, timestamp: r[0], section: r[1], studentId: r[2], rosterName: r[3], submittedName: r[4], lat: r[5], lon: r[6], fingerprint: r[7], confirmed: r[8] });
    }
    return out;
  }

function levenshtein(a,b){ if(!a) return b? b.length:0; if(!b) return a.length; var m = [], i, j; for(i=0;i<=b.length;i++){ m[i]=[i]; } for(j=0;j<=a.length;j++){ m[0][j]=j; } for(i=1;i<=b.length;i++){ for(j=1;j<=a.length;j++){ if(b.charAt(i-1) === a.charAt(j-1)){ m[i][j] = m[i-1][j-1]; } else { m[i][j] = Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1); } } } return m[b.length][a.length]; }
