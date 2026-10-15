const Solver=require('../js/solver.js'),Design=require('../js/design.js'),{STAGES}=require('../js/stages.js');
function warren(st,h,road,diag,top){
  const d=Design.createDesign(st),S=st.span;
  const add=(x1,y1,x2,y2,c)=>{const r=Design.addSegment(st,d,{x:x1,y:y1},{x:x2,y:y2},c[0],c[1]);if(!r.ok)throw new Error(r.reason)};
  add(0,0,S,0,road);
  for(let x=0;x<S;x+=2){add(x,0,x+1,h,diag);add(x+1,h,x+2,0,diag);}
  for(let x=1;x<S-2;x+=2)add(x,h,x+2,h,top);
  return d;}
const st=STAGES[+process.argv[2]-1];
const out=[];
for(const h of [2,3,4,5]) for(const rs of [0,1,2,3,4]) for(const dt of ['rod','tube']) for(const ds of [0,1,2,3,4]) for(const tt of ['rod','tube']) for(const ts of [0,1,2,3,4]){
  const d=warren(st,h,['rod',rs],[dt,ds],[tt,ts]);const r=Solver.analyze(st,d);
  out.push({h,rs,dt,ds,tt,ts,status:r.status,cap:+r.capacity.toFixed(1),cost:+r.cost.toFixed(0),mode:r.mode});
}
const ok=out.filter(o=>o.status==='ok');
console.log('statuses',JSON.stringify(out.reduce((a,o)=>(a[o.status]=(a[o.status]||0)+1,a),{})));
ok.sort((a,b)=>b.cap-a.cap);console.log('top cap',JSON.stringify(ok.slice(0,3)));
ok.sort((a,b)=>b.cap/b.cost-a.cap/a.cost);console.log('top eff',JSON.stringify(ok.slice(0,3)));
const req=+process.argv[3];const pass=ok.filter(o=>o.cap>=req).sort((a,b)=>a.cost-b.cost);console.log('cheapest pass',JSON.stringify(pass.slice(0,3)));
