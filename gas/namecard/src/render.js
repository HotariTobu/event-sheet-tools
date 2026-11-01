import qrcode from 'qrcode-generator';
import {Raster,encodePng} from './raster.js';
import {favoriteLayout} from './layout.js';
const pt=25.4/72;
function text(ctx,value,x,y,size,color='#30313B',align='left'){
  ctx.font=(size*pt)+'px';ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(value,x,y);
}
function contain(ctx,image,x,y,w,h){
  const factor=Math.min(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*factor,ih=image.naturalHeight*factor;
  ctx.drawImage(image,x+(w-iw)/2,y+(h-ih)/2,iw,ih);
}
export function render(person,{design:d,members,images}){
  const canvas=new Raster();canvas.width=Math.floor(Math.sqrt(1000000*d.card.widthMm/d.card.heightMm));canvas.height=Math.floor(canvas.width*d.card.heightMm/d.card.widthMm);
  const ctx=canvas.getContext('2d');ctx.scale(canvas.width/d.card.widthMm,canvas.height/d.card.heightMm);ctx.fillStyle=d.card.background;ctx.fillRect(0,0,d.card.widthMm,d.card.heightMm);
  const highest=Math.max(...person.ratings.filter(v=>v!==null)),themes=d.groups.filter((g,i)=>person.ratings[i]===highest);
  if(!themes.length)throw Error('有効な作品レベルがありません。');
  themes.forEach((group,index)=>{
    const slot=d.watermark.width/themes.length,x=d.watermark.x+slot*index;
    contain(ctx,images[group.watermark],x+1.5,d.watermark.centerY-d.watermark.maxHeight/2,slot-3,d.watermark.maxHeight);
    ctx.strokeStyle=group.color;ctx.lineWidth=d.line.strokePt*pt;ctx.beginPath();ctx.moveTo(d.line.x+d.line.width*index/themes.length,d.line.y);ctx.lineTo(d.line.x+d.line.width*(index+1)/themes.length,d.line.y);ctx.stroke();
  });
  const measure=(value,size)=>{ctx.font=(size*pt)+'px';return ctx.measureText(value).width;};
  const size=d.font.nicknameMaxPt*Math.min(1,d.nickname.maxWidth/Math.max(.001,measure(person.nickname,d.font.nicknameMaxPt)));
  text(ctx,person.nickname,d.nickname.centerX,d.nickname.baselineY,size,d.font.color,'center');
  if(person.handle)text(ctx,'@'+person.handle,d.handle.centerX,d.handle.baselineY,d.handle.fontPt,d.font.color,'center');
  const layout=favoriteLayout(person,d,members,measure),f=d.favorites,s=layout.scale;
  let y=f.y;
  for(let i=0;i<layout.boxes.length;i+=f.columns){
    const row=layout.boxes.slice(i,i+f.columns),height=Math.max(...row.map(b=>b.height));
    row.forEach((box,column)=>{
      const x=f.x+column*(layout.width+f.columnGap);
      ctx.fillStyle=box.group.color;ctx.globalAlpha=f.backgroundOpacity;ctx.beginPath();ctx.roundRect(x,y,layout.width,height,f.cornerRadius*s);ctx.fill();ctx.globalAlpha=1;
      text(ctx,box.group.label,x+2*s,y+2.8*s,f.labelPt*s,box.group.color);
      for(const item of box.items){
        const left=x+2*s+item.x,top=y+4*s+item.y;
        if(item.asset)contain(ctx,images[item.asset],left,top,item.width,item.height);
        else text(ctx,item.label,left,top+(item.height+item.fontPt*pt*.75)/2,item.fontPt,d.font.color);
      }
    });y+=height+f.rowGap*s;
  }
  if(person.handle){
    const qr=qrcode(0,d.qr.errorCorrection);qr.addData('https://x.com/'+person.handle);qr.make();
    const count=qr.getModuleCount(),quiet=d.qr.quietZoneModules,unit=12,image=new Raster();image.width=image.height=(count+quiet*2)*unit;
    const q=image.getContext('2d');q.fillStyle='#fff';q.fillRect(0,0,image.width,image.height);q.fillStyle='#000';
    for(let row=0;row<count;row++)for(let column=0;column<count;column++)if(qr.isDark(row,column))q.fillRect((column+quiet)*unit,(row+quiet)*unit,unit,unit);
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,d.qr.x,d.qr.y,d.qr.size,d.qr.size);ctx.imageSmoothingEnabled=true;text(ctx,'X / PROFILE',72,72.5,5.5,'#7E808B');
  }
  let current=canvas;
  for(;;){
    const bytes=encodePng(current);if(bytes.length<=2000000)return bytes;
    const ratio=Math.min(.95,Math.sqrt(1950000/bytes.length)),smaller=new Raster();smaller.width=Math.max(1,Math.floor(current.width*ratio));smaller.height=Math.max(1,Math.floor(current.height*ratio));smaller.getContext('2d').drawImage(current,0,0,smaller.width,smaller.height);current=smaller;
  }
}
