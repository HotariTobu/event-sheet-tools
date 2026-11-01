/** Sheet access and job coordination only. This file is built into gas/NameCard.gs. */
function cardRead(){
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName('回答');if(!sheet)throw Error('回答シート「回答」がありません。');
  var data=sheet.getDataRange().getDisplayValues(),headers=data.shift()||[],errors=[];
  var clean=function(value){return String(value==null?'':value).trim();};headers=headers.map(clean);
  function column(title,optional){
    var found=[];headers.forEach(function(h,i){if(h===title)found.push(i);});
    if(found.length>1||(!optional&&!found.length))throw Error('見出し「'+title+'」が見つからないか、重複しています。');
    return found.length?found[0]:-1;
  }
  var nameColumn=column('ニックネーム'),handleColumn=column('Twitter ID (任意)',true);
  var groups=CARD_HEADERS.map(function(g){return {rating:column(g.ratingHeader),favorite:column(g.favoriteHeader)};});
  var people=[];
  data.forEach(function(row,index){
    if(row.every(function(value){return !clean(value);}))return;
    var nickname=clean(row[nameColumn]),handle=handleColumn<0?'':clean(row[handleColumn]),rowNumber=index+2;
    var prefix=rowNumber+'行目'+(nickname?'「'+nickname+'」':'');
    if(!nickname)errors.push(prefix+'：ニックネームがありません。');
    var url=handle.match(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
    if(url)handle=url[1];handle=handle.replace(/^@/,'');
    if(handle&&!/^[A-Za-z0-9_]{1,15}$/.test(handle))errors.push(prefix+'：Twitter IDが不正です。');
    var ratings=[],favorites=[];
    groups.forEach(function(group){
      var value=clean(row[group.rating]);ratings.push(/^[1-5]$/.test(value)?Number(value):null);
      var seen=new Set();favorites.push(clean(row[group.favorite]).split(/[,，、\r\n]+/).map(clean).filter(function(name){
        var key=name.normalize('NFC').replace(/\s/g,'');if(!key||seen.has(key))return false;seen.add(key);return true;
      }));
    });
    if(ratings.every(function(value){return value===null;}))errors.push(prefix+'：有効な作品レベルがありません。');
    people.push({row:rowNumber,nickname:nickname,handle:handle,ratings:ratings,favorites:favorites});
  });
  if(!people.length)errors.push('参加者の回答がありません。');if(errors.length)throw Error(errors.join('\n'));
  return {people:people,hash:Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(people),Utilities.Charset.UTF_8))};
}
function cardKey_(id){if(typeof id!=='string'||!/^[\w-]+$/.test(id))throw Error('処理IDが不正です。');return 'CARD_JOB_'+id;}
function cardJob_(id){
  var raw=PropertiesService.getUserProperties().getProperty(cardKey_(id));if(!raw)throw Error('名刺作成の処理情報がありません。');
  var job=JSON.parse(raw);if(job.spreadsheetId!==SpreadsheetApp.getActiveSpreadsheet().getId())throw Error('対象のスプレッドシートが違います。');return job;
}
function cardStates_(job){var all=PropertiesService.getUserProperties().getProperties();return job.batches.map(function(batch){return JSON.parse(all[cardKey_(job.id)+':'+batch.index]||'null');});}
function cardClear_(job){var props=PropertiesService.getUserProperties();props.deleteProperty(cardKey_(job.id));job.batches.forEach(function(batch){props.deleteProperty(cardKey_(job.id)+':'+batch.index);});}
function cardSheet_(job){
  var sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetById(job.sheetId);
  if(!sheet)throw Error('作成中の名刺シートが見つかりません。');return sheet;
}
function cardBegin(request){
  var print=request&&CARD_PRINT[request.paper];if(!print)throw Error('用紙サイズを選択してください。');
  var input=cardRead();if(request.hash!==input.hash)throw Error('画像の生成中に回答が変更されました。作成をやり直してください。');
  var ss=SpreadsheetApp.getActiveSpreadsheet(),props=PropertiesService.getUserProperties(),id=Utilities.getUuid();
  var count=Math.min(9,input.people.length),batches=[];
  for(var i=0;i<count;i++)batches.push({index:i,start:Math.floor(i*input.people.length/count),end:Math.floor((i+1)*input.people.length/count)});
  var job={id:id,spreadsheetId:ss.getId(),sheetId:null,total:input.people.length,rows:Math.ceil(input.people.length/print.columns),print:print,batches:batches,state:'preparing'};
  try{
    var lock=LockService.getScriptLock();lock.waitLock(30000);
    try{
      var base='名刺 '+Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),'MMdd HHmm'),name=base,suffix=2;
      while(ss.getSheetByName(name))name=base+' ('+suffix+++')';
      var sheet=ss.insertSheet(name,ss.getNumSheets());job.sheetId=sheet.getSheetId();job.name=name;
    }finally{lock.releaseLock();}
    if(sheet.getMaxRows()<job.rows+1)sheet.insertRowsAfter(sheet.getMaxRows(),job.rows+1-sheet.getMaxRows());
    if(sheet.getMaxColumns()<print.columns)sheet.insertColumnsAfter(sheet.getMaxColumns(),print.columns-sheet.getMaxColumns());
    sheet.setColumnWidths(1,print.columns,CARD_CELL.width);sheet.setRowHeight(1,28);sheet.setRowHeights(2,job.rows,CARD_CELL.height);sheet.setHiddenGridlines(true);
    sheet.getRange(2,1,job.rows,print.columns).setBorder(true,true,true,true,true,true,'#000000',SpreadsheetApp.BorderStyle.SOLID);
    SpreadsheetApp.flush();job.state='active';var values={};values[cardKey_(id)]=JSON.stringify(job);
    batches.forEach(function(batch){values[cardKey_(id)+':'+batch.index]=JSON.stringify({state:'pending',done:0});});props.setProperties(values);
    return {id:id,batches:batches};
  }catch(error){
    if(job.sheetId!==null){var output=SpreadsheetApp.openById(job.spreadsheetId).getSheetById(job.sheetId);if(output)ss.deleteSheet(output);}cardClear_(job);throw error;
  }
}
function cardInsert(request){
  var job=cardJob_(request.id),batch=job.batches[request.batch];
  if(job.state!=='active'||!Number.isInteger(request.batch)||!batch)throw Error('担当範囲が不正です。');
  if(!Array.isArray(request.cards)||request.cards.length!==batch.end-batch.start)throw Error('名刺画像の数が一致しません。');
  var blobs=request.cards.map(function(card,offset){
    if(card.index!==batch.start+offset)throw Error('名刺画像の順序が一致しません。');
    var bytes=card.bytes;
    if(!Array.isArray(bytes)||bytes.length<33||bytes.length>2000000||bytes.some(function(v){return !Number.isInteger(v)||v<0||v>255;}))throw Error('名刺PNGのデータが不正です。');
    if([137,80,78,71,13,10,26,10].some(function(v,i){return bytes[i]!==v;}))throw Error('名刺画像がPNGではありません。');
    function u32(i){return bytes[i]*16777216+bytes[i+1]*65536+bytes[i+2]*256+bytes[i+3];}
    var width=u32(16),height=u32(20);if(!width||!height||width*height>1000000)throw Error('名刺PNGの画素数が上限を超えています。');
    return Utilities.newBlob(bytes.map(function(v){return v>127?v-256:v;}),'image/png','名刺'+(card.index+1)+'.png');
  });
  var props=PropertiesService.getUserProperties(),key=cardKey_(job.id)+':'+batch.index,lock=LockService.getUserLock();lock.waitLock(30000);
  try{
    var previous=JSON.parse(props.getProperty(key)||'null');if(previous&&previous.state==='done')return;
    if(!previous||previous.state!=='pending')throw Error('担当範囲は実行済み、または実行中です。');props.setProperty(key,JSON.stringify({state:'running',done:0}));
  }finally{lock.releaseLock();}
  var done=0;
  try{
    var sheet=cardSheet_(job);
    request.cards.forEach(function(card,i){
      sheet.insertImage(blobs[i],card.index%job.print.columns+1,Math.floor(card.index/job.print.columns)+2).setWidth(CARD_CELL.width).setHeight(CARD_CELL.height).setAltTextTitle(card.nickname).setAltTextDescription('回答 '+card.row+'行目');
      done++;props.setProperty(key,JSON.stringify({state:'running',done:done}));
    });SpreadsheetApp.flush();props.setProperty(key,JSON.stringify({state:'done',done:done}));
  }catch(error){props.setProperty(key,JSON.stringify({state:'failed',done:done,error:error.message||String(error)}));throw error;}
}
function cardProgress(id){var job=cardJob_(id),done=0,errors=[];cardStates_(job).forEach(function(state){if(state){done+=state.done;if(state.error&&errors.indexOf(state.error)<0)errors.push(state.error);}});return {done:done,errors:errors};}
function cardFinish(id){
  var job=cardJob_(id),lock=LockService.getUserLock(),props=PropertiesService.getUserProperties();lock.waitLock(30000);
  try{
    if(job.state!=='active'||!cardStates_(job).every(function(s){return s&&s.state==='done';}))throw Error('名刺の配置が完了していません。');
    job.state='finishing';props.setProperty(cardKey_(id),JSON.stringify(job));
  }finally{lock.releaseLock();}
  var sheet=cardSheet_(job),p=job.print,margin=CARD_MARGIN/25.4;
  var params={format:'pdf',gid:job.sheetId,size:(p.widthMm/25.4)+'x'+(p.heightMm/25.4),portrait:p.portrait,scale:1,top_margin:margin,bottom_margin:margin,left_margin:margin,right_margin:margin,gridlines:false,sheetnames:false,printtitle:false,pagenum:'UNDEFINED',fzr:false,fzc:false,attachment:true,r1:1,c1:0,r2:job.rows+1,c2:p.columns};
  var url='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(job.spreadsheetId)+'/export?'+Object.keys(params).map(function(key){return encodeURIComponent(key)+'='+encodeURIComponent(params[key]);}).join('&');
  sheet.getRange(1,1).setRichTextValue(SpreadsheetApp.newRichTextValue().setText('印刷用PDF（'+p.paper+'）をダウンロード').setLinkUrl(url).build()).setFontSize(10);
  SpreadsheetApp.flush();SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);cardClear_(job);
}
function cardAbort(id){
  var job=cardJob_(id);if(cardStates_(job).some(function(s){return s&&s.state==='running';}))throw Error('一部の処理がまだ実行中です。');
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetById(job.sheetId);if(sheet)ss.deleteSheet(sheet);cardClear_(job);
}
