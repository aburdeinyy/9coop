import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function normalizePickedFolderPath(raw: string): string | null {
  let p = raw.trim().replace(/\r?\n/g, '');
  if (!p) return null;
  // osascript иногда даёт file:///…
  if (p.startsWith('file://')) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//, ''));
    } catch {
      p = p.replace(/^file:\/\//, '');
    }
  }
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || null;
}

export type PickFolderResult = { path: string } | { cancelled: true };

/** Системный диалог выбора папки (через bridge / OS). */
export async function pickFolderDialog(
  prompt = 'Выберите папку репозитория',
): Promise<PickFolderResult> {
  const platform = os.platform();
  try {
    if (platform === 'darwin') {
      const script = `try
  POSIX path of (choose folder with prompt "${prompt.replace(/"/g, '\\"')}")
on error number -128
  ""
end try`;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        encoding: 'utf8',
        timeout: 120_000,
      });
      const normalized = normalizePickedFolderPath(String(stdout));
      if (!normalized) return { cancelled: true };
      return { path: resolveSafeRepoPath(normalized) };
    }

    if (platform === 'linux') {
      try {
        const { stdout } = await execFileAsync(
          'zenity',
          ['--file-selection', '--directory', `--title=${prompt}`],
          { encoding: 'utf8', timeout: 120_000 },
        );
        const normalized = normalizePickedFolderPath(String(stdout));
        if (!normalized) return { cancelled: true };
        return { path: resolveSafeRepoPath(normalized) };
      } catch {
        const { stdout } = await execFileAsync(
          'kdialog',
          ['--getexistingdirectory', os.homedir(), prompt],
          { encoding: 'utf8', timeout: 120_000 },
        );
        const normalized = normalizePickedFolderPath(String(stdout));
        if (!normalized) return { cancelled: true };
        return { path: resolveSafeRepoPath(normalized) };
      }
    }

    if (platform === 'win32') {
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        `$d.Description = '${prompt.replace(/'/g, "''")}'`,
        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }',
      ].join('; ');
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-Command', ps],
        { encoding: 'utf8', timeout: 120_000 },
      );
      const normalized = normalizePickedFolderPath(String(stdout));
      if (!normalized) return { cancelled: true };
      return { path: resolveSafeRepoPath(normalized) };
    }

    throw new Error(`Диалог выбора папки не поддерживается на ${platform}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // cancel на zenity/kdialog часто = exit code ≠ 0 и пустой stdout
    if (/canceled|cancelled|User cancelled|exit code 1/i.test(message)) {
      return { cancelled: true };
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

export type GitStatusFile = { path: string; status: string };
export type GitStatusResult = {
  branch: string;
  files: GitStatusFile[];
  totals: { changed: number };
};

/** Абсолютный существующий каталог → realpath. */
export function resolveSafeRepoPath(input: string): string {
  const raw = input?.trim() ?? '';
  if (!raw) throw new Error('Укажите путь к репозиторию');
  if (!path.isAbsolute(raw)) throw new Error('Путь должен быть абсолютным');
  if (!fs.existsSync(raw)) throw new Error(`Путь не существует: ${raw}`);
  const real = fs.realpathSync(raw);
  const st = fs.statSync(real);
  if (!st.isDirectory()) throw new Error('Путь должен быть директорией');
  return real;
}

/** file относительно repo; запрет выхода за корень. */
export function resolveSafeFileInRepo(repoRoot: string, file: string): string {
  const rel = (file ?? '').trim().replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.includes('\0')) {
    throw new Error('Некорректный путь файла');
  }
  const abs = path.resolve(repoRoot, rel);
  const root = repoRoot.endsWith(path.sep) ? repoRoot : repoRoot + path.sep;
  if (abs !== repoRoot && !abs.startsWith(root)) {
    throw new Error('Файл вне репозитория');
  }
  return abs;
}

function shortStatus(xy: string): string {
  const x = xy[0] ?? ' ';
  const y = xy[1] ?? ' ';
  if (x === '?' || y === '?') return '?';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || y === 'A') return 'A';
  if (x === 'M' || y === 'M') return 'M';
  if (x === 'R' || y === 'R') return 'R';
  if (x === 'C' || y === 'C') return 'C';
  if (x === 'U' || y === 'U') return 'U';
  const t = (x + y).replace(/ /g, '');
  return t.slice(0, 1) || 'M';
}

/** Парсинг `git status --porcelain=v1 -b`. */
export function parseGitStatusPorcelain(stdout: string): GitStatusResult {
  const lines = stdout.split(/\r?\n/).filter((l) => l.length > 0);
  let branch = '';
  const files: GitStatusFile[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const rest = line.slice(3);
      const name = rest.split('...')[0]?.trim() ?? rest.trim();
      branch = name.replace(/^no branch\b.*/i, 'DETACHED').trim() || name;
      continue;
    }
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let filePath = line.slice(3);
    const arrow = filePath.indexOf(' -> ');
    if (arrow >= 0) filePath = filePath.slice(arrow + 4);
    filePath = filePath.trim();
    if (!filePath) continue;
    files.push({ path: filePath, status: shortStatus(xy) });
  }

  return { branch, files, totals: { changed: files.length } };
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { stdout: String(stdout), code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      stdout: typeof e.stdout === 'string' ? e.stdout : '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export async function gitStatus(repoPath: string): Promise<GitStatusResult> {
  const root = resolveSafeRepoPath(repoPath);
  const gitDir = path.join(root, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error('Каталог не является git-репозиторием (.git не найден)');
  }
  const { stdout, code } = await runGit(root, ['status', '--porcelain=v1', '-b']);
  if (!stdout.includes('##') && code !== 0) {
    throw new Error('git status failed');
  }
  return parseGitStatusPorcelain(stdout);
}

export async function gitDiff(
  repoPath: string,
  file: string,
): Promise<{ file: string; patch: string }> {
  const root = resolveSafeRepoPath(repoPath);
  const rel = file.trim().replace(/\\/g, '/');
  resolveSafeFileInRepo(root, rel);

  const untracked = await runGit(root, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    rel,
  ]);
  const isUntracked = untracked.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .includes(rel);

  if (isUntracked) {
    const { stdout } = await runGit(root, ['diff', '--no-index', '--', '/dev/null', rel]);
    return { file: rel, patch: stdout || `(untracked) ${rel}\n` };
  }

  const work = await runGit(root, ['diff', 'HEAD', '--', rel]);
  if (work.stdout.trim()) return { file: rel, patch: work.stdout };

  const staged = await runGit(root, ['diff', '--cached', 'HEAD', '--', rel]);
  return { file: rel, patch: staged.stdout || `(no diff for ${rel})\n` };
}
