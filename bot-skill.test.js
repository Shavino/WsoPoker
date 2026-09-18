const E = require("./engine.js");
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

// Opponent styles the smart bot should beat:
function stationAction(g){ const la=E.legalActions(g); if(!la)return{type:"check"}; if(la.check)return{type:"check"}; return{type:"call"}; } // never folds
function randomAction(g,rnd){ const la=E.legalActions(g); if(!la)return{type:"check"}; const c=[]; if(la.fold)c.push({type:"fold"}); if(la.check)c.push({type:"check"}); if(la.call)c.push({type:"call"}); if(la.raise)c.push({type:"raise",amount:la.minRaiseTo}); return c[Math.floor(rnd()*c.length)]; }

function match(oppName, oppFn, hands){
  let smartProfit=0, played=0;
  for(let s=1;s<=hands;s++){
    const rnd=mulberry32(s*2654435761 % 2147483647 + 11);
    const players=[{id:"SMART",name:"smart",stack:1000},{id:"OPP",name:oppName,stack:1000}];
    let g=E.startHand(players,{button:(s%2),sb:10,bb:20,rng:rnd}); // alternate button for fairness
    if(g.error) continue;
    let guard=0;
    while(!g.handOver && guard++<300){
      const pid=g.players[g.toAct].id;
      const act = pid==="SMART" ? E.botDecision(g,"SMART",rnd) : oppFn(g,rnd);
      const r=E.applyAction(g,pid,act);
      if(!r.ok){ const la=E.legalActions(g); E.applyAction(g,pid, la&&la.check?{type:"check"}:{type:"fold"}); }
    }
    if(!g.handOver) continue;
    const smart=g.players.find(p=>p.id==="SMART");
    smartProfit += (smart.stack-1000);
    played++;
  }
  const bbPer100 = (smartProfit/played)/20*100;
  console.log("vs "+oppName+": "+played+" hands, smart net "+smartProfit+" chips  ("+bbPer100.toFixed(1)+" bb/100)");
  return bbPer100;
}

console.log("Heads-up skill check (smart Dealer AI vs weak styles):");
const a=match("calling-station", stationAction, 4000);
const b=match("random", (g,r)=>randomAction(g,r), 4000);
const ok = a>0 && b>0;
console.log(ok ? "✅ Smart AI is winning vs both weak styles (positive bb/100)" : "❌ AI not beating weak styles");
process.exit(ok?0:1);
