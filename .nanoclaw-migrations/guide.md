# NanoClaw Migration Guide — lukes-mini fork v1.2.34 → v2.0.13

Generated: 2026-04-25
Base (merge-base): 87c3640
HEAD at generation: b3274c9
Upstream HEAD: 8d85222

Tier: **3 (Complex)** — major v1 → v2 architectural rewrite, 606 commits behind, 53 ahead.

---

## Migration Plan

This is **not** a normal merge. v2 is a ground-up rewrite (entity model, two-DB session split,
channels moved to a sibling branch, providers moved to a sibling branch, agent-runner on Bun).
Almost all of the fork's source-level customizations target code paths that no longer exist in
v2 and must be **dropped**, not migrated.

The migration's actual code-level work is small:

1. Port one file's content (root `CLAUDE.md` install-specific docs) into v2's `CLAUDE.md`.

Everything else valuable is in **data directories** (`groups/`, `data/`, `store/`, `.env`),
which `/migrate-nanoclaw` does not touch — they stay on disk through the worktree swap.

The post-upgrade rebuild work (running `/add-discord`, re-registering Discord groups, recreating
scheduled tasks) lives outside this guide and is tracked separately.

### Order of operations

1. Create backup branch + tag.
2. Worktree on `upstream/main`.
3. **No skill branches to re-merge** — all v1 skills the fork merged (`skill/compact`,
   `skill/discord`) are gone or integrated in v2.
4. Apply the single CLAUDE.md customization (Section: Customizations).
5. `pnpm install` + `pnpm run build` validation.
6. Reset main to the worktree commit.
7. Post-upgrade install: `/add-discord`, re-register groups, recreate tasks.

### Risk areas

- v2's `CLAUDE.md` has a "STOP — DO NOT MERGE" banner at the top. We must **not** use plain
  `git merge upstream/main`. We use `git reset --hard` to the worktree HEAD instead, per the
  skill's 2.8 swap procedure.
- v2 stores `assistantName` in per-group `container.json` rather than relying solely on `.env`
  `ASSISTANT_NAME`. Old groups (`discord_main`, `discord_work`, `main`) lack `container.json`
  files. Either create them post-migration or re-register groups.
- Scheduled tasks live in v1 `store/messages.db` (`scheduled_tasks` table). Schema is
  incompatible with v2. The 8 active tasks are listed in `~/scheduled-tasks-backup.md` and
  must be recreated manually post-migration. **Do not** import them into v2's DB.
- Old `store/messages.db` will not be touched by the migration. After verifying v2 works,
  rename it to `store/v1-archive-<date>.db` for read-only historical lookup.

---

## Applied Skills

**None to re-merge from upstream.** The fork merged `skill/compact` and worked on `skill/discord`;
both were retired upstream:

- `skill/compact` — deleted upstream (`/compact` skill removed from `.claude/skills/add-compact/`).
  v2 has built-in auto-compaction plus the SDK's native `/compact` slash command. Drop entirely.
- `skill/discord` — never an upstream branch (it was an origin-only branch on this fork). v2
  installs Discord via the new `/add-discord` skill, which copies from `upstream/channels` and
  uses the `@chat-adapter/discord` package.

Local `.claude/skills/` content from origin (e.g. `add-emacs`, `add-parallel`, `add-debug`,
`get-qodo-rules`, `qodo-pr-resolver`) is not in this guide. After upgrade, the worktree's
`.claude/skills/` will be the v2 set; if any of those origin-only skills are still wanted,
re-add them as a separate follow-up.

## Skill Interactions

N/A — no skill branches are being re-merged.

## Modifications to Applied Skills

N/A — no skills to re-merge means no modifications to track.

---

## Customizations

### Install-specific documentation in root `CLAUDE.md`

**Intent:** Keep a section in `CLAUDE.md` that documents lukes-mini-specific install details
so a developer (or fresh Claude session) reading the repo understands which assistant name is
configured, where the systemd service lives, which Discord groups are registered, etc.

**Files:** `CLAUDE.md` (root, repo-level — not `groups/*/CLAUDE.md`).

**How to apply:**

Append the following section to the end of v2's `CLAUDE.md` (after the existing v2 content).
Adjust the items marked with `(verify in v2)` after the upgrade build succeeds, since some
v1 mechanisms (mount allowlist) may have changed in v2.

```markdown
## This Install (lukes-mini)

- **Host:** Ubuntu 24.04, Intel J3160, 7.7 GB RAM, RAID1 SSD. SMB file server on `192.168.1.200`
  (LAN) and `100.73.66.125` (Tailscale). See `/home/luke/CLAUDE.md` on the host for system specs.
- **Assistant name:** `Amy` (configured via per-group `container.json` `assistantName`; default
  upstream is `Andy`).
- **Service:** systemd user unit at `~/.config/systemd/user/nanoclaw.service`. The `launchd/`
  dir in the repo is unused on this Linux host. Restart with `systemctl --user restart nanoclaw`.
  Logs at `logs/nanoclaw.log` and `logs/nanoclaw.error.log`.
- **Credentials proxy:** OneCLI at `http://127.0.0.1:10254` (per `.env` `ONECLI_URL`).
- **Mount allowlist (verify in v2):** v1 used `~/.config/nanoclaw/mount-allowlist.json` to permit
  `/home/luke` and `/srv/share`. Confirm whether v2 still uses this path or has changed the
  mechanism — see `src/modules/mount-security/` in v2.

### Registered Discord groups

Two agent groups are wired to Discord. Re-register them after `/add-discord` if not already
restored from `groups/`:

| Discord channel ID | Folder | Display name | Trigger |
|---|---|---|---|
| `1487047476719390720` | `discord_main` | `amy-mini` | `@Amy` |
| `1486635575262974154` | `discord_work` | `amy-work` | `@Amy` |

Both mount `/home/luke` (ro) and `/srv/share` (rw). Per-group memory at
`groups/<folder>/CLAUDE.md`; shared read-only at `groups/global/CLAUDE.md`.
```

The original committed version (commit `29b0d19`) on v1 had two extra subsections that are
**not** carried forward:

- A `requires_trigger` column referencing v1's per-group trigger flag — v2's wiring model is
  different (per `src/modules/permissions/` and `messaging_group_agents.session_mode`), so this
  column is no longer accurate.
- An `Uncommitted local patches` subsection describing the v1 Discord adapter's CDN URL and
  owner-id patches. v2's Discord uses the `@chat-adapter/discord` package and the official
  setup flow already prompts for the owner ID, so the patches are obsolete.

---

## Customizations explicitly NOT migrated

These were in the fork but are intentionally left out, with the reason for each:

| Fork customization | Why dropped |
|---|---|
| Hand-rolled `src/channels/discord.ts` + test (264+777 lines) | v2 ships official `/add-discord` using `@chat-adapter/discord`. Re-implementing on top of v2's `channel-registry` would diverge from upstream again immediately. |
| `src/session-commands.ts` (`/compact` etc.) + test | v2 has built-in compaction (auto + SDK's native `/compact` slash command). The `add-compact` skill was deleted upstream. |
| `is_from_me === true` → `!!is_from_me` refactor | Code paths don't exist in v2 (`src/index.ts`, `src/session-commands.ts` were rewritten). |
| `container/Dockerfile` modifications | v2's Dockerfile uses Bun for the agent-runner, has a different layout. |
| `container/agent-runner/src/index.ts` 143-line custom block | v2's agent-runner is a complete rewrite (`container/agent-runner/src/poll-loop.ts`, `mcp-tools/`, etc.). |
| `package.json` adding `discord.js` dependency | v2 uses `@chat-adapter/discord` instead. |
| Fork-sync GitHub Actions workflow commits | Already removed; sync is now handled per-channel via skills. |
| `repo-tokens/badge.svg` updates | Auto-generated artifact. |
| `package-lock.json` divergence | Will be regenerated during `pnpm install`. v2 prefers pnpm. |

---

## Post-upgrade rebuild (tracked outside this guide)

After the worktree swap completes, the following items must be done manually before the install
is functional. They are not part of `/migrate-nanoclaw`'s scope:

1. **`pnpm install`** at the repo root (v2 uses pnpm + workspaces, not npm).
2. **`pnpm run build`** to rebuild the agent-runner.
3. **Run `/add-discord`** to install the Discord adapter from `upstream/channels`. Provide the
   existing `DISCORD_BOT_TOKEN`. Note: `DISCORD_PUBLIC_KEY` and `DISCORD_APPLICATION_ID` are
   newly required — fetch them from the Discord Developer Portal if not already in `.env`.
4. **Re-register the two Discord agent groups** (`discord_main` → `amy-mini`,
   `discord_work` → `amy-work`) via `/manage-channels`. The `groups/<folder>/` directories
   already exist with all CLAUDE.md, scripts, and customizations preserved.
5. **Set `assistantName: "Amy"`** in each group's `container.json` (created by re-registration
   or written manually).
6. **Recreate scheduled tasks** from `~/scheduled-tasks-backup.md` (8 active tasks) using v2's
   `schedule_task` MCP tool.
7. **Archive the v1 message DB:**
   ```bash
   mv store/messages.db store/v1-archive-2026-04-25.db
   rm -rf data/ipc/ data/sessions/   # v1-only paths; v2 uses data/v2-sessions/
   ```
8. **Live test**: send a `@Amy` message in Discord, verify response, verify scheduled task fires.

---

## Rollback

If the upgrade goes wrong, revert with:

```bash
git reset --hard <backup-tag>
# tag name is shown at the end of the upgrade phase
```

The full data backup is at `~/nanoclaw-backup-2026-04-25.tar.gz` (6.3 MB). To restore data only:

```bash
cd /home/luke
tar -xzf nanoclaw-backup-2026-04-25.tar.gz
```
