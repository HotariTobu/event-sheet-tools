import {prepare} from './resources.js';
import {render} from './render.js';
import {printPlan} from './print.js';
const data=JSON.parse(document.getElementById('card-data').textContent),paper=document.getElementById('paper'),button=document.getElementById('create'),status=document.getElementById('status');
const show=message=>{status.textContent=message;};
const call=(method,...args)=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args));
const errorText=error=>error?.message||String(error);
function update(){const p=printPlan(data.design,paper.value);document.getElementById('layout').textContent=p.columns+'列 × '+p.rows+'行（'+p.columns*p.rows+'枚／ページ）';}
paper.addEventListener('change',update);update();
function progress(id,total){
  let stopped=false,timer=null,shown=0;
  async function poll(){
    try{const result=await call('cardProgress',id);if(!stopped){shown=Math.max(shown,result.done);show('名刺を配置中：'+shown+'／'+total+'人'+(result.errors.length?'\n'+result.errors.join('\n'):''));}}
    catch(error){if(!stopped)show('進捗取得エラー：'+errorText(error));}
    finally{if(!stopped)timer=setTimeout(poll,1000);}
  }
  show('名刺を配置中：0／'+total+'人');poll();return()=>{stopped=true;clearTimeout(timer);};
}
button.addEventListener('click',async()=>{
  button.disabled=paper.disabled=true;let job=null,stop=()=>{};
  try{
    show('回答を読み込み中…');const input=await call('cardRead');
    const resources=await prepare(data,input.people,show),cards=[];
    try{
      for(let i=0;i<input.people.length;i++){
        show('名刺画像を生成中：'+i+'／'+input.people.length+'人');await new Promise(resolve=>setTimeout(resolve,0));
        const person=input.people[i];cards.push({index:i,nickname:person.nickname,row:person.row,bytes:render(person,resources)});
      }
    }finally{resources.dispose();}
    show('シートを準備中…');job=await call('cardBegin',{paper:paper.value,hash:input.hash});stop=progress(job.id,cards.length);
    const results=await Promise.allSettled(job.batches.map(batch=>call('cardInsert',{id:job.id,batch:batch.index,cards:cards.slice(batch.start,batch.end).map(card=>({...card,bytes:Array.from(card.bytes)}))})));
    stop();const errors=[...new Set(results.filter(r=>r.status==='rejected').map(r=>errorText(r.reason)))];if(errors.length)throw Error(errors.join('\n'));
    show('PDFリンクを設定中…');await call('cardFinish',job.id);job=null;google.script.host.close();
  }catch(error){stop();let message=errorText(error);if(job){try{await call('cardAbort',job.id);}catch(cleanup){message+='\n終了処理エラー：'+errorText(cleanup);}}show('エラー：'+message);button.disabled=paper.disabled=false;}
});
