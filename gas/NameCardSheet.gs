/** 初期設定後、参加者を複数のサーバー実行へ分担する。 */
function beginNameCardJob(request){
  var print=request&&nameCardAutoPrintOptions()[request.paper];
  if(!print)throw new Error('用紙サイズを選択してください。');
  var data=loadNameCardPeople();if(data.errors.length)throw new Error(data.errors.join('\n'));
  var ss=SpreadsheetApp.getActiveSpreadsheet(),output=null,jobId=Utilities.getUuid(),props=PropertiesService.getUserProperties();
  try{
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{var base='名刺 '+Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),'MMdd HHmm'),name=base,suffix=2;
      while(ss.getSheetByName(name))name=base+' ('+suffix+++')';var added=Sheets.Spreadsheets.batchUpdate({requests:[{addSheet:{properties:{title:name}}}]},ss.getId());
      output=createdOutputSheet_(ss.getId(),added.replies[0].addSheet.properties.sheetId);
    }finally{lock.releaseLock();}
    var rows=Math.ceil(data.people.length/print.columns);
    if(output.getMaxRows()<rows+1)output.insertRowsAfter(output.getMaxRows(),rows+1-output.getMaxRows());
    output.setColumnWidths(1,print.columns,359);output.setRowHeight(1,28);output.setRowHeights(2,rows,302);output.setHiddenGridlines(true);
    output.getRange(2,1,rows,print.columns).setBorder(true,true,true,true,true,true,'#000000',SpreadsheetApp.BorderStyle.SOLID);
    // 同時呼び出し上限10枠のうち、1枠を進捗取得用に残す。
    var count=Math.min(9,data.people.length),batches=[];
    for(var i=0;i<count;i++)batches.push({index:i,start:Math.floor(i*data.people.length/count),end:Math.floor((i+1)*data.people.length/count)});
    var job={id:jobId,spreadsheetId:ss.getId(),sheetId:output.getSheetId(),name:name,total:data.people.length,rows:rows,print:print,batches:batches,hash:nameCardPeopleHash_(data.people),state:'active',resourceState:'pending',resourceChunks:{},resourceSlots:{},pendingImages:[]};
    var values={};values[nameCardJobKey_(jobId)]=JSON.stringify(job);
    batches.forEach(function(b){values[nameCardBatchKey_(jobId,b.index)]=JSON.stringify({state:'pending',done:0});});props.setProperties(values);
    SpreadsheetApp.flush();
    return {jobId:jobId,total:job.total,batches:batches.map(function(b){return b.index;})};
  }catch(e){if(output)ss.deleteSheet(output);nameCardClearJob_(jobId);throw e;}
}
function runNameCardBatch(request){
  var job=nameCardReadJob_(request.jobId),index=request.batchIndex,batch=job.batches[index];
  if(!Number.isInteger(index)||!batch)throw new Error('担当範囲が不正です。');
  var props=PropertiesService.getUserProperties(),key=nameCardBatchKey_(job.id,index),lock=LockService.getUserLock();lock.waitLock(30000);
  try{var previous=JSON.parse(props.getProperty(key)||'null');
    if(previous&&previous.state==='done')return {done:previous.done};
    if(!previous||previous.state!=='pending')throw new Error('この担当範囲は実行済み、または実行中です。');
    props.setProperty(key,JSON.stringify({state:'running',done:0}));
  }finally{lock.releaseLock();}
  var done=0;
  try{
    var data=loadNameCardPeople();if(data.errors.length)throw new Error(data.errors.join('\n'));
    if(nameCardPeopleHash_(data.people)!==job.hash)throw new Error('生成中に回答が変更されました。');
    var ss=SpreadsheetApp.getActiveSpreadsheet(),output=nameCardJobSheet_(job),resources=nameCardServerResources(job,data.people.slice(batch.start,batch.end));
    for(var i=batch.start;i<batch.end;i++){
      var person=data.people[i],card=NameCardDraw.render(person,resources),png=nameCardServerPng(card.canvas);
      var bytes=Array.from(png,function(v){return v>127?v-256:v;}),blob=Utilities.newBlob(bytes,'image/png','名刺'+(i+1)+'.png');
      output.insertImage(blob,i%job.print.columns+1,Math.floor(i/job.print.columns)+2).setWidth(359).setHeight(302)
        .setAltTextTitle(person.nickname).setAltTextDescription('回答 '+person.row+'行目');
      done++;props.setProperty(key,JSON.stringify({state:'running',done:done}));
    }
    SpreadsheetApp.flush();props.setProperty(key,JSON.stringify({state:'done',done:done}));
    nameCardMaybeFinish_(job.id);
    return {done:done};
  }catch(e){props.setProperty(key,JSON.stringify({state:'failed',done:done,error:e.message||String(e)}));throw e;}
}
function getNameCardProgress(jobId){
  var job=nameCardReadJob_(jobId),all=PropertiesService.getUserProperties().getProperties(),done=0,errors=[];
  job.batches.forEach(function(b){var s=JSON.parse(all[nameCardBatchKey_(jobId,b.index)]||'null');if(s){done+=s.done;if(s.error)errors.push(s.error);}});
  return {done:done,total:job.total,phase:job.state,errors:errors};
}
function nameCardMaybeFinish_(jobId){
  var props=PropertiesService.getUserProperties(),lock=LockService.getUserLock(),job;
  lock.waitLock(30000);
  try{job=nameCardReadJob_(jobId);if(job.state!=='active')return;
    var all=props.getProperties();if(!job.batches.every(function(b){var state=JSON.parse(all[nameCardBatchKey_(jobId,b.index)]||'null');return state&&state.state==='done';}))return;
    job.state='finishing';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
  }finally{lock.releaseLock();}
  try{
    var ss=SpreadsheetApp.getActiveSpreadsheet(),output=nameCardJobSheet_(job),label='印刷用PDF（'+job.print.paper+'）をダウンロード';
    output.getRange(1,1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText(label).setLinkUrl(nameCardPdfUrl(ss.getId(),job.sheetId,job.print,job.rows)).build()).setFontSize(10);
    SpreadsheetApp.flush();ss.setActiveSheet(output);job.state='complete';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
  }catch(e){job.state='failed';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));throw e;}
}
function finishNameCardJob(jobId){
  var job=nameCardReadJob_(jobId);if(job.state!=='complete')throw new Error('名刺の生成・配置が完了していません。');
  nameCardClearJob_(jobId);return {sheetId:job.sheetId,name:job.name};
}
function abortNameCardJob(jobId){
  var job=nameCardReadJob_(jobId),props=PropertiesService.getUserProperties();
  if(job.state==='complete')return finishNameCardJob(jobId);
  var all=props.getProperties();
  if(job.batches.some(function(b){var s=JSON.parse(all[nameCardBatchKey_(jobId,b.index)]||'null');return s&&s.state==='running';}))throw new Error('一部の処理がまだ実行中です。');
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheets().find(function(s){return s.getSheetId()===job.sheetId;});
  if(sheet)ss.deleteSheet(sheet);nameCardClearJob_(jobId);return null;
}
function nameCardJobKey_(id){if(typeof id!=='string'||!/^[\w-]+$/.test(id))throw new Error('処理IDが不正です。');return 'NAMECARD_JOB_'+id;}
function nameCardBatchKey_(id,index){return nameCardJobKey_(id)+':'+index;}
function nameCardReadJob_(id){var value=PropertiesService.getUserProperties().getProperty(nameCardJobKey_(id));if(!value)throw new Error('名刺作成の処理情報がありません。');var job=JSON.parse(value);if(job.spreadsheetId!==SpreadsheetApp.getActiveSpreadsheet().getId())throw new Error('対象のスプレッドシートが違います。');return job;}
function nameCardJobSheet_(job){var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheets().find(function(s){return s.getSheetId()===job.sheetId;});if(!sheet)throw new Error('作成中の名刺シートが見つかりません。');return sheet;}
function nameCardClearJob_(id){var props=PropertiesService.getUserProperties(),prefix=nameCardJobKey_(id),all=props.getProperties();if(all[prefix])nameCardDropResources_(JSON.parse(all[prefix]));Object.keys(all).forEach(function(k){if(k===prefix||k.indexOf(prefix+':')===0)props.deleteProperty(k);});}
function nameCardPeopleHash_(people){return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(people),Utilities.Charset.UTF_8));}
// 開いたままの旧ダイアログから、逐次版を呼ばせない。
function publishNameCardSheet(){throw new Error('ダイアログを開き直してください。');}

function nameCardServerPng(canvas){
  var png=NameCardNative.png(canvas);
  while(png.length>2000000){
    var ratio=Math.min(.95,Math.sqrt(1950000/png.length)),smaller=new NameCardNative.Raster();
    smaller.width=Math.max(1,Math.floor(canvas.width*ratio));smaller.height=Math.max(1,Math.floor(canvas.height*ratio));
    smaller.getContext('2d').drawImage(canvas,0,0,smaller.width,smaller.height);canvas=smaller;png=NameCardNative.png(canvas);
  }
  return png;
}
