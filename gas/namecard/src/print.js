export function printPlan(design,paper){
  const sizes=design.print.papers[paper];if(!sizes)throw Error('用紙サイズが不正です。');
  const plans=[sizes,[sizes[1],sizes[0]]].map(([width,height],index)=>({paper,widthMm:width,heightMm:height,portrait:index===0,columns:Math.floor((width-2*design.print.marginMm)/design.card.widthMm),rows:Math.floor((height-2*design.print.marginMm)/design.card.heightMm)}));
  return plans[1].columns*plans[1].rows>plans[0].columns*plans[0].rows?plans[1]:plans[0];
}
