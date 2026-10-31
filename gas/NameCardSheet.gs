/** ブラウザ側の画像生成に使う回答を読み出す。 */
function loadNameCardData(){
  var data=loadNameCardPeople();
  if(data.errors.length)throw new Error(data.errors.join('\n'));
  return {people:data.people,hash:nameCardPeopleHash_(data.people)};
}
/** 全名刺のPNG生成が済んでから呼び出す。 */
function beginNameCardJob(request){
  if(!request||request.version!==3)throw new Error('名刺作成ダイアログを開き直してください。');
  var print=nameCardAutoPrintOptions()[request.paper];
  if(!print)throw new Error('用紙サイズを選択してください。');
  var data=loadNameCardData();
  if(request.hash!==data.hash)throw new Error('画像の生成中に回答が変更されました。作成をやり直してください。');
  var ss=SpreadsheetApp.getActiveSpreadsheet(),props=PropertiesService.getUserProperties(),id=Utilities.getUuid();
  var count=Math.min(9,data.people.length),batches=[];
  for(var i=0;i<count;i++)batches.push({index:i,start:Math.floor(i*data.people.length/count),end:Math.floor((i+1)*data.people.length/count)});
  var job={version:3,id:id,spreadsheetId:ss.getId(),sheetId:null,name:null,total:data.people.length,rows:Math.ceil(data.people.length/print.columns),print:print,batches:batches,state:'creating'};
  var values={};values[nameCardJobKey_(id)]=JSON.stringify(job);
  batches.forEach(function(batch){values[nameCardBatchKey_(id,batch.index)]=JSON.stringify({state:'pending',done:0});});
  props.setProperties(values);
  try{
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{
      var base='名刺 '+Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),'MMdd HHmm'),name=base,suffix=2;
      while(ss.getSheetByName(name))name=base+' ('+suffix+++')';
      var added=Sheets.Spreadsheets.batchUpdate({requests:[{addSheet:{properties:{title:name}}}]},ss.getId());
      job.sheetId=added.replies[0].addSheet.properties.sheetId;job.name=name;
      props.setProperty(nameCardJobKey_(id),JSON.stringify(job));
    }finally{lock.releaseLock();}
    var output=createdOutputSheet_(ss.getId(),job.sheetId),columns=print.columns;
    if(output.getMaxRows()<job.rows+1)output.insertRowsAfter(output.getMaxRows(),job.rows+1-output.getMaxRows());
    if(output.getMaxColumns()<columns)output.insertColumnsAfter(output.getMaxColumns(),columns-output.getMaxColumns());
    output.setColumnWidths(1,columns,359);output.setRowHeight(1,28);output.setRowHeights(2,job.rows,302);output.setHiddenGridlines(true);
    output.getRange(2,1,job.rows,columns).setBorder(true,true,true,true,true,true,'#000000',SpreadsheetApp.BorderStyle.SOLID);
    SpreadsheetApp.flush();job.state='active';props.setProperty(nameCardJobKey_(id),JSON.stringify(job));
    return {jobId:id,total:job.total,batches:batches};
  }catch(e){
    if(job.sheetId!==null){var sheet=ss.getSheets().find(function(s){return s.getSheetId()===job.sheetId;});if(sheet)ss.deleteSheet(sheet);}
    nameCardClearJob_(id);throw e;
  }
}
/** ブラウザで生成済みのPNGを受け取り、担当セルへ挿入する。 */
function runNameCardBatch(request){
  var job=nameCardReadJob_(request.jobId),index=request.batchIndex,batch=job.batches[index];
  if(job.state!=='active')throw new Error('名刺の配置を開始できません。');
  if(!Number.isInteger(index)||!batch)throw new Error('担当範囲が不正です。');
  if(!Array.isArray(request.cards)||request.cards.length!==batch.end-batch.start)throw new Error('名刺画像の数が一致しません。');
  var blobs=request.cards.map(function(card,offset){
    if(card.index!==batch.start+offset)throw new Error('名刺画像の順序が一致しません。');
    var bytes=card.bytes;
    if(!Array.isArray(bytes)||bytes.length<33||bytes.length>2000000||bytes.some(function(v){return !Number.isInteger(v)||v<0||v>255;}))throw new Error('名刺PNGのデータが不正です。');
    if([137,80,78,71,13,10,26,10].some(function(v,i){return bytes[i]!==v;}))throw new Error('名刺画像がPNGではありません。');
    function u32(i){return bytes[i]*16777216+bytes[i+1]*65536+bytes[i+2]*256+bytes[i+3];}
    var width=u32(16),height=u32(20);
    if(!width||!height||width*height>1000000)throw new Error('名刺PNGの画素数が上限を超えています。');
    return Utilities.newBlob(bytes.map(function(v){return v>127?v-256:v;}),'image/png','名刺'+(card.index+1)+'.png');
  });
  var props=PropertiesService.getUserProperties(),key=nameCardBatchKey_(job.id,index),lock=LockService.getUserLock();lock.waitLock(30000);
  try{
    var state=JSON.parse(props.getProperty(key)||'null');
    if(state&&state.state==='done')return {done:state.done};
    if(!state||state.state!=='pending')throw new Error('この担当範囲は実行済み、または実行中です。');
    props.setProperty(key,JSON.stringify({state:'running',done:0}));
  }finally{lock.releaseLock();}
  var done=0;
  try{
    var output=nameCardJobSheet_(job);
    request.cards.forEach(function(card,offset){
      output.insertImage(blobs[offset],card.index%job.print.columns+1,Math.floor(card.index/job.print.columns)+2).setWidth(359).setHeight(302)
        .setAltTextTitle(card.nickname).setAltTextDescription('回答 '+card.row+'行目');
      done++;props.setProperty(key,JSON.stringify({state:'running',done:done}));
    });
    SpreadsheetApp.flush();props.setProperty(key,JSON.stringify({state:'done',done:done}));return {done:done};
  }catch(e){props.setProperty(key,JSON.stringify({state:'failed',done:done,error:e.message||String(e)}));throw e;}
}
function finishNameCardJob(jobId){
  var props=PropertiesService.getUserProperties(),lock=LockService.getUserLock(),job;
  lock.waitLock(30000);
  try{
    job=nameCardReadJob_(jobId);
    if(job.state!=='active'||!nameCardBatchStates_(job).every(function(state){return state&&state.state==='done';}))throw new Error('名刺の配置が完了していません。');
    job.state='finishing';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
  }finally{lock.releaseLock();}
  var ss=SpreadsheetApp.getActiveSpreadsheet(),output=nameCardJobSheet_(job),label='印刷用PDF（'+job.print.paper+'）をダウンロード';
  output.getRange(1,1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(nameCardPdfUrl(ss.getId(),job.sheetId,job.print,job.rows)).build()).setFontSize(10);
  SpreadsheetApp.flush();ss.setActiveSheet(output);job.state='complete';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
  nameCardClearJob_(jobId);return {sheetId:job.sheetId,name:job.name};
}
function abortNameCardJob(jobId){
  var job=nameCardReadJob_(jobId);
  if(nameCardBatchStates_(job).some(function(state){return state&&state.state==='running';}))throw new Error('一部の処理がまだ実行中です。');
  if(job.state!=='complete'){
    var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheets().find(function(s){return s.getSheetId()===job.sheetId;});if(sheet)ss.deleteSheet(sheet);
  }
  nameCardClearJob_(jobId);
}
function nameCardJobSheet_(job){
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheets().find(function(s){return s.getSheetId()===job.sheetId;});
  if(!sheet)throw new Error('作成中の名刺シートが見つかりません。');return sheet;
}
function publishNameCardSheet(){throw new Error('名刺作成ダイアログを開き直してください。');}
