import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const ROOT_DIR = ROOT;
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, '.data');
export const AGENTS_DIR = process.env.AGENTS_DIR
  ? path.resolve(process.env.AGENTS_DIR)
  : path.join(ROOT, 'agents');
export const JOBS_DIR = path.join(DATA_DIR, 'jobs');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const DIST_DIR = path.join(ROOT, 'web', 'dist');

export function taskWorkspace(taskId) {
  return path.join(JOBS_DIR, taskId);
}

export function taskLogPath(taskId) {
  return path.join(LOGS_DIR, `${taskId}.log`);
}
