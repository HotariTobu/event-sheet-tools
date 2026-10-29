function onOpen() {
  SpreadsheetApp.getUi().createMenu('打ち上げツール')
    .addItem('座席シート作成', 'assignSeats')
    .addItem('名刺シート作成', 'createNameCards').addToUi();
}

function assignSeats() {
  var page = HtmlService.createTemplateFromFile('SeatingDialog').evaluate()
    .setWidth(650).setHeight(590);
  SpreadsheetApp.getUi().showModalDialog(page, '座席シート作成');
}

function seatInclude(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }
