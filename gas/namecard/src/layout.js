const pt=25.4/72;
const key=value=>value.normalize('NFC').replace(/\s/g,'');
// All favorites are measured display items. The flow algorithm has no knowledge of members or cohorts.
export function flow(items,width,gap){
  let x=0,y=0,rowHeight=0;
  const placed=items.map(item=>{
    if(x&&x+item.width>width+1e-9){x=0;y+=rowHeight+gap;rowHeight=0;}
    const result={...item,x,y};x+=item.width+gap;rowHeight=Math.max(rowHeight,item.height);return result;
  });
  return {items:placed,height:y+rowHeight};
}
export function favoriteLayout(person,design,members,measure){
  const f=design.favorites,width=((person.handle?f.widthWithId:f.widthWithoutId)-f.columnGap)/f.columns;
  const source=design.groups.flatMap((group,index)=>{
    const names=person.favorites[index];
    return names.length?[{group,items:names.map(name=>({name,asset:members.find(m=>m.group===group.id&&key(m.name)===key(name))?.asset||null}))}]:[];
  });
  function build(scale){
    const available=width-4*scale,gap=(f.iconPitch-f.iconSize)*scale;
    const boxes=source.map(box=>{
      const items=box.items.map((item,index)=>{
        if(item.asset)return {...item,width:f.iconSize*scale,height:f.iconSize*scale};
        const label=(index&&!box.items[index-1].asset?'・':'')+item.name;
        let fontPt=f.fallbackPt*scale,w=measure(label,fontPt);
        if(w>available){fontPt*=available/w;w=available;}
        return {...item,label,fontPt,width:w,height:fontPt*pt*1.25};
      });
      const row=flow(items,available,gap);
      return {group:box.group,items:row.items,height:4.8*scale+row.height};
    });
    let height=0;
    for(let i=0;i<boxes.length;i+=f.columns){if(i)height+=f.rowGap*scale;height+=Math.max(...boxes.slice(i,i+f.columns).map(b=>b.height));}
    return {boxes,width,scale,height};
  }
  const maximum=design.card.heightMm-design.card.safeMarginMm-f.y;
  if(build(1).height<=maximum)return build(1);
  let low=0,high=1;
  for(let i=0;i<30;i++){const mid=(low+high)/2;if(build(mid).height<=maximum)low=mid;else high=mid;}
  return build(low);
}
