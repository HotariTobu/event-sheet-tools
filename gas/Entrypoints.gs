function onOpen() {
  SpreadsheetApp.getUi().createMenu('打ち上げツール')
    .addItem('座席シート作成', 'openSeatingDialog')
    .addItem('名刺シート作成', 'openNameCardDialog').addToUi();
}
