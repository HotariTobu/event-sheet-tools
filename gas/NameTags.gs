/** 回答を見出しで読み、新しい名刺シートを作る。 */
function createNameCards() {
  var template = HtmlService.createTemplateFromFile('NameCardDialog');
  template.printLayouts=JSON.stringify(nameCardAutoPrintOptions());
  var page = template.evaluate().setWidth(520).setHeight(310);
  SpreadsheetApp.getUi().showModalDialog(page, '名刺シート作成');
}
// 旧メニューからの呼び出しも名刺作成につなぐ。
function createNameTags() { createNameCards(); }
function loadNameCardPeople() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('回答');
  if (!sheet) throw new Error('回答シート「回答」がありません。');
  return nameCardRead(sheet.getDataRange().getDisplayValues());
}
function nameCardRead(data) {
  var text = function(v) { return v == null ? '' : String(v).trim(); };
  var headers = (data[0] || []).map(text), errors = [], warnings = [], people = [];
  function col(title, optional) {
    var found = []; headers.forEach(function(h,i) {if(h===title)found.push(i);});
    if(found.length>1 || (!optional && !found.length)) throw new Error('見出し「'+title+'」が見つからないか、重複しています。');
    return found.length ? found[0] : -1;
  }
  var nickname = col('ニックネーム'), twitter = col('Twitter ID (任意)', true);
  var groups = NAME_CARD_GROUPS.map(function(g) {return {id:g.id,rating:col(g.ratingHeader),favorite:col(g.favoriteHeader)};});
  data.slice(1).forEach(function(row,index) {
    if(row.every(function(v){return !text(v);}))return;
    var sourceRow=index+2,name=text(row[nickname]),prefix=sourceRow+'行目'+(name?'「'+name+'」':'');
    if(!name) errors.push(prefix+'：ニックネームがありません。');
    var handle=twitter<0?'':text(row[twitter]);
    if(/^https?:\/\//i.test(handle)) {
      var match=handle.match(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i);
      if(match)handle=match[1];
    }
    handle=handle.replace(/^@/,'');
    if(handle&&!/^[A-Za-z0-9_]{1,15}$/.test(handle))errors.push(prefix+'：Twitter IDが不正です（'+handle+'）。');
    var ratings=[],favorites=[];
    groups.forEach(function(g) {
      var value=text(row[g.rating]);
      if(!/^[1-5]$/.test(value)) {ratings.push(null);warnings.push(prefix+'：'+g.id+'のレベルが'+(value?'範囲外です。':'未回答です。'));}
      else ratings.push(Number(value));
      var seen = new Set();
      favorites.push(text(row[g.favorite]).split(/[,，、\r\n]+/).map(text).filter(function(n){
        if(!n)return false;var key=n.normalize('NFC').replace(/\s/g,'');if(seen.has(key))return false;seen.add(key);return true;
      }));
    });
    var valid=ratings.filter(function(v){return v!==null;});
    if(!valid.length)errors.push(prefix+'：有効な作品レベルがなく、テーマを決められません。');
    people.push({row:sourceRow,nickname:name,handle:handle,ratings:ratings,favorites:favorites});
  });
  if(!people.length)errors.push('参加者の回答がありません。');
  return {people:people,errors:errors,warnings:warnings};
}
