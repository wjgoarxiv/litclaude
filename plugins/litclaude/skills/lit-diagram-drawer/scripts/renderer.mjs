import { spawnSync } from 'node:child_process';

const MIN_AGENT_BROWSER=[0,38,1];
const MIN_CHROME_MAJOR=154;

const SETUP_STEPS=[
  'npm install -g agent-browser@latest   # 0.38.1 or newer',
  'agent-browser install                 # Chrome for Testing 154 or newer',
];

function versionAtLeast(found,minimum){
  for(let i=0;i<minimum.length;i++){
    if((found[i]??0)!==minimum[i])return (found[i]??0)>minimum[i];
  }
  return true;
}

function probeRenderer(){
  const cli=spawnSync('agent-browser',['--version'],{encoding:'utf8'});
  const cliText=(cli.stdout||cli.stderr||'').trim();
  const version=cli.status===0?cliText.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number):null;
  const agentBrowser={found:Boolean(version),ok:Boolean(version)&&versionAtLeast(version,MIN_AGENT_BROWSER),detail:cli.error?'agent-browser not found on PATH':cliText||'agent-browser not found on PATH'};
  if(!agentBrowser.ok)return {ok:false,agentBrowser,chrome:{ok:false,detail:'not checked without agent-browser '+MIN_AGENT_BROWSER.join('.')+'+'},setup:SETUP_STEPS};
  const doctor=spawnSync('agent-browser',['doctor','--json'],{encoding:'utf8'});
  let report=null;
  try{report=JSON.parse(doctor.stdout);}catch{}
  const message=report?.checks?.find((check)=>check.id==='chrome.installed')?.message||'';
  const major=Number(message.match(/\b(\d{3})\.\d+\.\d+/)?.[1]);
  const chrome={ok:Boolean(report?.success)&&major>=MIN_CHROME_MAJOR,detail:message||'Chrome for Testing not reported by agent-browser doctor'};
  return {ok:chrome.ok,agentBrowser,chrome,setup:chrome.ok?[]:SETUP_STEPS.slice(1)};
}

export { MIN_AGENT_BROWSER, MIN_CHROME_MAJOR, SETUP_STEPS, probeRenderer, versionAtLeast };
