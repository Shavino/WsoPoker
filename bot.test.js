const E = require("./engine.js");
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

let hands=0, actions=0, rejects=0, fail=0, showdowns=0;
for (let seed=1; seed<=3000; seed++){
  const rng=mulberry32(seed*7+1);
  const n=2+Math.floor(rng()*5);
  const players=[];
  for(let i=0;i<n;i++) players.push({id:(i===0?"bot_dealer":"P"+i),name:"x",stack:60+Math.floor(rng()*440)});
  const total=players.reduce((s,p)=>s+p.stack,0);
  let g=E.startHand(players,{button:-1,sb:10,bb:20,rng});
  if(g.error) continue;
  hands++;
  let guard=0;
  while(!g.handOver && guard++<400){
    const pid=g.players[g.toAct].id;
    // EVERY player uses the bot brain (stress test the AI's legality)
    const act=E.botDecision(g,pid,rng);
    const r=E.applyAction(g,pid,act);
    if(!r.ok){ rejects++; fail++; console.log("seed "+seed+" illegal bot action "+JSON.stringify(act)+" -> "+r.error);
      // recover to keep looping
      const la=E.legalActions(g); E.applyAction(g,pid, la&&la.check?{type:"check"}:{type:"fold"});
    }
    actions++;
  }
  if(!g.handOver){ fail++; console.log("seed "+seed+" did not terminate"); continue; }
  const end=g.players.reduce((s,p)=>s+p.stack,0);
  if(end!==total){ fail++; console.log("seed "+seed+" chip leak "+total+"->"+end); }
  if(g.result && !g.result.byFold) showdowns++;
}
console.log("bot-driven hands="+hands+" actions="+actions+" showdowns="+showdowns+" illegal="+rejects);
console.log(fail===0?"✅ BOT AI PASSED — only legal actions, hands terminate, chips conserved":"❌ "+fail+" failures");
process.exit(fail===0?0:1);
