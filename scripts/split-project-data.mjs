import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = path.resolve(import.meta.dirname, '..');
const rootSourceData = path.join(root, '.data');
const sourceData = fs.existsSync(rootSourceData)
  ? rootSourceData
  : path.join(root, '.migration-backup', 'legacy-tree', '.data');
const sourceDbPath = path.join(sourceData, 'app.db');

async function createSnapshot(projectName, mode) {
  const targetData = path.join(root, projectName, '.data');
  fs.rmSync(targetData, { recursive: true, force: true });
  fs.mkdirSync(targetData, { recursive: true });

  const source = new Database(sourceDbPath, { readonly: true });
  const targetDbPath = path.join(targetData, 'app.db');
  await source.backup(targetDbPath);
  source.close();

  const db = new Database(targetDbPath);
  db.pragma('foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    if (mode === 'jobseeker') {
      db.exec(`
        CREATE TEMP TABLE removed_resume_ids AS SELECT DISTINCT resume_id AS id FROM candidates;
        CREATE TEMP TABLE removed_company_ids AS SELECT id FROM companies WHERE kind = 'position';
        DELETE FROM tasks
          WHERE mode = 'collect'
             OR resume_id IN (SELECT id FROM removed_resume_ids)
             OR company_id IN (SELECT id FROM removed_company_ids);
        DELETE FROM resumes WHERE id IN (SELECT id FROM removed_resume_ids);
        DELETE FROM candidates;
        DELETE FROM companies WHERE id IN (SELECT id FROM removed_company_ids);
      `);
    } else {
      db.exec(`
        CREATE TEMP TABLE kept_resume_ids AS SELECT DISTINCT resume_id AS id FROM candidates;
        CREATE TEMP TABLE kept_company_ids AS SELECT id FROM companies WHERE kind = 'position';
        DELETE FROM tasks
          WHERE mode != 'collect'
            AND NOT (
              resume_id IN (SELECT id FROM kept_resume_ids)
              AND company_id IN (SELECT id FROM kept_company_ids)
            );
        DELETE FROM resumes WHERE id NOT IN (SELECT id FROM kept_resume_ids);
        DELETE FROM companies WHERE id NOT IN (SELECT id FROM kept_company_ids);
      `);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const taskIds = new Set(db.prepare('SELECT id FROM tasks').all().map((row) => row.id));
  const sourceFiles = new Set([
    ...db.prepare(`SELECT source_file FROM resumes WHERE source_file != ''`).all().map((row) => row.source_file),
    ...db.prepare(`SELECT source_file FROM companies WHERE source_file != ''`).all().map((row) => row.source_file),
  ].map((file) => path.basename(file)));

  copySelectedDirectory('logs', targetData, (name) => taskIds.has(path.parse(name).name));
  copySelectedDirectory('jobs', targetData, (name) => taskIds.has(name));
  copySelectedDirectory('uploads', targetData, (name) => sourceFiles.has(name));

  db.exec('VACUUM');
  const summary = {
    project: projectName,
    agents: db.prepare('SELECT COUNT(*) AS n FROM agents').get().n,
    resumes: db.prepare('SELECT COUNT(*) AS n FROM resumes').get().n,
    companies: db.prepare('SELECT COUNT(*) AS n FROM companies').get().n,
    candidates: db.prepare('SELECT COUNT(*) AS n FROM candidates').get().n,
    tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,
  };
  db.close();
  return summary;
}

function copySelectedDirectory(name, targetData, include) {
  const sourceDir = path.join(sourceData, name);
  const targetDir = path.join(targetData, name);
  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!include(entry.name)) continue;
    fs.cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true });
  }
}

const summaries = [];
summaries.push(await createSnapshot('jobseeker', 'jobseeker'));
summaries.push(await createSnapshot('recruiter', 'recruiter'));
console.log(JSON.stringify(summaries, null, 2));
