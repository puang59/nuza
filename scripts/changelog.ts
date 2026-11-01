/**
 * Writes CHANGELOG.md: every release, newest first, with the pull requests
 * that went into it and who wrote them. A pull request belongs to the first
 * release tag whose history holds its merge commit; what is merged and not
 * yet tagged is Unreleased. The first releases were made from commits
 * pushed straight to the branch; those are listed by commit instead.
 *
 *   bun run changelog
 *
 * Needs `gh` signed in, and the tags fetched (`git fetch --tags`).
 */
import { writeFileSync } from "node:fs";

const REPO = "puang59/nuza";

interface PullRequest {
  number: number;
  title: string;
  author: { login: string } | null;
  mergeCommit: { oid: string } | null;
}

function run(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed`);
  return result.stdout.toString();
}

const pulls: PullRequest[] = JSON.parse(
  run([
    "gh",
    "pr",
    "list",
    "--repo",
    REPO,
    "--state",
    "merged",
    "--limit",
    "1000",
    "--json",
    "number,title,author,mergeCommit",
  ])
);

/** Release tags oldest first, each with the day it was made. */
const tags = run([
  "git",
  "tag",
  "--list",
  "app-v*",
  "--sort=creatordate",
  "--format=%(refname:short) %(creatordate:short)",
])
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [tag, date] = line.split(" ");
    return { tag, date, version: tag.replace(/^app-v/, "") };
  });

const releaseOf = new Map<number, string>();
for (const { tag } of tags) {
  const history = new Set(run(["git", "rev-list", tag]).split("\n"));
  for (const pull of pulls) {
    if (!releaseOf.has(pull.number) && pull.mergeCommit && history.has(pull.mergeCommit.oid)) {
      releaseOf.set(pull.number, tag);
    }
  }
}

const SECTIONS = ["Features", "Improvements", "Bug fixes", "Maintenance"] as const;

/** The section a title's conventional prefix puts it in, and the title without the prefix. */
function sort(title: string): { section: (typeof SECTIONS)[number]; text: string } {
  const match = /^([a-zA-Z]+)(?:\(([^)]*)\))?!?:\s*(.*)$/.exec(title);
  const kind = match?.[1].toLowerCase();
  // A scope stays, as what the change is about: "Scrollbars: draw them ...".
  const scope = match?.[2] ? `${match[2].charAt(0).toUpperCase()}${match[2].slice(1)}: ` : "";
  const text = match ? scope + match[3] : title;
  const section =
    kind === "feat"
      ? "Features"
      : kind === "fix"
        ? "Bug fixes"
        : kind === "chore" || kind === "test" || kind === "ci" || kind === "docs" || kind === "build"
          ? "Maintenance"
          : "Improvements";
  return { section, text: text.charAt(0).toUpperCase() + text.slice(1) };
}

/** A version bump says nothing a reader needs; the heading already says it. */
const isBump = (title: string) => /^chore(\([^)]*\))?:\s*(bump\s+)?version\b/i.test(title);

function entry(pull: PullRequest, text: string): string {
  const login = pull.author?.login ?? "ghost";
  return `- ${text} ([#${pull.number}](https://github.com/${REPO}/pull/${pull.number}) by [@${login}](https://github.com/${login}))`;
}

/** GitHub logins by commit email, so each is looked up once. */
const logins = new Map<string, string>();

/** The commits of a release that had no pull requests, oldest first. */
function commitEntries(from: string | null, to: string): { title: string; line: string }[] {
  const range = from ? `${from}..${to}` : to;
  return run(["git", "log", "--no-merges", "--reverse", "--format=%H%x09%ae%x09%s", range])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, email, title] = line.split("\t");
      if (!logins.has(email)) {
        logins.set(
          email,
          run(["gh", "api", `repos/${REPO}/commits/${sha}`, "--jq", '.author.login // ""']).trim()
        );
      }
      const login = logins.get(email);
      const by = login ? ` by [@${login}](https://github.com/${login})` : "";
      return {
        title,
        line: `- ${sort(title).text} ([${sha.slice(0, 7)}](https://github.com/${REPO}/commit/${sha})${by})`,
      };
    });
}

function block(
  heading: string,
  members: PullRequest[],
  fallback: () => { title: string; line: string }[] = () => []
): string {
  const grouped = new Map<string, string[]>();
  const add = (title: string, line: string) => {
    if (isBump(title)) return;
    const { section } = sort(title);
    grouped.set(section, [...(grouped.get(section) ?? []), line]);
  };
  for (const pull of [...members].sort((a, b) => a.number - b.number))
    add(pull.title, entry(pull, sort(pull.title).text));
  if (members.length === 0) for (const { title, line } of fallback()) add(title, line);
  const parts = [heading];
  for (const section of SECTIONS) {
    const lines = grouped.get(section);
    if (lines) parts.push(`### ${section}\n\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}

const blocks: string[] = [];
const unreleased = pulls.filter((pull) => !releaseOf.has(pull.number) && pull.mergeCommit);
tags.forEach(({ tag, date, version }, index) => {
  const members = pulls.filter((pull) => releaseOf.get(pull.number) === tag);
  const link = `[${version}](https://github.com/${REPO}/releases/tag/${tag})`;
  const previous = index > 0 ? tags[index - 1].tag : null;
  blocks.unshift(block(`## ${link} - ${date}`, members, () => commitEntries(previous, tag)));
});
if (unreleased.length) blocks.unshift(block("## Unreleased", unreleased));

writeFileSync(
  "CHANGELOG.md",
  `# Changelog\n\nEvery release of nuza and the pull requests that went into it. Generated by \`bun run changelog\`.\n\n${blocks.join("\n\n")}\n`
);
console.log(`CHANGELOG.md: ${tags.length} releases, ${pulls.length} pull requests`);
