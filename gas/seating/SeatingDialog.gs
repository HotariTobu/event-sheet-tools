function openSeatingDialog() {
  var page = HtmlService.createHtmlOutputFromFile('SeatingDialog').setWidth(650).setHeight(590);
  SpreadsheetApp.getUi().showModalDialog(page, '座席シート作成');
}
