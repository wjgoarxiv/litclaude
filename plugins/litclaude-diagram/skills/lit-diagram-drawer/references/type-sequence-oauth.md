# OAuth refresh sequence

**Catalog ID:** `sequence-oauth`  
**Parent grammar:** [Sequence](type-sequence.md)

## Purpose and selection

Choose this focused sequence variant when a client makes a bearer-authenticated resource request and the important story is the invalid-token response, refresh, and retry. It keeps the normal request/response chronology while making the token-valid and refresh branch legible. Use the general sequence guide for other protocols, or a state machine when the subject's legal states matter more than messages between actors.

This drawing documents an exchange; it is not an OAuth threat model, a complete authorization-code grant, or proof that an implementation follows a security profile. Link a separate security review when those claims matter.

## Content schema

Prepare a small ordered record before drawing:

- **Participants:** stable id, display name, role, and optional short system qualifier. Usual roles are client, resource API, and authorization service.
- **Messages:** order, sender, receiver, kind (`call`, `return`, or `async`), short protocol label, and optional outcome/status. Include the bearer request, resource result, token refresh exchange, and one retry only where the brief requires it.
- **Branch:** one `alt` fragment with two guards: the valid-token success region and the expired/invalid-token region. Record the condition and resulting message in each region.
- **Security note:** identify whether credentials are illustrative or redacted. Never place a real access token, refresh token, client secret, or personal data in visible text, metadata, examples, or screenshot filenames.

Keep message labels to method/path, status, and a short payload noun. Put detailed claims in a caption or companion prose, not on every arrow.

## Deterministic layout recipe

1. Place participants left-to-right by first interaction; keep the client at left, resource API in the middle, and authorization service at right when those are the actors. Draw participant boxes once and dashed lifelines straight down.
2. Allocate one vertical slot per message in chronological order. Reserve enough height for the `alt` tab, guard labels, divider, and both branch messages before placing arrows. Align each message to the 4 px layout grid and keep at least 24 px between message baselines.
3. Put the bearer request and its first response above the branch. Frame only the lifelines that participate. Inside `alt`, put `[token valid]` in the first region and an explicit expired/invalid-token guard in the second; separate the regions with a dashed rule. Leave at least 16 px between the divider and nearby messages.
4. In the failure region, show the unauthorized return, the refresh call and response, then one resource retry and its return. Use the auth participant for the refresh exchange. Keep the activation bar open only while that participant processes the exchange.
5. Put any audit/event notification after the user-facing result. Draw it as a dashed line with an open head; returns are dashed with filled heads, and synchronous calls use solid filled heads.
6. Route labels into clear space without moving message y-values to conceal crowding. If the 5-lifeline, 12-message, 1-fragment, or 2-region budget is exceeded, split the refresh detail into a second figure.

## Visual encoding

Use the parent sequence grammar for line types, activation bars, branch frames, and arrowheads. Keep request calls solid, synchronous responses dashed with filled heads, and one-way events dashed with open heads. Use the accent for at most one headline success message; the success and error branches must remain distinguishable from their guard text and status labels without color. Operator tags (`ALT`, `OPT`, `LOOP`) use the mono role.

The refresh token itself is never visualized. Show only the protocol action, such as `POST /token · refresh`, and the resulting status. Do not imply that refresh always succeeds: if failure handling is in scope, add a clearly bounded second figure or use a complete branch with a labeled failure result.

## Korean text

Use Pretendard for participant names and Hangul phrases; use the bundled mono role for method names, paths, statuses, guards, and identifiers. Break long labels at phrase boundaries and keep `GET /resource`, status codes, and token-related protocol terms intact. Keep guard wording short enough to remain inside the frame. Follow [Korean typography](korean-typography.md) for mixed Hangul/Latin spacing, baseline, and number treatment.

## Light, dark, and full variants

All three variants preserve the participant order, message order, branch guards, and geometry. Light and dark swap semantic surface and ink tokens only. In the full editorial variant, add a concise title, one explanatory caption, and a legend for call/return/async/fragment if needed; the frame must not add extra branches or suggest a security guarantee. Maintain arrowhead contrast in both skins.

## Accessibility

Provide an SVG title and a description that narrates the happy path, the invalid-token branch, and the retry outcome in order. Use visible guard and status labels as redundant cues for line style. Keep text outside lifelines where possible, maintain readable label contrast, and ensure open versus filled arrowheads remain visually distinct at export size. Do not rely on accent color to identify success or failure.

## Verifier gates

Run `scripts/verify-diagram.mjs` for bounds, overlap, clipping, contrast, skin polarity, visible text, and accessibility checks. Run `scripts/verify-type.mjs --type=sequence-oauth` for the two-region refresh contract and message/arrow semantics. Review the rendered light, dark, and full captures at the intended slide size; a green structural check does not confirm that guard labels are readable.

## Anti-patterns

- Showing real credentials or a token value.
- Omitting the invalid-token status before refresh, or drawing refresh as a user-facing resource response.
- Combining both outcomes into an unlabeled arrow cluster.
- Drawing returns with solid calls' line grammar or async events with filled heads.
- Adding multiple retries while leaving the retry policy unspecified.
- Treating this focused exchange as a complete OAuth security analysis.
- Moving an arrow to make its label fit or using color alone to distinguish branch outcomes.

## Related references

[Sequence](type-sequence.md) · [Style guide](style-guide.md) · [Output spec](output-spec.md) · [Accessibility](accessibility.md) · [Korean typography](korean-typography.md) · [Verifier guide](verifier-guide.md) · [Office export](office-pptx-docx.md) · [Export](export.md)
