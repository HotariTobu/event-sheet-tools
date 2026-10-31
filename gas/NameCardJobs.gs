/** PropertiesServiceには処理状態と担当範囲だけを記録する。 */
function nameCardJobKey_(id){
  if(typeof id!=='string'||!/^[\w-]+$/.test(id))throw new Error('処理IDが不正です。');
  return 'NAMECARD_JOB_'+id;
}
function nameCardBatchKey_(id,index){return nameCardJobKey_(id)+':'+index;}
function nameCardReadJob_(id){
  var value=PropertiesService.getUserProperties().getProperty(nameCardJobKey_(id));
  if(!value)throw new Error('名刺作成の処理情報がありません。');
  var job=JSON.parse(value);
  if(job.version!==3)throw new Error('名刺作成ダイアログを開き直してください。');
  if(job.spreadsheetId!==SpreadsheetApp.getActiveSpreadsheet().getId())throw new Error('対象のスプレッドシートが違います。');
  return job;
}
function nameCardBatchStates_(job){
  var props=PropertiesService.getUserProperties();
  return job.batches.map(function(batch){return JSON.parse(props.getProperty(nameCardBatchKey_(job.id,batch.index))||'null');});
}
function getNameCardProgress(jobId){
  var job=nameCardReadJob_(jobId),done=0,errors=[];
  nameCardBatchStates_(job).forEach(function(state){
    if(state){done+=state.done;if(state.error&&errors.indexOf(state.error)<0)errors.push(state.error);}
  });
  return {done:done,total:job.total,errors:errors};
}
function nameCardClearJob_(id){
  var props=PropertiesService.getUserProperties(),prefix=nameCardJobKey_(id);
  Object.keys(props.getProperties()).forEach(function(key){if(key===prefix||key.indexOf(prefix+':')===0)props.deleteProperty(key);});
}
function nameCardPeopleHash_(people){
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(people),Utilities.Charset.UTF_8));
}
