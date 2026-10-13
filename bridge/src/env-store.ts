import fs from 'node:fs';
import path from 'node:path';
import {
  ENV_FILE_NAME,
  parseDotEnv,
  serializeDotEnv,
} from '../../src/app/core/utils/dotenv-format';

export function envFilePath(cwd = process.cwd()): string {
  return path.join(cwd, ENV_FILE_NAME);
}

export function readEnvFile(cwd = process.cwd()): Record<string, string> {
  const file = envFilePath(cwd);
  try {
    return parseDotEnv(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function writeEnvFile(vars: Record<string, string>, cwd = process.cwd()): void {
  const file = envFilePath(cwd);
  const previous = readEnvFile(cwd);
  fs.writeFileSync(file, serializeDotEnv(vars), 'utf8');
  // Убираем удалённые ключи из process.env, иначе MCP продолжит видеть старый PAT.
  for (const key of Object.keys(previous)) {
    if (!(key in vars)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

/** Load `.env` into process.env (keys from file always win for that run). */
export function loadEnvIntoProcess(cwd = process.cwd()): Record<string, string> {
  const vars = readEnvFile(cwd);
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
  return vars;
}
