/** 95×80mmの名刺を、各用紙の四辺5mm以上の範囲へ面付けする。 */
function nameCardPrintOptions(){
  var sizes={A4:[210,297],A3:[297,420],B5:[182,257],B4:[257,364]},options={};
  Object.keys(sizes).forEach(function(paper){
    ['portrait','landscape'].forEach(function(orientation){
      var w=sizes[paper][orientation==='portrait'?0:1],h=sizes[paper][orientation==='portrait'?1:0];
      var columns=Math.floor((w-10)/95),rows=Math.floor((h-10)/80);
      options[paper+':'+orientation]={paper:paper,orientation:orientation,widthMm:w,heightMm:h,columns:columns,rows:rows,
        marginHorizontalMm:(w-columns*95)/2,marginVerticalMm:(h-rows*80)/2};
    });
  });return options;
}
/** 設定済みPDFへのリンク。リンク行は範囲に含めない。 */
function nameCardPdfUrl(spreadsheetId,sheetId,print,rows){
  // 中央寄せせず、周囲5mmを確保して実寸のセルを配置する。
  var horizontal=5/25.4,vertical=5/25.4;
  var params={format:'pdf',gid:sheetId,size:(print.widthMm/25.4)+'x'+(print.heightMm/25.4),portrait:print.orientation==='portrait',scale:1,
    top_margin:vertical,bottom_margin:vertical,left_margin:horizontal,right_margin:horizontal,
    gridlines:false,sheetnames:false,printtitle:false,pagenum:'UNDEFINED',fzr:false,fzc:false,
    attachment:true,r1:1,c1:0,r2:rows+1,c2:print.columns};
  return 'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(spreadsheetId)+'/export?'+Object.keys(params).map(function(k){return encodeURIComponent(k)+'='+encodeURIComponent(params[k]);}).join('&');
}
/** 配置枚数が多い向きを使う。同数なら縦。 */
function nameCardAutoPrintOptions(){
  var all=nameCardPrintOptions(),chosen={};
  ['A4','A3','B5','B4'].forEach(function(paper){
    var portrait=all[paper+':portrait'],landscape=all[paper+':landscape'];
    chosen[paper]=landscape.columns*landscape.rows>portrait.columns*portrait.rows?landscape:portrait;
  });return chosen;
}
