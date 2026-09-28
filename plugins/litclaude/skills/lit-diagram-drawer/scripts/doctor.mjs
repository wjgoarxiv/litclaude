#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MIN_AGENT_BROWSER, MIN_CHROME_MAJOR, probeRenderer } from './renderer.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const outIndex=args.indexOf('--out');
const outDir=path.resolve(outIndex>=0&&args[outIndex+1]?args[outIndex+1]:process.cwd());
const report=[];
function check(name,ok,detail,{required=true}={}){report.push({name,required,status:ok?'pass':required?'fail':'missing',detail});}

const font=path.join(root,'assets/fonts/PretendardVariable.woff2');
const license=path.join(root,'assets/fonts/OFL.txt');
for(const file of [font,license]) check(path.relative(root,file),fs.existsSync(file),fs.existsSync(file)?String(fs.statSync(file).size)+' bytes':'missing');
check('font SHA-256 matches provenance',(()=>{try{const m=JSON.parse(fs.readFileSync(path.join(root,'assets/fonts/provenance.json'),'utf8'));return m.files?.some((f)=>f.file==='PretendardVariable.woff2'&&f.sha256===crypto.createHash('sha256').update(fs.readFileSync(font)).digest('hex'));}catch{return false;}})(),'assets/fonts/provenance.json');
const detector=path.resolve(root,'../lit-humanizer/scripts/detect.mjs');
const detected=spawnSync(process.execPath,[detector,'--json','-'],{input:'diagram label',encoding:'utf8'});
check('lit-humanizer visible-text detector',detected.status===0,detected.status===0?path.relative(path.resolve(root,'..'),detector):(detected.stderr||detected.error?.message||'detector missing').trim());
const probe=path.join(outDir,'.lit-diagram-write-probe-'+process.pid);
try{fs.writeFileSync(probe,'ok');fs.unlinkSync(probe);check('output write access',true,outDir);}catch(error){check('output write access',false,outDir+': '+error.message);}

const renderer=probeRenderer();
check('agent-browser '+MIN_AGENT_BROWSER.join('.')+'+ (PNG export)',renderer.agentBrowser.ok,renderer.agentBrowser.detail,{required:false});
check('Chrome for Testing '+MIN_CHROME_MAJOR+'+ (PNG export)',renderer.chrome.ok,renderer.chrome.detail,{required:false});
const rsvg=spawnSync('rsvg-convert',['--version'],{encoding:'utf8'});
check('rsvg-convert (optional SVG preview)',rsvg.status===0,(rsvg.stdout||rsvg.stderr||'not found on PATH').trim(),{required:false});

const authoring=report.filter((item)=>item.required).every((item)=>item.status==='pass');
console.log(JSON.stringify({ok:authoring,authoring,export:renderer.ok,checks:report,userSetup:renderer.ok?[]:renderer.setup},null,2));
if(!renderer.ok)console.error('PNG export is unavailable until you run:\n  '+renderer.setup.join('\n  ')+'\nDiagram authoring and every non-rendering check still work.');
if(!authoring)process.exitCode=1;
