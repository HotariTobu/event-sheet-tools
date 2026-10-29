/** 回答と座席配置を読み取る。参加者・作品数・卓・席・壁を固定しない。 */
function seatText(value) { return value == null ? '' : String(value).trim(); }

function seatRead(data) {
  if (!data.length) throw new Error('回答シートが空です。');
  var headers = data[0].map(seatText);
  function column(name) {
    var found = [];
    headers.forEach(function(h, i) { if (h === name) found.push(i); });
    if (found.length !== 1) throw new Error('見出し「' + name + '」が見つからないか、重複しています。');
    return found[0];
  }
  var nickname = column('ニックネーム'), phrase = column('同伴者の合言葉 (任意)');
  var works = headers.filter(function(h) { return /の推し$/.test(h); }).map(function(h) {
    var title = h.slice(0, -3);
    return {title: title, level: column(title), favorites: column(h)};
  });
  if (!works.length) throw new Error('作品名と「作品名の推し」の列がありません。');
  var people = [];
  data.slice(1).forEach(function(row, r) {
    if (row.every(function(v) { return !seatText(v); })) return;
    var name = seatText(row[nickname]);
    if (!name) throw new Error('回答シートの' + (r + 2) + '行目にニックネームがありません。');
    var levels = works.map(function(w) {
      var text = seatText(row[w.level]), level = Number(text);
      if (!/^[1-5]$/.test(text)) throw new Error('回答シート' + (r + 2) + '行目「' + w.title + '」は1〜5を入力してください。未回答を1とは扱いません。');
      return level;
    });
    people.push({id: people.length, nickname: name, passphrase: seatText(row[phrase]),
      levels: levels, favorites: works.map(function(w) {
        return Array.from(new Set(seatText(row[w.favorites]).split(/[,，、\r\n]+/).map(seatText).filter(Boolean)));
      })});
  });
  if (!people.length) throw new Error('配置する参加者がいません。');
  return {people: people, works: works.map(function(w) { return w.title; })};
}

/** SpreadsheetAppでは取得できない罫線をSheetsサービスで取得する。 */
function seatLayout(ss) {
  var sheet = ss.getSheetByName('座席配置');
  if (!sheet) throw new Error('「座席配置」シートがありません。');
  var range = sheet.getDataRange(), values = range.getDisplayValues();
  var seats = [], labels = new Set();
  values.forEach(function(row, r) { row.forEach(function(value, c) {
    // 最初のハイフンを区切りとして、卓ID・席IDを文字列のまま読む。
    // 日本語の長音「ー」は識別子の一部なので区切りにしない。
    var match = seatText(value).match(/^(.+?)\s*[-－]\s*(.+)$/);
    if (!match) return;
    var table = seatText(match[1]), seat = seatText(match[2]);
    if (!table || !seat) return;
    var label = table + '-' + seat;
    if (labels.has(label)) throw new Error('座席番号「' + label + '」が重複しています。');
    labels.add(label);
    seats.push({label: label, table: table, row: r + 1, col: c + 1});
  }); });
  if (!seats.length) throw new Error('「座席配置」シートに「卓ID-席ID」の席がありません。');
  var top = Math.min.apply(null, seats.map(function(s) { return s.row; }));
  var bottom = Math.max.apply(null, seats.map(function(s) { return s.row; }));
  var left = Math.min.apply(null, seats.map(function(s) { return s.col; }));
  var right = Math.max.apply(null, seats.map(function(s) { return s.col; }));
  // 席間を遮る可能性のある範囲をすべて読む。格子線は罫線には含まれない。
  var quoted = "'" + sheet.getName().replace(/'/g, "''") + "'!";
  var a1 = sheet.getRange(1, 1, bottom, right).getA1Notation();
  var grid;
  try {
    grid = Sheets.Spreadsheets.get(ss.getId(), {ranges: [quoted + a1],
      fields: 'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(effectiveFormat(borders)))))'});
  } catch (e) {
    throw new Error('壁の罫線を取得できません。Apps Scriptのサービス「Google Sheets API」を有効にしてください。\n' + e.message);
  }
  var walls = [], seen = new Set();
  function add(x1, y1, x2, y2) {
    if (x1 === x2 && (x1 <= 2 * left || x1 >= 2 * right)) return;
    if (y1 === y2 && (y1 <= 2 * top || y1 >= 2 * bottom)) return;
    var key = [x1, y1, x2, y2].join(',');
    if (!seen.has(key)) { walls.push([x1, y1, x2, y2]); seen.add(key); }
  }
  (grid.sheets || []).filter(function(s) { return s.properties.sheetId === sheet.getSheetId(); }).forEach(function(s) {
    (s.data || []).forEach(function(block) { (block.rowData || []).forEach(function(row, rr) {
      (row.values || []).forEach(function(cell, cc) {
        var r = (block.startRow || 0) + rr + 1, c = (block.startColumn || 0) + cc + 1;
        var b = (cell.effectiveFormat || {}).borders || {};
        function edge(side) { return b[side] && b[side].style && !/^(NONE|STYLE_UNSPECIFIED)$/.test(b[side].style); }
        if (edge('top')) add(2*c-1, 2*r-1, 2*c+1, 2*r-1);
        if (edge('bottom')) add(2*c-1, 2*r+1, 2*c+1, 2*r+1);
        if (edge('left')) add(2*c-1, 2*r-1, 2*c-1, 2*r+1);
        if (edge('right')) add(2*c+1, 2*r-1, 2*c+1, 2*r+1);
      });
    }); });
  });
  return {sheetId: sheet.getSheetId(), seats: seats, walls: walls};
}

function seatJob(horizontal, vertical) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), response = ss.getSheetByName('回答');
  if (!response) throw new Error('回答シート「回答」がありません。');
  var input = seatRead(response.getDataRange().getDisplayValues());
  var job = {version: 1, people: input.people, works: input.works, layout: seatLayout(ss),
    horizontal: seatText(horizontal), vertical: seatText(vertical)};
  job.fingerprint = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(job), Utilities.Charset.UTF_8)
    .map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  return job;
}


