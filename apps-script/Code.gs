/**
 * Input Mitra SKGB 3305.
 * Verifikasi sama dengan functions/lib/hmac.js:
 * canonical = timestamp + "." + nonce + "." + stableStringify(payload)
 * Deploy: Execute as Me, Who has access: Anyone.
 * Script property: APPS_SCRIPT_SECRET, SPREADSHEET_ID, FOLDER_ID
 */
var SPREADSHEET_NAME = 'Input Mitra SKGB 3305';
var FOLDER_NAME = 'SKGB 2026';
var MAX_SKEW_SEC = 300;
var lockHeld_ = false;

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SECRET') || '';
    var check = verify_(body, secret);
    if (!check.ok) return json_({ ok: false, error: check.error });
    var result = dispatch_(body.op, body.payload || {});
    return json_({ ok: true, result: result });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function setup() {
  var ss = book_();
  var root = folderFor_();
  return { spreadsheetId: ss.getId(), folderId: root.getId() };
}

function stableStringify_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Object.prototype.toString.call(value) === '[object Array]') {
    return '[' + value.map(stableStringify_).join(',') + ']';
  }
  var keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify_(value[k]); }).join(',') + '}';
}

function hmacHex_(secret, message) {
  var raw = Utilities.computeHmacSha256Signature(message, secret);
  return raw.map(function (b) {
    var v = (b + 256) % 256;
    var hex = v.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function verify_(body, secret) {
  if (!body || !body.timestamp || !body.nonce || !body.signature) return { ok: false, error: 'tanda tangan tidak lengkap' };
  var now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(body.timestamp)) > MAX_SKEW_SEC) return { ok: false, error: 'tanda tangan kedaluwarsa' };
  var cache = CacheService.getScriptCache();
  if (cache.get('nonce:' + body.nonce)) return { ok: false, error: 'nonce sudah dipakai' };
  var expect = hmacHex_(secret, String(body.timestamp) + '.' + String(body.nonce) + '.' + stableStringify_(body.payload));
  if (expect !== String(body.signature)) return { ok: false, error: 'tanda tangan salah' };
  cache.put('nonce:' + body.nonce, '1', MAX_SKEW_SEC);
  return { ok: true };
}

function dispatch_(op, payload) {
  if (op === 'listIsian') return listIsian_();
  if (op === 'appendIsian') return appendIsian_(payload);
  if (op === 'listAkun') return listAkun_();
  if (op === 'upsertAkun') return upsertAkun_(payload);
  if (op === 'listFoto') return listFoto_(payload);
  if (op === 'listFotoAll') return listFotoAll_(payload);
  if (op === 'uploadFoto') return uploadFoto_(payload);
  if (op === 'getFoto') return getFoto_(payload);
  throw new Error('operasi tidak dikenal');
}

function withLock_(fn) {
  if (lockHeld_) return fn();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  lockHeld_ = true;
  try {
    return fn();
  } finally {
    lockHeld_ = false;
    lock.releaseLock();
  }
}

function book_() {
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SPREADSHEET_ID');
    var ss = null;
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      var query = 'title = "' + SPREADSHEET_NAME + '" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false';
      var found = DriveApp.searchFiles(query);
      if (found.hasNext()) ss = SpreadsheetApp.open(found.next());
      else ss = SpreadsheetApp.create(SPREADSHEET_NAME);
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
    ensureSheet_(ss, 'isian', ['key', 'versi', 'oleh', 'aksi', 'waktu', 'status', 'alasan', 'isian']);
    ensureSheet_(ss, 'akun', ['id', 'nama', 'peran', 'pml_id', 'aktif']);
    ensureSheet_(ss, 'foto', ['jenis', 'id', 'slot', 'waktu', 'mime', 'oleh', 'fileId']);
    return ss;
  });
}

function ensureSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(header);
  return sh;
}

function listIsian_() {
  var sh = book_().getSheetByName('isian');
  return objects_(sh);
}

function appendIsian_(row) {
  return withLock_(function () {
    var sh = book_().getSheetByName('isian');
    sh.appendRow([row.key, row.versi, row.oleh, row.aksi, row.waktu, row.status, row.alasan || '', JSON.stringify(row.isian || {})]);
    return row;
  });
}

function listAkun_() {
  return objects_(book_().getSheetByName('akun'));
}

function upsertAkun_(row) {
  return withLock_(function () {
    var sh = book_().getSheetByName('akun');
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(row.id)) {
        sh.getRange(i + 1, 1, 1, 5).setValues([[row.id, row.nama, row.peran || row.role, row.pml_id || '', row.aktif !== false]]);
        return row;
      }
    }
    sh.appendRow([row.id, row.nama, row.peran || row.role, row.pml_id || '', row.aktif !== false]);
    return row;
  });
}

function listFoto_(payload) {
  return objects_(book_().getSheetByName('foto')).filter(function (row) {
    return row.jenis === payload.jenis && String(row.id) === String(payload.id);
  });
}

function waktuRank_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value.getTime();
  var t = Date.parse(String(value || ''));
  return isNaN(t) ? 0 : t;
}

function listFotoAll_() {
  var rows = objects_(book_().getSheetByName('foto'));
  var best = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row.jenis || row.id === '' || row.id == null || !row.slot) continue;
    var key = String(row.jenis) + '\n' + String(row.id) + '\n' + String(row.slot);
    var prev = best[key];
    if (!prev || waktuRank_(row.waktu) >= waktuRank_(prev.waktu)) {
      best[key] = {
        jenis: String(row.jenis),
        id: String(row.id),
        slot: String(row.slot),
        waktu: String(row.waktu || ''),
        mime: row.mime || '',
        oleh: row.oleh || ''
      };
    }
  }
  var grouped = {};
  for (var name in best) {
    var item = best[name];
    var sample = item.jenis + '\n' + item.id;
    if (!grouped[sample]) grouped[sample] = { jenis: item.jenis, id: item.id, slots: [] };
    grouped[sample].slots.push({ slot: item.slot, waktu: item.waktu, mime: item.mime, oleh: item.oleh });
  }
  var out = [];
  for (var sampleKey in grouped) out.push(grouped[sampleKey]);
  return out;
}

function uploadFoto_(payload) {
  return withLock_(function () {
    var ss = book_();
    var folder = folderFor_(payload.jenis, payload.id);
    var bytes = Utilities.base64Decode(payload.base64);
    var ext = payload.mime === 'image/png' ? 'png' : payload.mime === 'image/webp' ? 'webp' : 'jpg';
    var blob = Utilities.newBlob(bytes, payload.mime, payload.slot + '__' + payload.waktu + '.' + ext);
    var file = folder.createFile(blob);
    ss.getSheetByName('foto').appendRow([payload.jenis, payload.id, payload.slot, payload.waktu, payload.mime, payload.oleh || '', file.getId()]);
    return { waktu: payload.waktu, fileId: file.getId() };
  });
}

function getFoto_(payload) {
  var rows = listFoto_(payload).filter(function (row) { return row.slot === payload.slot; });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return String(a.waktu) < String(b.waktu) ? -1 : 1; });
  var last = rows[rows.length - 1];
  var file = DriveApp.getFileById(last.fileId);
  return { mime: last.mime, waktu: last.waktu, base64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function rootFolder_() {
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('FOLDER_ID');
    if (id) return DriveApp.getFolderById(id);
    var query = 'title = "' + FOLDER_NAME + '" and mimeType = "application/vnd.google-apps.folder" and trashed = false';
    var found = DriveApp.searchFolders(query);
    var folder = found.hasNext() ? found.next() : DriveApp.createFolder(FOLDER_NAME);
    props.setProperty('FOLDER_ID', folder.getId());
    return folder;
  });
}

function folderFor_(jenis, id) {
  var base = rootFolder_();
  if (!jenis) return base;
  var jenisFolder = childFolder_(base, jenis);
  if (id == null || id === '') return jenisFolder;
  return childFolder_(jenisFolder, String(id));
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var folder = it.next();
    if (!folder.isTrashed()) return folder;
  }
  return parent.createFolder(name);
}

function objects_(sh) {
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) obj[header[c]] = values[r][c];
    if (obj.isian && typeof obj.isian === 'string') {
      try { obj.isian = JSON.parse(obj.isian); } catch (e) { obj.isian = {}; }
    }
    out.push(obj);
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
