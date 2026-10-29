// How a user tells the official LitClaude from a renamed or re-hosted copy: doctor prints the official package
// and repository, and warns when the running copy's package name or repository field differs. Local data only.

export const OFFICIAL_BUILD = Object.freeze({ packageName: "@litfamily/litclaude", repo: "wjgoarxiv/litclaude" });

/** `github.com/<owner>/<name>` from a package.json repository field, or null. */
const repoOf = (repository) => {
  const url = typeof repository === "string" ? repository : repository?.url;
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?(?:[#/].*)?$/u.exec(String(url ?? ""));
  return m ? `${m[1]}/${m[2]}` : null;
};

/** Doctor lines for a package.json: OFFICIAL_BUILD always, OFFICIAL_BUILD_WARNING when name or repo differ. */
export const officialBuildLines = (pkg) => {
  const repo = repoOf(pkg.repository);
  const official = `${OFFICIAL_BUILD.packageName} from github.com/${OFFICIAL_BUILD.repo}`;
  const lines = [`OFFICIAL_BUILD: ${official} (this copy: ${pkg.name} ${pkg.version})`];
  if (pkg.name !== OFFICIAL_BUILD.packageName || repo !== OFFICIAL_BUILD.repo) {
    lines.push(`OFFICIAL_BUILD_WARNING: this copy is ${pkg.name} from ${repo ? `github.com/${repo}` : "an unnamed repository"}; the official build is ${official}. Install it with npx ${OFFICIAL_BUILD.packageName}@latest install`);
  }
  return lines;
};
