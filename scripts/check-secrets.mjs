// Refuses a commit that appears to contain a secret. Run by .githooks/pre-commit.
// It reads only what is staged, and prints where a match is, never the match itself.
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const RULES = [
  ['private key', /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/],
  ['a filled-in secret setting', /^\+?\s*(?:DATA_MASTER_KEY|BETTER_AUTH_SECRET|AUTH_INTERNAL_SECRET|POSTGRES_PASSWORD)\s*[=:]\s*["']?[A-Za-z0-9+/_-]{16,}/],
  ['mail or database address with a password', /\b(?:smtps?|postgres(?:ql)?):\/\/[^\s:/@]+:(?!finplan_dev\b|\$\{|PASSWORD\b)[^\s@/]{6,}@/],
  ['access token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|xox[abprs]-[A-Za-z0-9-]{20,})\b/],
];

const problems = [];
for (const file of git('diff', '--cached', '--name-only', '--diff-filter=ACM').split('\n').filter(Boolean)) {
  if (/(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(file)) {
    problems.push(`${file}: environment files must not be committed`);
    continue;
  }
  if (file === 'pnpm-lock.yaml') continue;
  const added = git('diff', '--cached', '-U0', '--', file).split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  added.forEach((line, index) => {
    for (const [name, pattern] of RULES) if (pattern.test(line)) problems.push(`${file}: added line ${index + 1} looks like a ${name}`);
  });
}

if (problems.length > 0) {
  console.error('Commit stopped: possible secrets.\n' + problems.map((p) => `  - ${p}`).join('\n'));
  console.error('If this is a false alarm, change the value to an obvious placeholder, or commit with --no-verify.');
  process.exit(1);
}
