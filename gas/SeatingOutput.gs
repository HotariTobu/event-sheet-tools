/** 割当と凡例を描画する。保存先の選択・シート作成・探索状態の保存は行わない。 */
function seatRenderAssignment_(output, job, pos, legend) {
    var palette = JSON.parse(HtmlService.createHtmlOutputFromFile('SeatingColors').getContent());
    var occupant = new Map(); (pos || []).forEach(function(p, i) { occupant.set(p, i); });
    var rows = new Set(), columns = new Set();
    job.layout.seats.forEach(function(seat, p) {
      var cell = output.getRange(seat.row + 1, seat.col), text = seat.label, note = [], nameStart = 0, nameEnd = 0, marks = [];
      if (occupant.has(p)) {
        var person = job.people[occupant.get(p)];
        text += '\n';
        job.works.forEach(function(work, k) {
          var level = person.levels[k], title = work.replace(/^『(.*)』$/, '$1');
          var colors = Object.prototype.hasOwnProperty.call(palette, title) ? palette[title] : palette._default;
          var start = text.length;
          text += level === 1 ? '　' : '■';
          if (level > 1) marks.push({start: start, end: text.length, color: colors[level - 1]});
        });
        text += '\n'; nameStart = text.length; text += person.nickname; nameEnd = text.length;
        if (person.passphrase) note.push('合言葉：' + person.passphrase);
        job.works.forEach(function(work, k) {
          if (person.favorites[k].length) note.push(work + '：\n' + person.favorites[k].join('、'));
        });
      } else text += '\n' + (pos === null ? '（初期配置の探索中）' : '（空席）');
      // 名前は太字、作品レベルは文字ごとに色を設定する。レベル1は空白。
      cell.setFontSize(10);
      var rich = SpreadsheetApp.newRichTextValue().setText(text)
        .setTextStyle(SpreadsheetApp.newTextStyle().setBold(false).build());
      if (seat.label.length) rich.setTextStyle(0, seat.label.length, SpreadsheetApp.newTextStyle().setFontSize(8).build());
      if (nameEnd > nameStart) rich.setTextStyle(nameStart, nameEnd, SpreadsheetApp.newTextStyle().setBold(true).build());
      marks.forEach(function(mark) { rich.setTextStyle(mark.start, mark.end, SpreadsheetApp.newTextStyle().setFontSize(9).setForegroundColor(mark.color).build()); });
      cell.setRichTextValue(rich.build()).setNote(note.join('\n\n')).setWrap(true).setVerticalAlignment('top');
      rows.add(seat.row + 1); columns.add(seat.col);
    });
    columns.forEach(function(c) { output.setColumnWidth(c, 80); });
    rows.forEach(function(r) { output.setRowHeight(r, 52); });
    var legendRow = output.getLastRow() + 2;
    if (legendRow > output.getMaxRows()) output.insertRowsAfter(output.getMaxRows(), legendRow - output.getMaxRows());
    var image = output.insertImage(Utilities.newBlob(Utilities.base64Decode(legend.data), 'image/png', '作品レベルの凡例.png'), 1, legendRow);
    image.setWidth(legend.width).setHeight(legend.height)
      .setAltTextTitle('作品レベルの並び順（左から）').setAltTextDescription(job.works.join('\n'));
}
