function openNameCardDialog(){
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('NameCardPage').setWidth(520).setHeight(310),'名刺シート作成');
}
