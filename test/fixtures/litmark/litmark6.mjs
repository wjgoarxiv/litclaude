// Canonical LIT mark: uppercase, plume flame on the I, slanted, 3D extrude depth 1. Derives all sizes from one bitmap.
const Q = [" ","▗","▖","▄","▝","▐","▞","▟","▘","▚","▌","▙","▀","▜","▛","█"];
const canvas=(w,h)=>Array.from({length:h},()=>Array(w).fill(0));
const rect=(c,x0,y0,w,h,v=1)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)if(c[y]&&x>=0&&x<c[0].length)c[y][x]=v;};
function render(c){const out=[];for(let y=0;y<c.length;y+=2){let row="";for(let x=0;x<c[0].length;x+=2){
  const p=[c[y][x],c[y][x+1],c[y+1]?.[x],c[y+1]?.[x+1]].map(v=>v||0);
  const bits=(p[0]?8:0)|(p[1]?4:0)|(p[2]?2:0)|(p[3]?1:0); let ch=Q[bits];
  if(bits===15&&Math.min(...p)===2)ch="▓"; row+=ch;} out.push(row.replace(/\s+$/,""));} return out;}
// shear: shift row y right by floor((H-1-y)/rowsPerPx)*pxStep  (pxStep 1 = half-char steps, 2 = whole-char steps)
function shear(c,rowsPerPx,pxStep=1){const H=c.length,W=c[0].length,extra=Math.ceil(H/rowsPerPx)*pxStep;const n=canvas(W+extra,H);
  for(let y=0;y<H;y++){const s=Math.floor((H-1-y)/rowsPerPx)*pxStep;for(let x=0;x<W;x++)if(c[y][x])n[y][x+s]=c[y][x];}return n;}
function extrude(c,depth,mask){const H=c.length,W=c[0].length,n=c.map(r=>r.slice());
  for(let k=1;k<=depth;k++){const d=2*k;for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(c[y][x]!==1)continue;if(mask&&!mask(x,y))continue;const yy=y+d,xx=x+d;if(n[yy]&&xx<W&&!n[yy][xx])n[yy][xx]=2;}}return n;}
function LIT(c,ox,oy,s=1){const u=v=>v*s; rect(c,ox,oy,u(4),u(10)); rect(c,ox,oy+u(6),u(10),u(4));
  const ix=ox+u(14); rect(c,ix,oy,u(4),u(10)); const tx=ix+u(8); rect(c,tx,oy,u(12),u(4)); rect(c,tx+u(4),oy+u(4),u(4),u(6)); return {ix,tx,cx:ix+u(2)};}
function plume(c,cx,base,s=1){const u=v=>v*s;const P=[[1,2],[1,2],[2,4],[3,6],[4,8],[4,8],[3,6],[2,4]];const h=P.length;
  P.forEach(([l,w],i)=>rect(c,cx-u(l),base-u(h-i),u(w),u(1)));rect(c,cx-u(1),base-u(h-3),u(2),u(2),0);}
function mark({s=1,rowsPerPx=2,pxStep=1,depth=1}={}){const OY=8*s;const c=canvas(44*s,(OY+10*s+2*depth+2)|0);const g=LIT(c,2*s,OY,s);plume(c,g.cx,OY,s);
  const sh=shear(c,rowsPerPx,pxStep); return render(extrude(sh,depth,(x,y)=>y>=OY));}
const V={};
V["A. canonical — shear 1px per 2 rows (as picked, #5)"]=mark({rowsPerPx:2,pxStep:1});
V["B. canonical — shear 2px per 4 rows (whole-char steps, crisper shadow)"]=mark({rowsPerPx:4,pxStep:2});
V["C. canonical — shear 1px per 3 rows (gentler slant)"]=mark({rowsPerPx:3,pxStep:1});
V["D. BANNER 2× — shear 1px/2rows, depth 2"]=mark({s:2,rowsPerPx:2,pxStep:1,depth:2});
{const r=mark({rowsPerPx:2,pxStep:1}); const names=["","","","","","  claude","  ──────────────","  hermes · codex","  opencode · grok","",""];
 V["E. lockup — canonical mark + product names"]=r.map((row,i)=>row.padEnd(28)+(names[i]||""));}
// micro: letters 6px tall, 2px stems, flame dot, slanted 1px/2rows, depth 1
function micro(flat=false){const c=canvas(26,10); rect(c,0,4,2,6); rect(c,0,8,6,2); rect(c,9,4,2,6); rect(c,9,1,2,1); rect(c,8,2,4,2); rect(c,9,2,2,1,0); rect(c,14,4,8,2); rect(c,17,6,2,4);
  const sh=shear(c,2,1); return render(flat?sh:extrude(sh,1,(x,y)=>y>=4));}
V["F. MICRO slanted 3D (5 rows) — hook / HUD line"]=micro(false).map((r,i)=>r.padEnd(16)+(i===2?"  litclaude · lit-plan":""));
V["G. MICRO slanted flat (5 rows)"]=micro(true).map((r,i)=>r.padEnd(16)+(i===2?"  litclaude · lit-plan":""));
let sheet=""; for(const [k,r] of Object.entries(V)) sheet+=`================= ${k}\n${r.join("\n")}\n\n`;
process.stdout.write(sheet); (await import("node:fs")).writeFileSync("lit-round6-sheet.txt",sheet);
