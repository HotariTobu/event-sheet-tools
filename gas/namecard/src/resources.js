import opentype from 'opentype.js';
import {decodePng,setFont} from './raster.js';
const key=value=>value.normalize('NFC').replace(/\s/g,'');
export async function prepare(data,people,progress){
  const paths=new Set();
  for(const person of people){
    const highest=Math.max(...person.ratings.filter(v=>v!==null));
    data.design.groups.forEach((group,i)=>{
      if(person.ratings[i]===highest)paths.add(group.watermark);
      for(const name of person.favorites[i]){const m=data.members.find(m=>m.group===group.id&&key(m.name)===key(name));if(m?.asset)paths.add(m.asset);}
    });
  }
  let done=0;const total=paths.size+1,images={};const update=()=>progress('素材を読み込み中：'+done+'／'+total+'点');update();
  const font=async()=>{
    const response=await fetch(data.design.font.url,{mode:'cors',credentials:'omit'});
    if(!response.ok)throw Error('フォントを取得できません（HTTP '+response.status+'）');
    setFont(opentype.parse(await response.arrayBuffer()));done++;update();
  };
  const decode=async()=>{
    for(const path of paths){
      const encoded=data.images[path];if(typeof encoded!=='string')throw Error('素材がありません：'+path);
      images[path]=decodePng(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));done++;update();
    }
  };
  const results=await Promise.allSettled([font(),decode()]);const failed=results.find(r=>r.status==='rejected');if(failed){setFont(null);throw failed.reason;}
  return {design:data.design,members:data.members,images,dispose:()=>setFont(null)};
}
