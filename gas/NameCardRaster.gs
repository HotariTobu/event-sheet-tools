var NameCardNative=(function(){
'use strict';
var Math=globalThis.Math;
var font;
function color(v){if(v==='#fff')return[255,255,255];if(v==='#000')return[0,0,0];return v.slice(1).match(/../g).map(function(c){return parseInt(c,16);});}
function Raster(){this.width=0;this.height=0;this.data=null;}
Raster.prototype.getContext=function(){if(!this.data)this.data=new Uint8ClampedArray(this.width*this.height*4);if(!this.ctx)this.ctx=new Context(this);return this.ctx;};
function Context(canvas){this.canvas=canvas;this.sx=1;this.sy=1;this.fillStyle='#000';this.strokeStyle='#000';this.globalAlpha=1;this.lineWidth=1;this.font='10px';this.textAlign='left';this.imageSmoothingEnabled=true;this.edges=[];}
Context.prototype.scale=function(x,y){this.sx*=x;this.sy*=y;};
Context.prototype.blend=function(x,y,c,alpha){if(x<0||x>=this.canvas.width||y<0||y>=this.canvas.height||alpha<=0)return;var i=(y*this.canvas.width+x)*4,d=this.canvas.data,da=d[i+3]/255,a=alpha+da*(1-alpha);for(var k=0;k<3;k++)d[i+k]=(c[k]*alpha+d[i+k]*da*(1-alpha))/a;d[i+3]=a*255;};
Context.prototype.fillRect=function(x,y,w,h){if(this.globalAlpha===1&&(this.fillStyle==='#fff'||this.fillStyle==='#ffffff')&&x<=0&&y<=0&&(x+w)*this.sx>=this.canvas.width&&(y+h)*this.sy>=this.canvas.height){this.canvas.data.fill(255);return;}var x0=x*this.sx,y0=y*this.sy,x1=(x+w)*this.sx,y1=(y+h)*this.sy,c=color(this.fillStyle);for(var py=Math.max(0,Math.floor(y0));py<Math.min(this.canvas.height,Math.ceil(y1));py++)for(var px=Math.max(0,Math.floor(x0));px<Math.min(this.canvas.width,Math.ceil(x1));px++)this.blend(px,py,c,this.globalAlpha*Math.max(0,Math.min(px+1,x1)-Math.max(px,x0))*Math.max(0,Math.min(py+1,y1)-Math.max(py,y0)));};
Context.prototype.beginPath=function(){this.edges=[];this.point=null;this.start=null;};
Context.prototype.moveTo=function(x,y){this.point=[x*this.sx,y*this.sy];this.start=this.point;};
Context.prototype.edgeTo=function(p){if(this.point)this.edges.push([this.point[0],this.point[1],p[0],p[1]]);this.point=p;};
Context.prototype.lineTo=function(x,y){this.edgeTo([x*this.sx,y*this.sy]);};
Context.prototype.closePath=function(){if(this.start)this.edgeTo(this.start);};
Context.prototype.roundRect=function(x,y,w,h,r){for(var c=0;c<4;c++){var cx=x+(c<2?w-r:r),cy=y+(c===0||c===3?r:h-r),a0=-Math.PI/2+c*Math.PI/2;for(var i=0;i<=8;i++){var a=a0+i*Math.PI/16,p=[(cx+r*Math.cos(a))*this.sx,(cy+r*Math.sin(a))*this.sy];if(c===0&&i===0){this.point=p;this.start=p;}else this.edgeTo(p);}}this.closePath();};
Context.prototype.fill=function(){var edges=this.edges,c=color(this.fillStyle),minY=Infinity,maxY=-Infinity;edges.forEach(function(e){minY=Math.min(minY,e[1],e[3]);maxY=Math.max(maxY,e[1],e[3]);});var w=this.canvas.width,cover=new Float32Array(w);
 for(var y=Math.max(0,Math.floor(minY));y<Math.min(this.canvas.height,Math.ceil(maxY));y++){
  cover.fill(0);for(var sub=0;sub<4;sub++){var scan=y+(sub+.5)/4,hits=[];
   for(var j=0;j<edges.length;j++){var e=edges[j];if(scan>=Math.min(e[1],e[3])&&scan<Math.max(e[1],e[3]))hits.push([e[0]+(scan-e[1])*(e[2]-e[0])/(e[3]-e[1]),e[3]>e[1]?1:-1]);}
   hits.sort(function(a,b){return a[0]-b[0];});var winding=0,start=0;
   for(var j=0;j<hits.length;j++){var old=winding;winding+=hits[j][1];if(old===0&&winding!==0)start=hits[j][0];if(old!==0&&winding===0){var end=hits[j][0];for(var x=Math.max(0,Math.floor(start));x<Math.min(w,Math.ceil(end));x++)cover[x]+=Math.max(0,Math.min(x+1,end)-Math.max(x,start))/4;}}
  }
  for(var x=0;x<w;x++)if(cover[x])this.blend(x,y,c,this.globalAlpha*Math.min(1,cover[x]));
 }
};
Context.prototype.stroke=function(){var prev=this.fillStyle;this.fillStyle=this.strokeStyle;for(var i=0;i<this.edges.length;i++){var e=this.edges[i];if(e[1]===e[3])this.fillRect(Math.min(e[0],e[2])/this.sx,e[1]/this.sy-this.lineWidth/2,Math.abs(e[2]-e[0])/this.sx,this.lineWidth);}this.fillStyle=prev;};
Context.prototype.strokeRect=function(x,y,w,h){var prev=this.fillStyle;this.fillStyle=this.strokeStyle;var t=this.lineWidth;this.fillRect(x-t/2,y-t/2,w+t,t);this.fillRect(x-t/2,y+h-t/2,w+t,t);this.fillRect(x-t/2,y+t/2,t,h-t);this.fillRect(x+w-t/2,y+t/2,t,h-t);this.fillStyle=prev;};
Context.prototype.measureText=function(s){return{width:font.getAdvanceWidth(s,parseFloat(this.font),{kerning:true})};};
Context.prototype.fillText=function(s,x,y){var size=parseFloat(this.font),width=this.measureText(s).width;if(this.textAlign==='center')x-=width/2;var path=font.getPath(s,x,y,size,{kerning:true}),ctx=this;this.beginPath();
 function quadratic(p0,p1,p2){var bend=Math.hypot(p0[0]-2*p1[0]+p2[0],p0[1]-2*p1[1]+p2[1]),steps=Math.max(1,Math.ceil(Math.sqrt(bend/.5)));for(var i=1;i<=steps;i++){var t=i/steps,u=1-t;ctx.edgeTo([u*u*p0[0]+2*u*t*p1[0]+t*t*p2[0],u*u*p0[1]+2*u*t*p1[1]+t*t*p2[1]]);}}
 path.commands.forEach(function(c){if(c.type==='M')ctx.moveTo(c.x,c.y);else if(c.type==='L')ctx.lineTo(c.x,c.y);else if(c.type==='Z')ctx.closePath();else if(c.type==='Q')quadratic(ctx.point,[c.x1*ctx.sx,c.y1*ctx.sy],[c.x*ctx.sx,c.y*ctx.sy]);else if(c.type==='C'){var p=ctx.point,n=Math.max(1,Math.ceil((Math.hypot(c.x1*ctx.sx-p[0],c.y1*ctx.sy-p[1])+Math.hypot((c.x2-c.x1)*ctx.sx,(c.y2-c.y1)*ctx.sy)+Math.hypot((c.x-c.x2)*ctx.sx,(c.y-c.y2)*ctx.sy))/2));for(var i=1;i<=n;i++){var t=i/n,u=1-t;ctx.edgeTo([u*u*u*p[0]+3*u*u*t*c.x1*ctx.sx+3*u*t*t*c.x2*ctx.sx+t*t*t*c.x*ctx.sx,u*u*u*p[1]+3*u*u*t*c.y1*ctx.sy+3*u*t*t*c.y2*ctx.sy+t*t*t*c.y*ctx.sy]);}}});this.fill();};
Context.prototype.drawImage=function(img,x,y,w,h){var sw=img.naturalWidth||img.width,sh=img.naturalHeight||img.height,d=img.data,x0=x*this.sx,y0=y*this.sy,dw=w*this.sx,dh=h*this.sy,c=[0,0,0];for(var py=Math.max(0,Math.floor(y0));py<Math.min(this.canvas.height,Math.ceil(y0+dh));py++)for(var px=Math.max(0,Math.floor(x0));px<Math.min(this.canvas.width,Math.ceil(x0+dw));px++){
 var fx=Math.max(0,Math.min(sw-1,(px+.5-x0)/dw*sw-.5)),fy=Math.max(0,Math.min(sh-1,(py+.5-y0)/dh*sh-.5));
 var alpha=0;if(!this.imageSmoothingEnabled){var i=(Math.round(fy)*sw+Math.round(fx))*4;alpha=d[i+3]/255;c[0]=d[i];c[1]=d[i+1];c[2]=d[i+2];}
 else{var ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy;c[0]=c[1]=c[2]=0;for(var oy=0;oy<2;oy++)for(var ox=0;ox<2;ox++){var index=(Math.min(sh-1,iy+oy)*sw+Math.min(sw-1,ix+ox))*4,a=d[index+3]/255*(ox?tx:1-tx)*(oy?ty:1-ty);alpha+=a;for(var k=0;k<3;k++)c[k]+=d[index+k]*a;}if(alpha)for(var k=0;k<3;k++)c[k]/=alpha;}
 this.blend(px,py,c,alpha*this.globalAlpha);
}};
var table=null;
function crc(bytes){if(!table){table=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c;}}var c=0xffffffff;for(var i=0;i<bytes.length;i++)c=table[(c^bytes[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function be(v){return[(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255];}
function png(canvas){var w=canvas.width,h=canvas.height,d=canvas.data,edgeX=Math.ceil(w/359),edgeY=Math.ceil(h/302);
// 画像がシートの罫線を覆わないよう、白い外周の1表示ピクセル分だけ透明にする。
for(var y=0;y<h;y++)for(var x=0;x<w;x++)if(x<edgeX||x>=w-edgeX||y<edgeY||y>=h-edgeY)d[(y*w+x)*4+3]=0;
var raw=new Uint8Array(h*(w*4+1));for(var y=0;y<h;y++){var row=y*(w*4+1);raw[row]=1;for(var x=0;x<w;x++)for(var k=0;k<4;k++){var i=(y*w+x)*4;raw[row+1+x*4+k]=(d[i+k]-(x?d[i-4+k]:0))&255;}}var z=pako.deflate(raw,{level:3}),parts=[new Uint8Array([137,80,78,71,13,10,26,10])];function chunk(type,data){var out=new Uint8Array(data.length+12);out.set(be(data.length));out.set(Array.from(type).map(function(c){return c.charCodeAt(0);}),4);out.set(data,8);out.set(be(crc(out.subarray(4,out.length-4))),out.length-4);parts.push(out);}chunk('IHDR',new Uint8Array(be(w).concat(be(h),[8,6,0,0,0])));chunk('IDAT',z);chunk('IEND',new Uint8Array(0));var size=parts.reduce(function(n,p){return n+p.length;},0),out=new Uint8Array(size),offset=0;parts.forEach(function(p){out.set(p,offset);offset+=p.length;});return out;}

function decode(bytes){var d=new Uint8Array(bytes),v=new DataView(d.buffer),w=v.getUint32(16),h=v.getUint32(20),channels=d[25]===6?4:d[25]===2?3:0;if(d[24]!==8||!channels||d[28]!==0)throw Error('対応していない素材PNGです。');var packed=[],total=0;for(var pos=8;pos<d.length;){var n=v.getUint32(pos),type=String.fromCharCode.apply(null,d.subarray(pos+4,pos+8));if(type==='IDAT'){packed.push(d.subarray(pos+8,pos+8+n));total+=n;}pos+=n+12;}var input=new Uint8Array(total),offset=0;packed.forEach(function(a){input.set(a,offset);offset+=a.length;});var raw=pako.inflate(input),stride=w*channels,pixels=new Uint8Array(h*stride);for(var y=0;y<h;y++){var filter=raw[y*(stride+1)],row=y*stride;for(var x=0;x<stride;x++){var a=x>=channels?pixels[row+x-channels]:0,b=y?pixels[row+x-stride]:0,c=y&&x>=channels?pixels[row+x-stride-channels]:0,p=0;if(filter===1)p=a;else if(filter===2)p=b;else if(filter===3)p=(a+b)>>>1;else if(filter===4){var q=a+b-c,pa=Math.abs(q-a),pb=Math.abs(q-b),pc=Math.abs(q-c);p=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}pixels[row+x]=(raw[y*(stride+1)+1+x]+p)&255;}}var rgba=new Uint8ClampedArray(w*h*4);for(var i=0;i<w*h;i++){rgba[i*4]=pixels[i*channels];rgba[i*4+1]=pixels[i*channels+1];rgba[i*4+2]=pixels[i*channels+2];rgba[i*4+3]=channels===4?pixels[i*channels+3]:255;}return{naturalWidth:w,naturalHeight:h,data:rgba};}
return{Raster:Raster,png:png,decode:decode,setFont:function(f){font=f;}};
})();
