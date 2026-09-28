import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {it} from 'node:test';
import {canonicalSkillResourceManifest} from '../plugins/litclaude/lib/canonical-skill-resources.mjs';
import {boundedRead, exclusiveWrite} from '../plugins/litclaude/skills/readme-studio/templates/typography/safe-files.mjs';
const skill = fileURLToPath(new URL('../plugins/litclaude/skills/readme-studio/', import.meta.url));

it('README checker proves structure only and rejects unsafe evidence and badge inputs', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'readme-facts-')));
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"real-name"}');
    const base = {claims:[{id:'name',value:'false-name',source:'package.json'}],badges:[]};
    const check = data => {
      writeFileSync(join(root, 'facts.json'), JSON.stringify(data));
      const result = spawnSync(process.execPath,[join(skill,'scripts/validate-readme-facts.mjs'),'--project-root',root,'--facts',join(root,'facts.json')],{encoding:'utf8'});
      return {status:result.status,...JSON.parse(result.stdout)};
    };
    assert.deepEqual(check(base), {status:0,valid:true,validation_scope:'structure-only',factual_accuracy:'not-checked',source_contents_compared:false,badge_truth_checked:false,issues:[]});
    symlinkSync(join(root, 'package.json'), join(root, 'link.json'));
    mkdirSync(join(root,'directory'));
    for (const source of ['../package.json','/etc/passwd','link.json','directory','missing.json','./package.json']) {
      const result=check({...base,claims:[{...base.claims[0],source}]});
      assert.equal(result.status,1,source); assert.equal(result.valid,false);
    }
    assert.equal(check({...base,claims:[...base.claims,...base.claims]}).status,1);
    for (const url of ['javascript:alert(1)','https://user:password@example.com/x','https://example.com/with space','//example.com/x']) {
      assert.equal(check({...base,badges:[{label:'status',url,source:'package.json'}]}).status,1,url);
    }
    assert.equal(check({...base,badges:[{label:'status',url:'https://example.com/status',source:'package.json'}]}).status,0);
  } finally {rmSync(root,{recursive:true,force:true});}
});

it('asset helpers refuse unsafe font inputs, symlink parents and overwrite', () => {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'readme-paths-')));
  try {
    writeFileSync(join(root,'font.bin'),'font');
    symlinkSync(join(root,'font.bin'),join(root,'font-link'));
    symlinkSync(root,join(root,'alias'));
    assert.equal(boundedRead(join(root,'font.bin'),4).toString(),'font');
    assert.throws(()=>boundedRead(join(root,'font.bin'),3),/BOUNDED/);
    assert.throws(()=>boundedRead(join(root,'font-link'),99),/SYMLINK/);
    assert.throws(()=>boundedRead(root,99),/BOUNDED/);
    exclusiveWrite(root,'one.svg','svg');
    assert.throws(()=>exclusiveWrite(root,'one.svg','replacement'),/EEXIST/);
    assert.throws(()=>exclusiveWrite(root,'alias/escape.svg','bad'),/SYMLINK/);
    assert.throws(()=>exclusiveWrite(root,'../escape.svg','bad'),/UNSAFE/);
    assert.equal(readFileSync(join(root,'one.svg'),'utf8'),'svg');
  } finally {rmSync(root,{recursive:true,force:true});}
});

it('assembles a decorated README from repository-backed patterns with a registry fallback', () => {
  const skillBody = readFileSync(join(skill,'SKILL.md'),'utf8');
  const decoration = readFileSync(join(skill,'references/decoration-and-navigation.md'),'utf8');
  const cover = readFileSync(join(skill,'templates/readme-cover-section.md'),'utf8');

  for (const pattern of [
    'emoji section headers', 'centered hero', 'badge/logo row', 'section iconography',
    '<details>', 'contributors', 'star-history', 'showcase', 'feature grid',
    'footer navigation', 'plain-Markdown fallback', 'repository-backed facts',
  ]) assert.ok(decoration.toLowerCase().includes(pattern.toLowerCase()), pattern);
  assert.match(skillBody, /references\/decoration-and-navigation\.md/u);
  assert.match(cover, /align="center"/u);
  assert.match(cover, /<details>/u);
  assert.match(cover, /\|[^\n]*\|[^\n]*\|/u);
  assert.match(cover, /plain[- ]Markdown fallback/iu);
  assert.match(cover, /verified endpoint/iu);
});

it('stages cover depth and a second light layer in both motion sources and still posters', () => {
  const remotion = readFileSync(join(skill,'templates/remotion-cover/src/index.tsx'),'utf8');
  const hyperframes = readFileSync(join(skill,'templates/hyperframes-cover/index.html'),'utf8');
  const delivery = readFileSync(join(skill,'references/render-and-deliver.md'),'utf8');
  const source = JSON.parse(readFileSync(join(skill,'templates/cover-source.json'),'utf8'));

  for (const name of ['depth-far','depth-mid','foreground-plane','rim-light']) {
    assert.ok(remotion.includes(name), `Remotion ${name}`);
    assert.ok(hyperframes.includes(name), `HyperFrames ${name}`);
  }
  assert.match(delivery, /static poster[^\n]*(?:depth|rim)|(?:depth|rim)[^\n]*static poster/iu);
  assert.equal(source.effects.focal_depth?.foreground, 'sharp');
  assert.equal(source.effects.focal_depth?.background, 'staged-blur');
  assert.equal(source.effects.second_light, 'directional-rim');
});

it('keeps the second light visible in open background outside the foreground panel', () => {
  const remotion = readFileSync(join(skill,'templates/remotion-cover/src/index.tsx'),'utf8');
  const hyperframes = readFileSync(join(skill,'templates/hyperframes-cover/index.html'),'utf8');
  const cssRule = (selector) => {
    const start = hyperframes.indexOf(`${selector}{`);
    assert.notEqual(start, -1, `CSS rule ${selector}`);
    return hyperframes.slice(start + selector.length + 1, hyperframes.indexOf('}', start));
  };
  const px = (rule, property) => {
    const match = rule.match(new RegExp(`(?:^|;)${property}:([0-9.]+)px(?:;|$)`));
    assert.ok(match, `${property} pixel value`);
    return Number(match[1]);
  };
  const wideLight = cssRule('.rim-light');
  const wideType = cssRule('.type');
  const peakAlpha = Math.max(...[...wideLight.matchAll(/rgba\(255,242,190,([0-9.]+)\)/gu)].map(([, alpha]) => Number(alpha)));
  const wideLightLeft = px(wideLight, 'left');
  const wideLightRight = wideLightLeft + px(wideLight, 'width');
  const wideTypeRight = px(wideType, 'left') + px(wideType, 'width');

  assert.ok(peakAlpha >= 0.5, `wide light peak alpha ${peakAlpha} is at least 0.5`);
  assert.ok(wideLightLeft >= wideTypeRight + 24, 'wide light stays in the open field beside the panel');
  assert.ok(wideLightRight <= 1600 - 24, 'wide light stays within the canvas edge');
  assert.match(wideLight, /background:radial-gradient\(ellipse/u);
  assert.match(hyperframes, /<div class="rim-light" data-light-zone="open-background"/u);

  const mobileLight = cssRule('#cover[data-layout=mobile] .rim-light');
  const mobileType = cssRule('#cover[data-layout=mobile] .type');
  assert.ok(
    px(mobileLight, 'top') + px(mobileLight, 'height') <= px(mobileType, 'top') - 8,
    'mobile light stays above the panel',
  );
  assert.match(remotion, /className="rim-light" data-light-zone="open-background"/u);
  assert.match(remotion, /left: mobile \? pad \+ 56 : 1060/u);
  assert.match(remotion, /right: mobile \? pad \+ 56 : 80/u);
  assert.match(remotion, /top: mobile \? 20 : 48/u);
  assert.match(remotion, /height: mobile \? 56 : 200/u);
});

it('uses the pixel profile without asking when a brief gives no visual direction', () => {
  const profile = JSON.parse(readFileSync(join(skill,'../frontend-ui-ux/references/default-editorial-pixel.json'),'utf8'));
  const pixel = profile.pixel_art;
  const frontendRoot = fileURLToPath(new URL('../plugins/litclaude/skills/frontend-ui-ux/', import.meta.url));
  const frontendSkill = readFileSync(join(frontendRoot, 'SKILL.md'), 'utf8');
  const frontendInterview = readFileSync(join(frontendRoot, 'references/production-interview.md'), 'utf8');

  assert.equal(pixel.default_when_unspecified, true);
  assert.equal(Object.hasOwn(pixel, 'default_when_delegated'), false);
  assert.equal(pixel.primary_visual_anchor, true);
  assert.match(pixel.description, /when the brief gives no visual direction.*without asking/iu);
  assert.match(frontendSkill, /when a new brief supplies no visual direction, apply `references\/default-editorial-pixel\.json` without asking/iu);
  assert.match(frontendInterview, /no visual direction in the brief, apply the authored default pixel profile without asking/iu);
  assert.ok(pixel.minimum_rendered_cell_size_css_px >= 6);
  assert.match(pixel.rendering, /crisp.*non-smoothed/iu);
});

it('keeps the pixel profile out of the first viewport of work surfaces', () => {
  const frontendRoot = fileURLToPath(new URL('../plugins/litclaude/skills/frontend-ui-ux/', import.meta.url));
  const profile = JSON.parse(readFileSync(join(frontendRoot, 'references/default-editorial-pixel.json'), 'utf8'));
  const frontendSkill = readFileSync(join(frontendRoot, 'SKILL.md'), 'utf8');
  const work = profile.work_surfaces;

  assert.match(work.applies_to, /work in repeatedly[\s\S]*read once/iu);
  assert.match(work.first_viewport, /working content/iu);
  assert.match(work.first_viewport, /no hero/iu);
  assert.match(work.pixel_art, /small accent/iu);
  assert.match(frontendSkill, /work in rather than read once[^.]*`work_surfaces`/iu);
});

it('asks before choosing among named competing visual directions left undecided', () => {
  const frontendRoot = fileURLToPath(new URL('../plugins/litclaude/skills/frontend-ui-ux/', import.meta.url));
  const frontendSkill = readFileSync(join(frontendRoot, 'SKILL.md'), 'utf8');
  const frontendInterview = readFileSync(join(frontendRoot, 'references/production-interview.md'), 'utf8');
  const readmeSkill = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const readmeInterview = readFileSync(join(skill, 'references/production-interview.md'), 'utf8');

  for (const [name, interview] of [
    ['frontend-ui-ux', frontendInterview],
    ['readme-studio', readmeInterview],
  ]) {
    assert.match(interview, /both (?:directions|options) (?:are )?acceptable.{0,180}(?:unresolved|not selected|not a selection)/isu,
      `${name} must keep material choices open when the brief says both are acceptable`);
    assert.match(interview, /(?:own|separate) round.{0,180}(?:higher[- ]impact|higher priority).{0,100}(?:resolved|answered)/isu,
      `${name} must ask about each open axis after higher-impact choices are answered`);
    if (name === 'frontend-ui-ux') {
      assert.match(interview, /do not treat that recommendation as a selection or begin work.{0,120}before the user selects or delegates/isu,
        `${name} must not treat a recommendation as permission to implement an unresolved material choice`);
    } else {
      assert.match(interview, /(?:do not|don't) (?:announce|choose|apply) a default.{0,180}(?:before|until).{0,100}(?:answer|resolved)/isu,
        `${name} must not default or implement an unresolved material choice`);
    }
    assert.match(interview, /default (?:is (?:valid|allowed) )?only.{0,180}(?:delegat|settled|resolv|materially change)/isu,
      `${name} must limit defaults to settled, delegated, or immaterial choices`);
  }

  assert.match(frontendInterview, /brief itself names competing directions.{0,180}different from a brief that gives no visual direction at all/isu,
    'frontend-ui-ux must distinguish explicitly named unresolved alternatives from absent visual direction');
  assert.match(frontendInterview, /recommendation in a concrete alternatives question.{0,180}do not treat that recommendation as a selection/isu,
    'frontend-ui-ux may recommend an alternative while still waiting for the user to choose');
  assert.match(frontendSkill, /when the brief names competing visual directions and leaves them undecided, ask before selecting a direction or implementing it/isu,
    'frontend-ui-ux must ask before acting on explicitly competing visual directions');
  assert.doesNotMatch(readmeSkill, /when the brief already bounds the work, state the default and proceed/u,
    'readme-studio must qualify defaults by the remaining material decisions');
  assert.match(readmeSkill, /default.{0,180}(?:material|resolved|delegat)/isu,
    'readme-studio must limit defaults to resolved, delegated, or immaterial choices');
});

it('routes bounded multi-round interviews from both production skills into installed references', () => {
  const frontendRoot = fileURLToPath(new URL('../plugins/litclaude/skills/frontend-ui-ux/', import.meta.url));
  const frontendSkill = readFileSync(join(frontendRoot, 'SKILL.md'), 'utf8');
  const frontendInterviewPath = join(frontendRoot, 'references/production-interview.md');
  const frontendInterview = readFileSync(frontendInterviewPath, 'utf8');
  const readmeSkill = readFileSync(join(skill, 'SKILL.md'), 'utf8');
  const readmeInterviewPath = join(skill, 'references/production-interview.md');
  const readmeInterview = readFileSync(readmeInterviewPath, 'utf8');

  assert.match(frontendSkill, /references\/production-interview\.md/u);
  assert.match(readmeSkill, /references\/production-interview\.md/u);
  for (const [name, interview] of [
    ['frontend-ui-ux', frontendInterview],
    ['readme-studio', readmeInterview],
  ]) {
    for (const phrase of [
      'no mandatory interview',
      'two plausible answers',
      'scope, architecture, permissions, accessibility, or visual direction',
      'one high-impact question at a time',
      'as many rounds as materially necessary',
      'retain earlier answers across rounds',
      'do not re-ask a resolved question',
      'state the default and proceed',
      'review, plan, and keyword-only requests remain read-only',
    ]) {
      assert.ok(interview.toLowerCase().includes(phrase), `${name} interview is missing: ${phrase}`);
    }
  }

  for (const [relative, absolute] of [
    ['skills/frontend-ui-ux/SKILL.md', join(frontendRoot, 'SKILL.md')],
    ['skills/frontend-ui-ux/references/production-interview.md', frontendInterviewPath],
    ['skills/readme-studio/SKILL.md', join(skill, 'SKILL.md')],
    ['skills/readme-studio/references/production-interview.md', readmeInterviewPath],
  ]) {
    const bytes = readFileSync(absolute);
    const expectedHash = canonicalSkillResourceManifest.get(relative);
    assert.ok(expectedHash, `canonical skill resource manifest is missing ${relative}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, `resource hash is stale: ${relative}`);
  }
});
