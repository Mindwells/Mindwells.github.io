/**
 * Validates the GitHub Actions workflows.
 *
 * The deployment is the one part of this project that cannot be exercised
 * locally, so a malformed workflow or a stale action version would only
 * surface at the moment of publishing — the worst possible time to find out.
 * This checks the things that actually break workflows:
 *
 *   - the file parses as YAML (tabs, for instance, are illegal indentation)
 *   - each job has a runner and steps, and each step can actually do something
 *   - the Pages jobs carry the permissions the deploy action requires
 *   - every `uses:` is pinned to a version, not a moving branch
 *   - every `run:` step that references a npm script has that script defined
 *
 *   node tools/check-workflows.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowDir = join(root, '.github', 'workflows');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const problems = [];
const notes = [];

/** Actions that must be pinned to a major version at minimum. */
const UNPINNED = /@(main|master|HEAD)$/;

/** Permissions `actions/deploy-pages` needs to publish. */
const PAGES_PERMISSIONS = ['pages', 'id-token'];

for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
  const path = join(workflowDir, file);
  const raw = readFileSync(path, 'utf8');

  if (/^\s*\t/m.test(raw)) {
    problems.push(`${file}: contains tab indentation, which YAML forbids`);
  }

  let doc;
  try {
    doc = parse(raw);
  } catch (error) {
    problems.push(`${file}: does not parse as YAML — ${error.message.split('\n')[0]}`);
    continue;
  }

  if (!doc || typeof doc !== 'object') {
    problems.push(`${file}: empty or not a mapping`);
    continue;
  }

  if (!doc.on) problems.push(`${file}: missing "on" trigger`);
  if (!doc.jobs || typeof doc.jobs !== 'object') {
    problems.push(`${file}: missing "jobs"`);
    continue;
  }

  const usesDeployPages = raw.includes('actions/deploy-pages');

  for (const [jobName, job] of Object.entries(doc.jobs)) {
    if (!job || typeof job !== 'object') {
      problems.push(`${file}: job "${jobName}" is empty`);
      continue;
    }
    if (!job['runs-on']) problems.push(`${file}: job "${jobName}" has no runs-on`);
    if (!Array.isArray(job.steps) || job.steps.length === 0) {
      problems.push(`${file}: job "${jobName}" has no steps`);
      continue;
    }

    for (const [i, step] of job.steps.entries()) {
      const label = `${file}: job "${jobName}" step ${i + 1}`;
      const hasUses = typeof step.uses === 'string';
      const hasRun = typeof step.run === 'string';
      if (!hasUses && !hasRun) {
        problems.push(`${label} has neither "uses" nor "run": ${JSON.stringify(step)}`);
      }
      if (hasUses) {
        // `uses` must be `owner/repo@ref`. A bare `actions/checkout` with no
        // ref is not a valid step at all.
        if (!step.uses.includes('@')) {
          problems.push(`${label} uses "${step.uses}" with no version — must be owner/repo@ref`);
        } else if (UNPINNED.test(step.uses)) {
          problems.push(`${label} pins "${step.uses}" to a branch, not a version`);
        } else if (!/@v\d/.test(step.uses)) {
          notes.push(`${label} uses "${step.uses}"; a major-version tag is easier to keep current`);
        }

        // Local composite actions are addressed by path and need no version.
        if (step.uses.startsWith('./') && !step.uses.includes('@')) {
          problems.pop();
        }
      }
      if (hasRun) {
        // Any `npm run <script>` in a workflow must exist in package.json.
        for (const match of step.run.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
          const script = match[1];
          if (!pkg.scripts?.[script]) {
            problems.push(`${label} runs "npm run ${script}", which package.json does not define`);
          }
        }
      }
    }
  }

  if (usesDeployPages) {
    const perms = doc.permissions ?? {};
    for (const required of PAGES_PERMISSIONS) {
      if (perms[required] !== 'write') {
        problems.push(`${file}: deploys to Pages but is missing \`permissions: ${required}: write\``);
      }
    }
    if (perms.contents !== 'read') {
      notes.push(`${file}: consider \`permissions: contents: read\` (least privilege)`);
    }
  }
}

// Notes print either way: suppressing them because an unrelated step failed
// hides advice that is still worth having.
for (const note of notes) console.log(`  note: ${note}`);

if (problems.length === 0) {
  console.log('workflows: valid');
  process.exit(0);
}

console.error(`workflows: ${problems.length} problem(s)`);
for (const problem of problems) console.error(`  - ${problem}`);
process.exit(1);
