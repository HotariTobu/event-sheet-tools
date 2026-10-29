/** API作成直後は、作成前に取得したSpreadsheetでは新しいシートが見えない場合がある。 */
function createdOutputSheet_(spreadsheetId,sheetId){
  for(var attempt=0;attempt<6;attempt++){
    if(attempt)Utilities.sleep(100*Math.pow(2,attempt-1));
    var sheet=SpreadsheetApp.openById(spreadsheetId).getSheetById(sheetId);
    if(sheet)return sheet;
  }
  throw new Error('作成したシートを取得できませんでした。');
}
