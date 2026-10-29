/** 再開用JSONは、出力側で確保した1行目に横方向へ分割して保存する。 */
var SEAT_STATE_KEY = 'SEATING_CHECKPOINT_V1';

function seatStateHash(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function seatWriteState(sheet, snapshot) {
  var oldLocation = seatStateLocation(sheet);
  var json = JSON.stringify(snapshot), chunks = [];
  for (var offset = 0; offset < json.length;) {
    var end = Math.min(offset + 45000, json.length), last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;
    chunks.push(json.slice(offset, end)); offset = end;
  }
  var meta = {version: 1, parts: chunks.length, hash: seatStateHash(json), phase: snapshot.state.phase,
    savedAt: new Date().toISOString()};
  var texts = [JSON.stringify(meta)].concat(chunks);
  if (sheet.getMaxColumns() < texts.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), texts.length - sheet.getMaxColumns());
  if (oldLocation && oldLocation.format === 'row' && oldLocation.columns > texts.length)
    sheet.getRange(1, texts.length + 1, 1, oldLocation.columns - texts.length).clearContent();
  var range = sheet.getRange(1, 1, 1, texts.length);
  // 分割位置が回答中の「=」等と重なっても、数式として解釈させない。
  range.setRichTextValues([texts.map(function(text) {
    return SpreadsheetApp.newRichTextValue().setText(text).build();
  })]).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  if (oldLocation) {
    sheet.getDeveloperMetadata().filter(function(item) { return item.getKey() === SEAT_STATE_KEY; }).forEach(function(item) { item.remove(); });
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).filter(function(p) { return p.getDescription() === SEAT_STATE_KEY; }).forEach(function(p) { p.remove(); });
  }
  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).protect().setDescription(SEAT_STATE_KEY).setWarningOnly(true);
  sheet.addDeveloperMetadata(SEAT_STATE_KEY, JSON.stringify({format: 'row', row: 1, column: 1, rows: 1, columns: texts.length}));
  sheet.hideRows(1);
}

function seatStateLocation(sheet) {
  var items = sheet.getDeveloperMetadata().filter(function(item) { return item.getKey() === SEAT_STATE_KEY; });
  if (items.length !== 1) return null;
  var info = JSON.parse(items[0].getValue());
  if (info.format === 'row') {
    if (info.row !== 1 || info.column !== 1 || info.rows !== 1 || !Number.isInteger(info.columns) || info.columns < 2 ||
        info.columns > sheet.getMaxColumns()) throw new Error('保存した探索状態の位置情報が不正です。');
    return info;
  }
  // 以前の縦方向の保存状態も、既存シートを変更せずに読み取る。
  if (!Number.isInteger(info.column) || info.column < 1 || !Number.isInteger(info.rows) || info.rows < 3 ||
      info.column > sheet.getMaxColumns() || info.rows > sheet.getMaxRows()) throw new Error('保存した探索状態の位置情報が不正です。');
  return info;
}

function seatListCheckpoints_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(function(sheet) {
    return sheet.getDeveloperMetadata().some(function(item) { return item.getKey() === SEAT_STATE_KEY; });
  }).map(function(sheet, index) {
    var location = seatStateLocation(sheet);
    var meta = JSON.parse(sheet.getRange(location.format === 'row' ? 1 : 2, location.column, 1, 1).getDisplayValues()[0][0]);
    return {sheetId: sheet.getSheetId(), name: sheet.getName(), savedAt: Date.parse(meta.savedAt) || 0, order: index};
  }).sort(function(a, b) { return b.savedAt - a.savedAt || b.order - a.order; });
}

function seatReadCheckpoint_(sheet) {
  var location = seatStateLocation(sheet);
  if (!location) throw new Error('選択したシートに探索状態がありません。');
  var horizontal = location.format === 'row';
  var values = horizontal ? sheet.getRange(1, 1, 1, location.columns).getDisplayValues()[0] :
    sheet.getRange(1, location.column, location.rows, 1).getDisplayValues().map(function(row) { return row[0]; });
  var start = horizontal ? 1 : 2, meta = JSON.parse(values[start - 1]), json = values.slice(start).join('');
  if (meta.version !== 1 || meta.parts !== values.length - start || seatStateHash(json) !== meta.hash) throw new Error('保存した探索状態が変更または破損しています。');
  var snapshot = JSON.parse(json);
  if (snapshot.version !== 1 || !snapshot.job || !snapshot.state) throw new Error('保存した探索状態の形式が不正です。');
  return snapshot;
}
