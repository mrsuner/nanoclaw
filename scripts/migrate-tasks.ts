/**
 * One-shot migration: copy v1 scheduled tasks into v2 session inbound.dbs.
 *
 * Source: /home/luke/nanoclaw/store/messages.db (v1 schema)
 * Target: /home/luke/nanoclaw/data/v2-sessions/<agent_group_id>/<session_id>/inbound.db
 *
 * Each v1 row becomes one messages_in row with kind='task'. We compute
 * process_after from the cron expression. context_mode is dropped — all
 * tasks are inserted into the primary session of their agent group, which
 * corresponds to v1's 'group' context mode. If any v1 task was 'isolated'
 * and that distinction matters, user can recreate it via the agent.
 */
import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';
import path from 'path';

const PROJECT_ROOT = '/home/luke/nanoclaw';
const V1_DB = path.join(PROJECT_ROOT, 'store/messages.db');

// Hard-coded mapping from v1 group_folder to v2 (agent_group_id, primary_session_id, platform_id).
const FOLDER_MAP: Record<string, { agentGroupId: string; sessionId: string; platformId: string }> = {
  discord_main: {
    agentGroupId: 'ag-1777100154655-qwhx2v',
    sessionId: 'sess-1777100154664-9gk4uv',
    platformId: 'discord:1254670756596682803:1487047476719390720',
  },
  discord_work: {
    agentGroupId: 'ag-1777100246269-ztw4os',
    sessionId: 'sess-1777100246279-5uqdsp',
    platformId: 'discord:1254670756596682803:1486635575262974154',
  },
};

function inboundDbPath(agentGroupId: string, sessionId: string): string {
  return path.join(PROJECT_ROOT, 'data/v2-sessions', agentGroupId, sessionId, 'inbound.db');
}

function nextEvenSeq(db: Database.Database): number {
  const row = db.prepare('SELECT MAX(seq) AS max_seq FROM messages_in').get() as
    | { max_seq: number | null }
    | undefined;
  const maxSeq = row?.max_seq ?? 0;
  // Even = host. Skip ahead by 2; if maxSeq is even, next even is maxSeq+2.
  // If maxSeq is odd (container wrote), next even is maxSeq+1.
  return maxSeq % 2 === 0 ? maxSeq + 2 : maxSeq + 1;
}

interface V1Task {
  id: string;
  group_folder: string;
  schedule_type: string;
  schedule_value: string;
  prompt: string;
  script: string | null;
  context_mode: string | null;
}

function processAfterFromCron(cron: string): string {
  // Parse in UTC (v1 stored UTC schedules).
  const interval = CronExpressionParser.parse(cron, { tz: 'UTC' });
  return interval.next().toDate().toISOString();
}

function migrateTask(task: V1Task, dryRun: boolean): void {
  const map = FOLDER_MAP[task.group_folder];
  if (!map) {
    console.error(`[skip] no mapping for folder=${task.group_folder} (task ${task.id})`);
    return;
  }

  const dbPath = inboundDbPath(map.agentGroupId, map.sessionId);
  const processAfter = processAfterFromCron(task.schedule_value);

  const content = JSON.stringify({
    prompt: task.prompt,
    script: task.script,
  });

  const taskId = task.id; // reuse v1 id for traceability

  console.log(
    `[task] ${task.group_folder}/${taskId}\n` +
      `  cron: ${task.schedule_value} (was: ${task.context_mode ?? 'isolated'})\n` +
      `  next: ${processAfter}\n` +
      `  prompt: ${task.prompt.slice(0, 80).replace(/\n/g, ' ')}...`,
  );

  if (dryRun) return;

  const db = new Database(dbPath);
  try {
    const seq = nextEvenSeq(db);
    db.prepare(
      `INSERT INTO messages_in (
        id, seq, kind, timestamp, status, process_after, recurrence,
        series_id, tries, trigger, platform_id, channel_type, thread_id, content
      ) VALUES (
        @id, @seq, 'task', datetime('now'), 'pending', @processAfter, @recurrence,
        @seriesId, 0, 1, @platformId, @channelType, NULL, @content
      )`,
    ).run({
      id: taskId,
      seq,
      processAfter,
      recurrence: task.schedule_value,
      seriesId: taskId,
      platformId: map.platformId,
      channelType: 'discord',
      content,
    });
    console.log(`  → inserted with seq=${seq}`);
  } finally {
    db.close();
  }
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '=== DRY RUN ===' : '=== APPLYING ===');

  const v1 = new Database(V1_DB, { readonly: true });
  const tasks = v1
    .prepare(
      `SELECT id, group_folder, schedule_type, schedule_value, prompt, script, context_mode
       FROM scheduled_tasks
       WHERE status = 'active'
       ORDER BY group_folder, created_at`,
    )
    .all() as V1Task[];
  v1.close();

  console.log(`Found ${tasks.length} active v1 tasks.\n`);

  for (const task of tasks) {
    migrateTask(task, dryRun);
    console.log('');
  }

  console.log(dryRun ? '=== DRY RUN COMPLETE — no changes written ===' : '=== DONE ===');
}

main();
