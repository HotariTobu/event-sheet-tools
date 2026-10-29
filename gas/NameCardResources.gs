/** 素材はジョブ開始時だけ取得し、分割処理では一時キャッシュを共有する。 */
function nameCardAssets_(){
  var source=HtmlService.createHtmlOutputFromFile('NameCardAssets').getContent();
  return JSON.parse(source.slice(source.indexOf('var NameCardAssets=')+19,source.lastIndexOf(';')));
}
function nameCardImagePaths_(assets,people){
  var paths=new Set();
  function key(name){return name.normalize('NFC').replace(/\s/g,'');}
  people.forEach(function(person){
    var highest=Math.max.apply(null,person.ratings.filter(function(v){return v!==null;}));
    assets.tokens.groups.forEach(function(group,i){
      if(person.ratings[i]===highest)paths.add(group.watermark);
      person.favorites[i].forEach(function(name){
        var member=assets.members.find(function(m){return m.group===group.id&&key(m.name)===key(name);});
        if(member&&member.asset)paths.add(member.asset);
      });
    });
  });
  return Array.from(paths);
}
function nameCardResourceKey_(id,slot,index){return nameCardJobKey_(id)+':resource:'+slot+':'+index;}
function nameCardCacheResource_(job,slot,bytes){
  // CacheServiceの1値100KB上限に合わせる。バイナリのソース埋め込みは行わない。
  var packed=Utilities.gzip(Utilities.newBlob(Array.from(bytes,function(v){return v>127?v-256:v;}))).getBytes();
  var text=JSON.stringify(packed),values={},count=Math.ceil(text.length/60000);
  for(var i=0;i<count;i++)values[nameCardResourceKey_(job.id,slot,i)]=text.slice(i*60000,(i+1)*60000);
  job.resourceChunks[slot]=count;
  CacheService.getUserCache().putAll(values,3600);
}
function nameCardResourceKeys_(job,slots){
  var keys=[];
  slots.forEach(function(slot){for(var i=0;i<job.resourceChunks[slot];i++)keys.push(nameCardResourceKey_(job.id,slot,i));});
  return keys;
}
function nameCardReadResource_(job,slot,values){
  var parts=[];
  for(var i=0;i<job.resourceChunks[slot];i++){
    var value=values[nameCardResourceKey_(job.id,slot,i)];
    if(value==null)throw new Error('準備した素材の一時データが失われました。名刺作成をやり直してください。');
    parts.push(value);
  }
  return new Uint8Array(Utilities.ungzip(Utilities.newBlob(JSON.parse(parts.join('')))).getBytes());
}
function nameCardDropResources_(job){
  var slots=Object.keys(job.resourceChunks||{});
  if(slots.length)CacheService.getUserCache().removeAll(nameCardResourceKeys_(job,slots));
}
function prepareNameCardResources(jobId){
  var props=PropertiesService.getUserProperties(),lock=LockService.getUserLock(),job;
  lock.waitLock(30000);
  try{
    job=nameCardReadJob_(jobId);
    if(job.resourceState!=='pending')throw new Error('素材の準備は実行済み、または実行中です。');
    job.resourceState='fetching';props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
  }finally{lock.releaseLock();}
  try{
    var data=loadNameCardPeople();
    if(data.errors.length)throw new Error(data.errors.join('\n'));
    if(nameCardPeopleHash_(data.people)!==job.hash)throw new Error('生成中に回答が変更されました。');
    var assets=nameCardAssets_(),paths=nameCardImagePaths_(assets,data.people);
    var urls=['https://raw.githubusercontent.com/google/fonts/main/apache/kosugimaru/KosugiMaru-Regular.ttf'];
    paths.forEach(function(path){urls.push(assets.images[path]);});
    // URL単位でも重複を除き、同じ元画像を複数回取得しない。
    var unique=Array.from(new Set(urls)),responses=UrlFetchApp.fetchAll(unique.map(function(url){return {url:url,muteHttpExceptions:true};}));
    var fetched={};
    unique.forEach(function(url,i){
      var response=responses[i];
      if(response.getResponseCode()!==200)throw new Error('素材を取得できません：'+url+'（HTTP '+response.getResponseCode()+'）');
      fetched[url]=new Uint8Array(response.getBlob().getBytes());
    });
    nameCardCacheResource_(job,'font',fetched[urls[0]]);
    var pending=[];
    paths.forEach(function(path,i){
      var bytes=fetched[assets.images[path]],slot='image'+i;
      job.resourceSlots[path]=slot;
      if(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){
        NameCardNative.decode(bytes);
        nameCardCacheResource_(job,slot,bytes);
      }else{
        var webp=bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80;
        pending.push({path:path,type:webp?'image/webp':'image/svg+xml',bytes:Array.from(bytes)});
        job.pendingImages.push(path);
      }
    });
    job.resourceState=pending.length?'decoding':'ready';
    props.setProperty(nameCardJobKey_(jobId),JSON.stringify(job));
    return {images:pending};
  }catch(e){nameCardDropResources_(job);throw e;}
}
function completeNameCardResources(request){
  var job=nameCardReadJob_(request.jobId);
  if(job.resourceState!=='decoding')throw new Error('素材の読み込み状態が不正です。');
  var images=request.images;
  if(!Array.isArray(images)||images.length!==job.pendingImages.length)throw new Error('読み込んだ画像が不足しています。');
  var seen=new Set();
  try{
    images.forEach(function(image){
      if(job.pendingImages.indexOf(image.path)<0||seen.has(image.path))throw new Error('読み込んだ画像が不正です。');
      seen.add(image.path);
      var bytes=new Uint8Array(image.bytes);
      NameCardNative.decode(bytes);
      nameCardCacheResource_(job,job.resourceSlots[image.path],bytes);
    });
    job.pendingImages=[];job.resourceState='ready';
    PropertiesService.getUserProperties().setProperty(nameCardJobKey_(job.id),JSON.stringify(job));
  }catch(e){nameCardDropResources_(job);throw e;}
}
function nameCardServerResources(job,people){
  if(job.resourceState!=='ready')throw new Error('素材の準備が完了していません。');
  var assets=nameCardAssets_(),paths=nameCardImagePaths_(assets,people);
  var slots=['font'].concat(paths.map(function(path){return job.resourceSlots[path];}));
  var values=CacheService.getUserCache().getAll(nameCardResourceKeys_(job,slots));
  NameCardNative.setFont(opentype.parse(nameCardReadResource_(job,'font',values).buffer));
  var images={};
  paths.forEach(function(path){images[path]=NameCardNative.decode(nameCardReadResource_(job,job.resourceSlots[path],values));});
  return {assets:assets,images:images};
}
