var NameCardDraw=(()=>{const ptToMm=25.4/72;
  function text(ctx,value,x,y,pt,color='#30313B',align='left') {
    ctx.font=(pt*ptToMm)+'px CardRounded';ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(value,x,y);
  }
  function wrap(ctx,value,width,pt) {
    ctx.font=(pt*ptToMm)+'px CardRounded';const lines=[];let line='';
    for(const c of value){if(line&&ctx.measureText(line+c).width>width){lines.push(line);line='';}line+=c;}
    if(line)lines.push(line);return lines;
  }
  function contain(ctx,image,x,y,w,h){const f=Math.min(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*f,ih=image.naturalHeight*f;ctx.drawImage(image,x+(w-iw)/2,y+(h-ih)/2,iw,ih);}
  function render(person,resources) {
    const {assets,images}=resources,groups=assets.tokens.groups,warnings=[],canvas=new NameCardNative.Raster();
    canvas.width=Math.floor(Math.sqrt(1000000*95/80));canvas.height=Math.floor(canvas.width*80/95);
    const ctx=canvas.getContext('2d');ctx.scale(canvas.width/95,canvas.height/80);ctx.fillStyle='#fff';ctx.fillRect(0,0,95,80);
    const prefix=person.row+'行目「'+person.nickname+'」：';
    const valid=person.ratings.filter(v=>v!==null),highest=Math.max(...valid);
    const themes=groups.filter((g,i)=>person.ratings[i]===highest);
    if(!themes.length)throw Error(prefix+'テーマを決められません。');
    themes.forEach((g,i)=>{
      const slot=83/themes.length,logo=images[g.watermark];
      if(!logo)throw Error(prefix+g.label+'のロゴを読み込めません。');
      contain(ctx,logo,6+i*slot+1.5,6,slot-3,30);
      ctx.strokeStyle=g.color;ctx.lineWidth=ptToMm;ctx.beginPath();ctx.moveTo(6+i*slot,33.5);ctx.lineTo(6+(i+1)*slot,33.5);ctx.stroke();
    });
    ctx.font=(43*ptToMm)+'px CardRounded';const measured=ctx.measureText(person.nickname).width;
    const namePt=Math.min(43,43*83/Math.max(measured,0.001));
    if(namePt<28)warnings.push(prefix+'名前を'+namePt.toFixed(1)+'ptに縮小しています。');
    text(ctx,person.nickname,47.5,30.5,namePt,'#30313B','center');
    if(person.handle)text(ctx,'@'+person.handle,47.5,38.5,8,'#30313B','center');
    const layout=nameCardFavoriteLayout(person,assets),cw=layout.columnWidth,boxes=layout.boxes,s=layout.scale;
    let y=42;
    for(let i=0;i<boxes.length;i+=2){
      const pair=boxes.slice(i,i+2),h=Math.max(...pair.map(b=>b.height));
      pair.forEach((b,j)=>{
        const x=5+j*(cw+2);ctx.fillStyle=b.g.color;ctx.globalAlpha=.06;ctx.beginPath();ctx.roundRect(x,y,cw,h,1.2*s);ctx.fill();ctx.globalAlpha=1;
        text(ctx,b.g.label,x+2*s,y+2.8*s,5.8*s,b.g.color);
        b.icons.forEach((path,k)=>contain(ctx,images[path],x+2*s+(k%b.perRow)*5.5*s,y+4*s+Math.floor(k/b.perRow)*5.5*s,5*s,5*s));
        b.lines.forEach((line,k)=>text(ctx,line,x+2*s,y+(6.5+b.iconRows*5.5+k*2.7)*s,6.1*s));
      });y+=h+1.2*s;
    }
    if(person.handle){
      const qr=qrcode(0,'M');qr.addData('https://x.com/'+person.handle);qr.make();
      const n=qr.getModuleCount(),qrCanvas=new NameCardNative.Raster(),unit=12;
      qrCanvas.width=qrCanvas.height=(n+8)*unit;
      const qc=qrCanvas.getContext('2d');qc.fillStyle='#fff';qc.fillRect(0,0,qrCanvas.width,qrCanvas.height);qc.fillStyle='#000';
      for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))qc.fillRect((c+4)*unit,(r+4)*unit,unit,unit);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(qrCanvas,67,47,23,23);ctx.imageSmoothingEnabled=true;
      text(ctx,'X / PROFILE',72,72.5,5.5,'#7E808B');
    }
    return {canvas,warnings,namePt};
  }
return {render};})();
function nameCardFavoriteLayout(person,assets){
  var cw=person.handle?28.5:41.5;
  function key(s){return s.normalize('NFC').replace(/\s/g,'');}
  var source=[];
  assets.tokens.groups.forEach(function(g,i){
    if(!person.favorites[i].length)return;
    var icons=[],names=[];
    person.favorites[i].forEach(function(name){
      var member=assets.members.find(function(m){return m.group===g.id&&key(m.name)===key(name);});
      if(member&&member.asset)icons.push(member.asset);else names.push(name);
    });
    source.push({g:g,icons:icons,names:names});
  });
  function build(scale){
    var boxes=source.map(function(b){
      var perRow=Math.max(1,Math.floor((cw-4*scale)/(5.5*scale))),iconRows=Math.ceil(b.icons.length/perRow),lines=[],line='';
      function width(value){return Array.from(value).reduce(function(sum,c){return sum+(c.charCodeAt(0)<256?.65:1);},0)*6.1*scale*25.4/72;}
      Array.from(b.names.join('・')).forEach(function(c){if(line&&width(line+c)>cw-4*scale){lines.push(line);line='';}line+=c;});
      if(line)lines.push(line);
      return {g:b.g,icons:b.icons,names:b.names,lines:lines,perRow:perRow,iconRows:iconRows,height:(4.8+iconRows*5.5+lines.length*2.7)*scale};
    });
    var height=0;
    for(var i=0;i<boxes.length;i+=2){if(i)height+=1.2*scale;height+=Math.max(boxes[i].height,boxes[i+1]?boxes[i+1].height:0);}
    return {scale:scale,columnWidth:cw,boxes:boxes,height:height};
  }
  var normal=build(1);if(normal.height<=35)return normal;
  // 縮尺を0.1%単位で比較。アイコンの段数・名前の折り返しも毎回再計算する。
  var low=0,high=1000;
  while(high-low>1){var mid=Math.floor((low+high)/2);if(build(mid/1000).height<=35)low=mid;else high=mid;}
  if(low)return build(low/1000);
  // 固定選択肢を超える長文でも、内容を捨てずに収める。
  var small=build(.001);return build(.001*35/small.height);
}

