/** JSONの入力を現在のシートの入力と照合する。探索状態はブラウザの同じエンジンでも検証する。 */
function validateSeatingFile(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !snapshot.job || snapshot.job.version !== 1 || !snapshot.state)
    throw new Error('探索状態JSONの形式またはバージョンが不正です。');
  var job = seatJob(snapshot.job.horizontal, snapshot.job.vertical);
  if (seatCanonicalJson_(snapshot.job) !== seatCanonicalJson_(job))
    throw new Error('回答または座席配置が変わっています。探索状態の入力と一致しません。');
  return {version: 1, job: job, state: snapshot.state};
}
function seatCanonicalJson_(value) {
  if (Array.isArray(value)) return '[' + value.map(seatCanonicalJson_).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(function(k) {
    return JSON.stringify(k) + ':' + seatCanonicalJson_(value[k]);
  }).join(',') + '}';
  return JSON.stringify(value);
}
function suggestedSeatingName() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var base = '座席割当 ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMdd HHmm');
  return base;
}

/** 末尾の新しいシートへ割当と探索状態を保存する。 */
function publishSeatingResult(request) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) throw new Error('別の結果出力が実行中です。少し待って再実行してください。');
  var output = null, created = false;
  try {
    var job = seatJob(request.horizontal, request.vertical);
    if (job.fingerprint !== request.fingerprint) throw new Error('回答または座席配置が変わっています。現在の入力で計算し直してください。');
    var snapshot = request.snapshot;
    if (!snapshot || snapshot.version !== 1 || !snapshot.job || !snapshot.state || snapshot.job.fingerprint !== job.fingerprint || seatCanonicalJson_(snapshot.job) !== seatCanonicalJson_(job))
      throw new Error('再開用の探索状態がありません。');
    var pos = request.assignment, seen = new Set(), phrases = new Map();
    if (JSON.stringify(pos) !== JSON.stringify(snapshot.state.best)) throw new Error('探索状態と最良割り当てが一致しません。');
    if (pos === null && snapshot.state.phase !== 'feasible' && snapshot.state.phase !== 'infeasible') throw new Error('全参加者の割り当てがありません。');
    if (pos !== null && (!Array.isArray(pos) || pos.length !== job.people.length)) throw new Error('全参加者の割り当てがありません。');
    (pos || []).forEach(function(p, i) {
      if (!Number.isInteger(p) || p < 0 || p >= job.layout.seats.length || seen.has(p)) throw new Error('座席の割り当てが不正または重複しています。');
      seen.add(p);
      var phrase = job.people[i].passphrase, table = job.layout.seats[p].table;
      if (phrase && phrases.has(phrase) && phrases.get(phrase) !== table) throw new Error('同じ合言葉の参加者が別卓になっています。');
      if (phrase) phrases.set(phrase, table);
    });
    var ss = SpreadsheetApp.getActiveSpreadsheet(), source = ss.getSheetByName('座席配置');
    var legend = request.legend;
    if (!legend || typeof legend.data !== 'string' || !Number.isInteger(legend.width) || legend.width <= 0 ||
        !Number.isInteger(legend.height) || legend.height <= 0) throw new Error('凡例の画像がありません。');
    if (request.targetSheetId != null) throw new Error('上書き保存には対応していません。');
    var name = request.name == null ? suggestedSeatingName() : String(request.name).trim();
    if (!name || name.length > 100 || /[\\/?*\[\]:]/.test(name)) throw new Error('シート名が不正です。');
    if (ss.getSheetByName(name)) throw new Error('同じ名前のシートが既にあります。');
    var copied = Sheets.Spreadsheets.batchUpdate({requests: [{duplicateSheet: {sourceSheetId: source.getSheetId(), insertSheetIndex: ss.getNumSheets(), newSheetName: name}}]}, ss.getId());
    output = createdOutputSheet_(ss.getId(), copied.replies[0].duplicateSheet.properties.sheetId); created = true;
    // 元の1行目の座席を残したまま、状態専用の行を先頭に確保する。
    output.insertRowsBefore(1, 1);
    seatRenderAssignment_(output, job, pos, legend);
    seatWriteState(output, snapshot);
    SpreadsheetApp.flush(); ss.setActiveSheet(output);
    return {sheetId: output.getSheetId(), name: name, url: ss.getUrl() + '#gid=' + output.getSheetId()};
  } catch (error) {
    // 失敗時に削除するのは、この処理で新規作成したシートだけ。
    if (created && output) {
      try { SpreadsheetApp.getActiveSpreadsheet().deleteSheet(output); }
      catch (cleanupError) { console.warn('未完成の結果シート: ' + output.getName()); }
    }
    throw error;
  } finally { lock.releaseLock(); }
}

function loadSeatingJob(horizontal, vertical) { return seatJob(horizontal, vertical); }
function listSeatingCheckpoints() { return seatListCheckpoints_(); }
function loadSeatingCheckpoint(sheetId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheets().filter(function(s) { return s.getSheetId() === Number(sheetId); })[0];
  if (!sheet) throw new Error('選択したシートがありません。');
  return validateSeatingFile(seatReadCheckpoint_(sheet));
}
