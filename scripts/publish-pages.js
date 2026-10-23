import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Publish the built static reviewer while retaining the existing Check-in video.
// This never publishes the local API, wallet, or workspace database.
const publish = process.argv.includes('--publish');
const expectedRemote = /(?:github\.com[:/])a252937166\/ReviveCheck(?:\.git)?$/;
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options }).trim();
if (!expectedRemote.test(git(['remote', 'get-url', 'origin']))) throw new Error('Unexpected publication repository.');
const files = [];
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await collect(path.join(dir, entry.name), target);
    else if (entry.isFile()) files.push(target);
    else throw new Error('Static output must not contain symlinks.');
  }
}
await collect('dist');
if (!files.includes('index.html')) throw new Error('Build the static reviewer first.');
if (!publish) {
  console.log(JSON.stringify({ mode: 'preview', files, note: 'No remote changes. Pass --publish to update the static GitHub Pages branch.' }, null, 2));
} else {
  git(['fetch', 'origin', 'gh-pages']);
  const base = git(['rev-parse', 'refs/remotes/origin/gh-pages']);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'revivecheck-pages-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(temp, 'index') };
  try {
    git(['read-tree', base], { env });
    for (const file of files) {
      const content = await readFile(path.join('dist', file));
      const blob = git(['hash-object', '-w', '--stdin'], { input: content });
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], { env });
    }
    const tree = git(['write-tree'], { env });
    const oldTree = git(['rev-parse', `${base}^{tree}`]);
    if (tree === oldTree) console.log(JSON.stringify({ status: 'unchanged', commit: base }));
    else {
      const commit = git(['commit-tree', tree, '-p', base], { input: 'Publish ReviveCheck reviewer and public acceptance evidence\n' });
      git(['push', 'origin', `${commit}:refs/heads/gh-pages`]);
      console.log(JSON.stringify({ status: 'published', commit, base, url: 'https://a252937166.github.io/ReviveCheck/', files: files.length }));
    }
  } finally { await rm(temp, { recursive: true, force: true }); }
}
