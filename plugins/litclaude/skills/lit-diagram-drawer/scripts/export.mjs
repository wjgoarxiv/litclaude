#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBlockRegistry } from './block-registry.mjs';
import { decodeXmlCharacterReferences, officeCssUrlsAreSafe, officeHrefRefsAreSafe } from './office-safety.mjs';
import { probeRenderer, runAgentBrowser } from './renderer.mjs';
import { WORDMARK, markInk, markPlan, svgWithMetadata, tagFile } from '../../../lib/mark.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const value=(flag,fallback)=>{const i=args.indexOf(flag);return i>=0?args[i+1]:fallback;};
const input=value('--input',args.find((x)=>!x.startsWith('--')));
const output=path.resolve(value('--out',path.join(process.cwd(),'diagram-exports')));
const all=args.includes('--all-scales');
const office=args.includes('--office-safe');
const registry=args.includes('--registry');
const allowFontFallback=args.includes('--allow-font-fallback');
const selected=Number(value('--scale','3'));
if(!input||(!all&&![1,2,3].includes(selected))){console.error('Usage: node scripts/export.mjs --input <file.html|file.svg> [--out DIR] [--scale 1|2|3|--all-scales] [--office-safe] [--registry] [--allow-font-fallback]');process.exit(2);}
if(path.basename(input)==='index.html'){console.error('EXPORT_SOURCE_REJECTED gallery pages are not diagram sources');process.exit(2);}
const resolved=path.resolve(input);
if(!fs.existsSync(resolved)){console.error('INPUT_MISSING '+resolved);process.exit(2);}
const renderer=probeRenderer();
if(!renderer.ok){console.error((renderer.agentBrowser.ok?'CHROME_REQUIRED ':'RENDERER_REQUIRED ')+(renderer.agentBrowser.ok?renderer.chrome.detail:renderer.agentBrowser.detail)+'\nThis exporter never installs software. Run these steps yourself, then retry:\n  '+renderer.setup.join('\n  '));process.exit(2);}
let source=fs.readFileSync(resolved,'utf8');
const svgMatch=source.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/i);
if(!svgMatch){console.error('SVG_MISSING '+resolved);process.exit(2);}
const svg=svgMatch[0];
let registryData=null;
if(registry){try{registryData=buildBlockRegistry(svg,resolved);}catch(e){console.error('REGISTRY_FAILED '+e.message);process.exit(2);}}
const view=svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
if(!view||view.length!==4||view.some((x)=>!Number.isFinite(x))){console.error('VIEWBOX_REQUIRED '+resolved);process.exit(2);}
let officeSvg=null;
if(office){
  const font=path.join(root,'assets/fonts/PretendardVariable.woff2');
  if(!fs.existsSync(font)){console.error('FONT_MISSING '+font);process.exit(2);}
  const normalizedOfficeSource=decodeXmlCharacterReferences(svg);
  if(normalizedOfficeSource===null){console.error('OFFICE_UNSAFE_ACTIVE_OR_EXTERNAL_CONTENT');process.exit(2);}
  officeSvg=svg.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  if(/<foreignObject\b|\bon[a-z]+\s*=|<script\b/i.test(normalizedOfficeSource)||!officeHrefRefsAreSafe(normalizedOfficeSource)){console.error('OFFICE_UNSAFE_ACTIVE_OR_EXTERNAL_CONTENT');process.exit(2);}
  if(/\bvar\s*\(|@import/i.test(normalizedOfficeSource)||!officeCssUrlsAreSafe(normalizedOfficeSource)){console.error('OFFICE_UNSUPPORTED_CSS_URL_OR_VARIABLE');process.exit(2);}
  officeSvg=officeSvg.replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/gi,'');
  officeSvg=officeSvg.replace(/\s+(?:filter|mask)\s*=\s*(["'])url\(#.*?\)\1/gi,'');
  officeSvg=officeSvg.replace(/<(rect|circle|ellipse|line|path|polygon|polyline|text)\b([^>]*)>/gi,(tag,name,attributes)=>{
    let extra='';
    const converted=attributes.replace(/(\b(?:fill|stroke)\s*=\s*)(["'])(.*?)\2/gi,(whole,prefix,quote,value)=>{
      if(value.toLowerCase()==='transparent')return prefix+quote+'none'+quote;
      const rgba=value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
      if(!rgba)return whole;
      const channels=rgba.slice(1,4).map((n)=>Math.max(0,Math.min(255,Number(n))).toString(16).padStart(2,'0'));
      const alpha=rgba[4]===undefined?1:Math.max(0,Math.min(1,Number(rgba[4])));
      if(alpha<1)extra+=' '+prefix.trim().split('=')[0]+'-opacity="'+alpha+'"';
      return prefix+quote+'#'+channels.join('')+quote;
    });
    return '<'+name+converted+extra+'>';
  });
  const rootOpen=officeSvg.match(/<svg\b[^>]*>/i)?.[0];
  if(!rootOpen){console.error('OFFICE_SVG_ROOT_MISSING');process.exit(2);}
  let nextRoot=rootOpen;
  if(!/\bxmlns\s*=/.test(nextRoot))nextRoot=nextRoot.replace(/<svg\b/,'<svg xmlns="http://www.w3.org/2000/svg"');
  if(!/\bwidth\s*=/.test(nextRoot))nextRoot=nextRoot.replace(/>$/,' width="'+view[2]+'" height="'+view[3]+'">');
  officeSvg=officeSvg.replace(rootOpen,nextRoot);
  const fontData=fs.readFileSync(font).toString('base64');
  const style='<style>@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,'+fontData+') format("woff2");font-weight:100 900}text{font-family:Pretendard,Arial,sans-serif}</style>';
  officeSvg=officeSvg.replace(/(<svg\b[^>]*>)/i,'$1'+style);
}
function run(commandArgs, env={}) {
  const r=runAgentBrowser(commandArgs,{env:{...process.env,AGENT_BROWSER_ALLOW_FILE_ACCESS:'true',...env},maxBuffer:2*1024*1024});
  if(r.status!==0) throw new Error((r.stderr||r.stdout||'agent-browser failed').trim());
  return (r.stdout||'').trim();
}
fs.mkdirSync(output,{recursive:true});
// The visible LitClaude mark (mark setting `on`): added by the exporter, never by the diagram source, at the clear
// spot nearest the bottom-right corner that no drawn element's box touches, in the ground's own ink.
const mark=markPlan().visible;
const markScript='(()=>{const s=document.querySelector("svg"),vb=s.viewBox.baseVal,short=Math.min(vb.width,vb.height),fs='+'Math.max('+WORDMARK.minPx+','+WORDMARK.cornerShare+'*short),inset=Math.max(12,'+WORDMARK.insetShare+'*short),pad=0.6*fs;'
  +'const r=s.getBoundingClientRect(),k=vb.width/r.width,boxes=[];let ground=null,groundArea=0;'
  +'for(const e of s.querySelectorAll("rect,circle,ellipse,line,path,polygon,polyline,text,image,use,foreignObject")){if(e.closest("defs,clipPath,mask,marker,pattern,symbol"))continue;const b=e.getBoundingClientRect();if(!b.width&&!b.height)continue;const x=vb.x+(b.left-r.left)*k,y=vb.y+(b.top-r.top)*k,w=b.width*k,h=b.height*k;'
  +'if(e.tagName==="rect"&&w*h>=0.9*vb.width*vb.height){if(w*h>groundArea){groundArea=w*h;ground=getComputedStyle(e).fill;}continue;}boxes.push([x,y,x+w,y+h]);}'
  +'const rgb=(c)=>{const m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c||"");return m?[+m[1],+m[2],+m[3]]:null;};'
  +'const g=rgb(ground)||rgb(getComputedStyle(document.body).backgroundColor)||[255,255,255];'
  +'const t=document.createElementNS("http://www.w3.org/2000/svg","text");t.textContent='+JSON.stringify(WORDMARK.text)+';t.setAttribute("data-litclaude-mark","1");t.setAttribute("font-family","Pretendard, Arial, sans-serif");t.setAttribute("font-weight","'+WORDMARK.weight+'");t.setAttribute("font-size",fs.toFixed(2));t.setAttribute("letter-spacing",('+WORDMARK.tracking+'*fs).toFixed(3));t.setAttribute("text-anchor","end");t.setAttribute("fill-opacity","'+WORDMARK.cornerOpacity+'");s.appendChild(t);'
  +'const w=t.getComputedTextLength()+'+WORDMARK.tracking+'*fs*'+WORDMARK.text.length+',h=fs*1.25;let best=null;'
  +'for(let y=vb.y+vb.height-inset;y-h>=vb.y+0.72*vb.height;y-=fs/3){for(let x=vb.x+vb.width-inset;x-w>=vb.x+inset;x-=fs/2){const box=[x-w-pad,y-h-pad,x+pad,y+pad];if(boxes.some((b)=>b[0]<box[2]&&b[2]>box[0]&&b[1]<box[3]&&b[3]>box[1]))continue;const d=Math.hypot(vb.x+vb.width-inset-x,(vb.y+vb.height-inset-y)*2);if(!best||d<best.d)best={x,y,d};}}'
  +'if(!best){t.remove();return JSON.stringify({placed:false});}'
  +'t.setAttribute("x",best.x.toFixed(2));t.setAttribute("y",(best.y-0.22*fs).toFixed(2));return JSON.stringify({placed:true,x:+best.x.toFixed(2),y:+(best.y-0.22*fs).toFixed(2),fs:+fs.toFixed(2),ground:g});})()';
let markPlaced=null;
const session='lit-diagram-export-'+process.pid+'-'+Date.now();
const url=resolved.endsWith('.svg')?'file://'+resolved:'file://'+resolved;
let opened=false;
try{
  run(['--session',session,'open',url]);opened=true;
  run(['--session',session,'set','media','light','reduced-motion']);
  if(mark){
    run(['--session',session,'eval','document.fonts.ready.then(()=>true)']);
    const raw=run(['--session',session,'eval',markScript]);
    let parsed;try{const outer=JSON.parse(raw);parsed=typeof outer==='string'?JSON.parse(outer):outer;}catch{throw new Error('MARK_PLACEMENT_INVALID '+raw);}
    if(parsed.placed){
      markPlaced={...parsed,ink:markInk(parsed.ground)};
      run(['--session',session,'eval','document.querySelector("[data-litclaude-mark]").setAttribute("fill","rgb('+markPlaced.ink.join(',')+')")']);
    } else console.log('MARK_SKIPPED no clear spot in the bottom quarter; the export carries the invisible tag only');
  }
  const outputs=[];
  const scales=all?[1,2,3]:[selected];
  for(const scale of scales){
    const width=Math.round(view[2]*scale), height=Math.round(view[3]*scale);
    run(['--session',session,'set','viewport',String(Math.max(width+8,640)),String(Math.max(height+8,480))]);
    run(['--session',session,'eval','document.fonts.ready.then(()=>true)']);
    const script='(async()=>{const s=document.querySelector("svg");if(!s)throw new Error("SVG missing");document.documentElement.style.margin="0";document.body.style.margin="0";document.body.style.padding="0";const main=s.closest("main");if(main){main.style.width="'+width+'px";main.style.maxWidth="none";main.style.margin="0";main.style.padding="0"}s.style.width="'+width+'px";s.style.height="'+height+'px";s.style.maxWidth="none";s.style.display="block";await document.fonts.ready;const t=s.querySelector("text"),family=t?getComputedStyle(t).fontFamily:"",size=t?getComputedStyle(t).fontSize:"16px",face=[...document.fonts].find(f=>f.family.replace(/[\"\']/g,"").toLowerCase()==="pretendard"),r=s.getBoundingClientRect();const font=Boolean(t&&/Pretendard/i.test(family)&&face?.status==="loaded"&&document.fonts.check(size+" Pretendard"));return JSON.stringify({width:r.width,height:r.height,x:r.x,y:r.y,viewportWidth:innerWidth,viewportHeight:innerHeight,font,family,fontFaceStatus:face?.status||"missing"})})()';
    const dimensions=run(['--session',session,'eval',script]);
    let measurement;
    try{const outer=JSON.parse(dimensions);measurement=typeof outer==='string'?JSON.parse(outer):outer;}catch{throw new Error('FONT_PROOF_INVALID '+dimensions);}
    if(Math.abs(measurement.width-width)>0.5||Math.abs(measurement.height-height)>0.5)throw new Error('SVG_DIMENSIONS_MISMATCH '+JSON.stringify(measurement));
    if(measurement.x<0||measurement.y<0||measurement.x+measurement.width>measurement.viewportWidth||measurement.y+measurement.height>measurement.viewportHeight)throw new Error('SVG_OUTSIDE_VIEWPORT '+JSON.stringify(measurement));
    if(!measurement.font&&!allowFontFallback)throw new Error('PRETENDARD_NOT_LOADED_OR_COMPUTED '+JSON.stringify(measurement));
    const filename=path.join(output,path.basename(resolved).replace(/\.(?:html|svg)$/i,'')+'-'+scale+'x.png');
    run(['--session',session,'screenshot','svg',filename]);
    if(!fs.existsSync(filename)||fs.statSync(filename).size===0) throw new Error('PNG_WRITE_FAILED '+filename+' '+dimensions);
    tagFile(filename);
    outputs.push({file:filename,bytes:fs.statSync(filename).size,scale,dimensions});
  }
  for(const out of outputs) console.log('PNG '+out.scale+'x '+out.bytes+' bytes '+out.file+' '+out.dimensions);
  if(markPlaced) console.log('MARK '+JSON.stringify({x:markPlaced.x,y:markPlaced.y,fontSize:markPlaced.fs,ink:markPlaced.ink}));
} catch(e) {
  console.error('EXPORT_FAILED '+e.message);
  process.exitCode=1;
} finally {
  if(opened) {
    const close=runAgentBrowser(['--session',session,'close']);
    if(close.status!==0) console.error('BROWSER_CLOSE_WARNING '+(close.stderr||''));
  }
}
if(officeSvg){
  const target=path.join(output,path.basename(resolved).replace(/\.(?:html|svg)$/i,'')+'-office.svg');
  const {generator}=markPlan();
  if(markPlaced){
    const m=markPlaced;
    officeSvg=officeSvg.replace(/<\/svg>\s*$/i,'<text data-litclaude-mark="1" x="'+m.x+'" y="'+m.y+'" font-family="Pretendard, Arial, sans-serif" font-weight="'+WORDMARK.weight+'" font-size="'+m.fs+'" letter-spacing="'+(WORDMARK.tracking*m.fs).toFixed(3)+'" text-anchor="end" fill="#'+m.ink.map((v)=>v.toString(16).padStart(2,'0')).join('')+'" fill-opacity="'+WORDMARK.cornerOpacity+'">'+WORDMARK.text+'</text></svg>');
  }
  fs.writeFileSync(target,'<?xml version="1.0" encoding="UTF-8"?>\n'+(generator?svgWithMetadata(officeSvg,generator):officeSvg));
  console.log('OFFICE_SVG '+fs.statSync(target).size+' bytes '+target+' text=live font=embedded-woff2');
}
if(registry) {
  const target=path.join(output,path.basename(resolved).replace(/\.(?:html|svg)$/i,'')+'.registry.json');
  if(!process.exitCode){fs.writeFileSync(target,JSON.stringify(registryData,null,2)+'\n');console.log('REGISTRY '+registryData.blocks.length+' blocks '+target);}
}
