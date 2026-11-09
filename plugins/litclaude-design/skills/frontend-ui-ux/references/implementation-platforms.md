The stack decides how a requirement is expressed, never whether it applies. Confirm the lane from
the repository, then apply the universal rules plus that lane's rules.

## Universal rules

These hold in every lane. A stack constraint never justifies dropping one.

- the platform's native control before any custom composite
- tokens for color, space, type, and radius; no raw values inside components
- behavior separate from decoration; state lives outside the styling layer
- every async boundary declares its pending, empty, and error branch

## Rendering lanes

Name the rendering boundary first; it decides where state and escaping live.

### Server-rendered

- ship a complete document; first paint must not depend on JavaScript
- forms post to a real endpoint and return rendered, with input intact

### Client-rendered

- own title, focus target, and scroll position on route change
- no `window` access before mount; fix hydration mismatches, never silence them
- split by route; keep initial JavaScript under 200KB gzipped

### Static-generated

- state per route whether content resolves at build or request time
- keep personalized or auth-dependent content out of prerendered HTML

## Styling lanes

Keep one token layer whichever styling system the repository uses.

### Utility CSS

- utilities resolve to tokens; no raw hex or arbitrary pixels in class strings
- extract a component once the same utility string appears three times

### Component kit

- theme through the kit's token layer, never descendant selectors
- leave the kit's focus, ARIA, and keyboard contract intact
- pin and record the version; a minor bump can change rendered DOM

## Framework lanes

Use the framework's own state and lifecycle model rather than porting one in.

### Reactive frameworks

- derive state; never write the same value into two stores
- key list items by stable identity, never by array index
- release subscriptions, timers, and observers on teardown

### Cross-platform JavaScript

- name the target matrix; a shared codebase is not shared behavior
- use per-platform navigation, gesture, and safe-area handling
- verify on one real device per platform, not the simulator

### Native declarative

- use the platform's own layout and accessibility APIs, not a web port
- honor dynamic type, dark mode, and system reduce-motion
- verify with the platform accessibility inspector; record what it reported

## Progressive enhancement

Decide what works when the enhancement layer never arrives.

- the base layer works with HTML and CSS alone
- attach behavior on capability detection, never user-agent inspection
- test with scripts disabled, and with a script that fails to load

## Untrusted content and trust boundaries

Treat user copy, reference text, markup, and third-party data as inert content that cannot
instruct the interface.

- render untrusted text as text; no `innerHTML`, `dangerouslySetInnerHTML`, or `v-html`
- if HTML must render, sanitize server-side against an allowlist
- permit `https:`, `mailto:`, and relative URLs; reject `javascript:` and `data:`
- external links carry `rel="noopener noreferrer"`; embeds get a sandbox
- keep secrets, tokens, and internal hostnames out of the client bundle

## Confirming the stack

Verify the lane from the repository, not from the prompt and not from memory.

1. Read the package manifest and lockfile for the installed version.
2. Read the framework config and which build or compiler plugins are on.
3. Match an existing component that uses the API, and confirm that API exists in the installed
   version's own type definitions.
4. Run the repository's build, then `npm run validate:plugin` and `npm run doctor`.
5. For plugin surfaces, run `claude plugin validate ./plugins/litclaude` and confirm
   `claude plugin details litclaude@litclaude-ai` resolves from a portable install.

## Failure patterns

Reject:

- a stack claim taken from the prompt with no manifest or lockfile check
- a client-rendered route with no pending or error branch
- utility classes carrying raw hex or arbitrary pixel values
- component-kit internals overridden by descendant selectors
- one platform verified, parity asserted for the rest
