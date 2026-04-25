/**
 * Move task rows from the wrong session to the correct session.
 *
 * Background: my earlier migrate-tasks.ts picked the OLDEST session per
 * agent_group_id, but v2 actually routes channel traffic to the session
 * whose thread_id matches the messaging_group.platform_id (no sub-thread).
 * The thread_id=NULL session is an onboarding/initial session that no
 * container actually uses for the live channel — so list_tasks from
 * Amy's container returned 0 rows.
 *
 * Fix: for each (wrong → right) session pair, copy task rows over with
 * fresh sequential seq numbers (even, host-side) and update the row's
 * thread_id to match the target session's thread_id. Then delete the
 * source rows.
 */
import Database from 'better-sqlite3';
import path from 'path';

const PROJECT_ROOT = '/home/luke/nanoclaw';
const SESSIONS_DIR = path.join(PROJECT_ROOT, 'data/v2-sessions');

interface Move {
  agentGroupId: string;
  sourceSessionId: string;
  targetSessionId: string;
  targetThreadId: string;
}

const moves: Move[] = [
  {
    agentGroupId: 'ag-1777100154655-qwhx2v', // discord_main
    sourceSessionId: 'sess-1777100154664-9gk4uv', // thread_id = NULL (wrong)
    targetSessionId: 'sess-1777101628999-4ocwy3', // thread_id = channel (correct)
    targetThreadId: 'discord:1254670756596682803:1487047476719390720',
  },
  {
    agentGroupId: 'ag-1777100246269-ztw4os', // discord_work
    sourceSessionId: 'sess-1777100246279-5uqdsp', // thread_id = NULL (wrong)
    targetSessionId: 'sess-1777101641931-r1dnbh', // thread_id = channel (correct)
    targetThreadId: 'discord:1254670756596682803:1486635575262974154',
  },
];

function inboundDbPath(agentGroupId: string, sessionId: string): string {
  return path.join(SESSIONS_DIR, agentGroupId, sessionId, 'inbound.db');
}

function nextEvenSeq(currentMax: number): number {
  return currentMax % 2 === 0 ? currentMax + 2 : currentMax + 1;
}

function moveOne(move: Move, dryRun: boolean): void {
  const srcPath = inboundDbPath(move.agentGroupId, move.sourceSessionId);
  const tgtPath = inboundDbPath(move.agentGroupId, move.targetSessionId);

  const src = new Database(srcPath, { readonly: dryRun });
  const tgt = new Database(tgtPath);

  try {
    const taskRows = src
      .prepare(
        `SELECT id, kind, timestamp, status, process_after, recurrence, series_id,
                tries, trigger, platform_id, channel_type, thread_id, content
           FROM messages_in
          WHERE kind = 'task'
          ORDER BY seq`,
      )
      .all() as Array<{
      id: string;
      kind: string;
      timestamp: string;
      status: string;
      process_after: string | null;
      recurrence: string | null;
      series_id: string | null;
      tries: number;
      trigger: number;
      platform_id: string | null;
      channel_type: string | null;
      thread_id: string | null;
      content: string;
    }>;

    if (taskRows.length === 0) {
      console.log(`[${move.agentGroupId}] no task rows in source — nothing to do`);
      return;
    }

    const maxRow = tgt
      .prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages_in')
      .get() as { m: number };

    let nextSeq = nextEvenSeq(maxRow.m);

    console.log(`[${move.agentGroupId}] moving ${taskRows.length} task rows`);
    console.log(`  source: ${move.sourceSessionId}`);
    console.log(`  target: ${move.targetSessionId} (max_seq=${maxRow.m}, next_seq=${nextSeq})`);

    if (dryRun) {
      for (const row of taskRows) {
        console.log(
          `  - ${row.id} (${row.status}, recur=${row.recurrence ?? '-'}) → seq=${nextSeq}, thread_id=${move.targetThreadId}`,
        );
        nextSeq += 2;
      }
      return;
    }

    const insert = tgt.prepare(
      `INSERT INTO messages_in (
        id, seq, kind, timestamp, status, process_after, recurrence, series_id,
        tries, trigger, platform_id, channel_type, thread_id, content
      ) VALUES (
        @id, @seq, @kind, @timestamp, @status, @process_after, @recurrence, @series_id,
        @tries, @trigger, @platform_id, @channel_type, @thread_id, @content
      )`,
    );

    const tx = tgt.transaction(() => {
      for (const row of taskRows) {
        insert.run({
          ...row,
          seq: nextSeq,
          thread_id: move.targetThreadId, // align with target session
        });
        console.log(`  → inserted ${row.id} with seq=${nextSeq}`);
        nextSeq += 2;
      }
    });
    tx();

    // Delete from source after successful target inserts.
    const ids = taskRows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const result = src
      .prepare(`DELETE FROM messages_in WHERE kind='task' AND id IN (${placeholders})`)
      .run(...ids);
    console.log(`  ✓ deleted ${result.changes} rows from source`);
  } finally {
    src.close();
    tgt.close();
  }
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '=== DRY RUN ===' : '=== APPLYING ===');
  for (const move of moves) {
    moveOne(move, dryRun);
    console.log('');
  }
  console.log(dryRun ? '=== DRY RUN COMPLETE — no changes ===' : '=== DONE ===');
}

main();
