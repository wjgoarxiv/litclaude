# Bundled skill notice

LitClaude includes five owner-authorized MIT source snapshots. The three canonical workflow-family
closures carry these source identifiers and revisions:

- `autoresearch`: stable source identifier `my-agent-skills/060_autoresearch-skill`; commit
  `58a65afc174cd8c2fa162bb0d1953b0a88e5d419`; tree
  `9102dfeba13a738d23971b69b6b6ad7bf425c923`; included MIT license:
  `vendor/autoresearch/LICENSE`.
- `autoconference`: stable source identifier `my-agent-skills/064_autoconference-skill`; commit
  `58a65afc174cd8c2fa162bb0d1953b0a88e5d419`; tree
  `8e73d89cefd9ca136f9c45a918517cc5e809fd57`; included MIT license:
  `vendor/autoconference/LICENSE`.
- `wikify`: stable source identifier `llm-wikify`; commit
  `dfe8f8bc372c3bc153dd57697f4a36f366a63e74`; tree
  `ca02699317261cf36f9f89e96186728013778da6`; public pinned URL
  `https://github.com/wjgoarxiv/llm-wikify/tree/dfe8f8bc372c3bc153dd57697f4a36f366a63e74`; included MIT license:
  `vendor/llm-wikify/LICENSE`.

The `my-agent-skills/...` values are neutral stable identifiers, not public retrieval URLs.
Anonymous upstream retrieval is not claimed for those owner source closures.
Runtime/release integrity relies on bundled licensed bytes plus local canonical closures, not remote fetch.
The Wikify public URL is a provenance convenience; package integrity remains local.

The two earlier bundled snapshots remain:

- `handoff`: four authored files, preserved byte-for-byte.
- `scientific-visualization`: sixteen Git-tracked authored files, preserved byte-for-byte. Generated Python caches are intentionally excluded. The authorized source includes the CP/SDS MARTINI visualization reference.

The corresponding license texts are under `vendor/licenses/`; immutable source hashes and provenance are under `vendor/provenance/`. The snapshots do not depend on the original `~/skills` checkout at runtime.

## Methodology attribution

Separately from the bundled snapshots above, four external repositories informed LitFamily
methodology without contributing any bytes. Nothing from them is copied, vendored, or fetched at
runtime, so no license text of theirs is redistributed here:

- `vercel-labs/agent-browser` (Apache-2.0), commit `548b159b30eef119ccf6846c8bc807d0eaa3f6f8`
- `Leonxlnx/taste-skill` (MIT), commit `dfb6f9f9e93a39f673b1827c0889cc28326d1800`
- `rebelytics/one-skill-to-rule-them-all` (CC-BY-4.0), commit `281f13466cd3a73e9ebc9d210907748e1941a3dd`
- `AllstarGER/one-skill-to-rule-them-all` (CC-BY-4.0), commit `764d8ebea9c74c669eb8e0e98051300d499efbc9`

`vendor/provenance/methodology-sources.md` records, per source, exactly what shape of approach was
taken and what was deliberately left behind.
