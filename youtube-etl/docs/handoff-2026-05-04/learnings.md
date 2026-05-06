# Learnings — mikai YouTube ETL session 2026-05-04

> **The single most important file in this archive.** Read this BEFORE
> writing any code, command, or instruction for Cross. The rules below
> were learned by violating them — each one cost Cross at least one
> debug round, against the project's #1 rule ("Cross 不 debug").

---

## Section 1 — Cross's Golden Rules (non-negotiable)

### 1.1 Cross 不 debug

Cross is COO of mikai (17LIVE subsidiary), **not an engineer, never will be**. Every error he has to forward back to you is a failure on your part to pre-empt it. Predict failure modes before posting commands. Read source code, schema, transforms before writing patches. If you don't have enough info, ask **once, specifically**, then proceed — don't ask 5 clarifying questions.

### 1.2 Single block per operation

Cloud Shell paste merges adjacent code fences. Multi-step commands MUST be one paste-friendly block. Use `for ROLE in A B C; do ...; done` inline, or `&&` chain on single line. **Never** `\` newline (Cloud Shell sometimes eats the newline). **Never** four separate fenced blocks expecting Cross to paste each one.

Gotcha refs: #39, #41.

### 1.3 Full files, not patches

When updating GAS / Python / SQL / config, give the **complete file**. Cross clears the editor and pastes once. Even for one-line changes. Patches cause indent / integration / missing-line errors that Cross has to debug.

Gotcha ref: #51.

### 1.4 Pre-empt bugs, don't react

Before posting a deployment command, mentally run through:
- Does this depend on a service account / API / IAM that may not exist yet?
- Does the URL format / auth / region work in Cross's GCP org context?
- Does the user-pasted output get smushed by Cloud Shell?
- Are there `<placeholders>` in the command that need real values?
- Will an org policy block this (ingress, allowed-domains, etc.)?

The "warning table" pattern works: include a table of "if you see X → it means Y → fix is Z" up front, so Cross self-resolves common issues without round-tripping.

### 1.5 Document failures immediately

The moment a novel bug surfaces — push it to `dev-guide.md` as the next-numbered Gotcha **same session**. Don't batch them up. The compound effect across this session: 25 gotchas (#27-51) prevented future Claude from re-stepping into the same traps.

---

## Section 2 — Workflow Dos

### Engineering

- **Read source before patching.** Read every handler / lib / DDL / requirements.txt for ETL changes. Don't trust filenames — grep for actual usage.
- **Schema parity check.** Before writing any rollup SQL, verify `transforms.py` row dict keys match DDL column names exactly. One typo here = silent NULL or hard error.
- **Idempotent MERGE.** Mart rollup writes use `MERGE ... ON (report_date, primary_key)`. Re-runs are safe. Bootstrap day, retry, backfill all work the same way.
- **Pre-grant IAM bindings.** Before `gcloud run deploy`, grant runner SA `roles/secretmanager.secretAccessor` + `roles/bigquery.dataEditor` + `roles/bigquery.jobUser` + `roles/logging.logWriter`. Plus user `roles/iam.serviceAccountUser` on the SA. Plus cloudbuild SA `roles/cloudbuild.builds.builder`.
- **`--ingress=all` at first deploy.** Don't try `services update --ingress=all` after-the-fact — in enterprise org policies it may be blocked. First deploy gets the easy path.
- **`gcloud run services describe ... status.url`** for the routable URL. Never trust `gcloud run deploy` stdout's printed URL.
- **Wrap each `finally` write in its own try/except.** Especially `quota_log` — must always flush even on partial failure.
- **Per-API-call HttpError catch.** In handler main loops, every `channels.list / playlistItems.list / videos.list` call gets its own `try/except HttpError as e: log.warning; continue`. Don't let one channel's 4xx kill the whole run.
- **Streaming insert chunk size 500.** BQ insertAll caps at 10MB / 50k rows / call.
- **`gcloud services enable` upfront in STEP 1.** Batch-enable everything: secretmanager, run, cloudbuild, scheduler, artifactregistry, iam, bigquery, bigquerydatatransfer.

### Communication

- **Conclusion first.** Cross is COO time. Top of every reply: status (✅/🟡/🔴) + one-sentence delta + decision needed.
- **Tables over prose.** Comparison tables, decision tables, status tables. Never long paragraphs.
- **Numbered options for decisions.** Don't ask "what do you think?" — give 3 options with trade-offs, recommend one.
- **Pre-failure-mode warning tables.** "If you see X → it means Y → fix Z." Cross self-resolves.
- **Honest about uncertainty.** When you don't know (e.g., org policy state), say so + propose how to find out.

### Architectural

- **Path C before Path A.** `api_key` mode (Data API only) ships in 1 day, covers ~80% of dashboard. `oauth` mode (Analytics API) requires IT account + 50 talent cooperation — 1-3 week timeline. Don't block on the slower path.
- **mart layer surfaces granularity dashboard needs.** Don't aggregate raw `content_type` away into channel-level KPI — keep a per-video table (`mart_content_daily`) so dashboards can drill down to per-video / per-livestream.
- **BQ Scheduled Query for mart rollup.** Don't build Cloud Run endpoint for a SQL job. Use BQ's native scheduled query — Service Agent path needs `roles/iam.serviceAccountTokenCreator` on runner SA.
- **Bootstrap day handling.** Day 1 of any rollup has no prior snapshot, `view_count_delta` = `view_count` (cumulative, not delta). Either store NULL on bootstrap or filter at dashboard with `report_date > MIN(report_date)`. Cross learned this the hard way looking at "61M views in 1 day".

---

## Section 3 — Workflow Don'ts

### Engineering

- **Don't trust deploy stdout URL.** Always re-fetch via describe.
- **Don't assume `google-cloud-X` PyPI = `from google.cloud import X`.** It's `secretmanager` (no underscore), not `secret_manager`. Verify with `python -c "from google.cloud import X"`.
- **Don't use BQ reserved keywords as aliases.** `rows`, `count`, `table`, `order`. Use `row_count`, `cnt`, etc.
- **Don't use GET `/healthz`** for Cloud Run liveness. Frontend hijacks it. Use POST `/jobs/<some-noop-endpoint>`.
- **Don't aggregate `content_type` away in mart rollup.** Cross needs to distinguish video vs livestream per talent.
- **Don't write retry-for-retry's-sake.** BQ load > BQ streaming insert for >1MB batches.
- **Don't backslash-newline in gcloud commands.** Cloud Shell paste eats it.
- **Don't push `<PLACEHOLDER>` to Cross.** Always replace with real values before pasting.
- **Don't skip `iam service-accounts describe`** before binding IAM. SA may not exist yet.
- **Don't run `gcloud scheduler jobs create`** before `roles/run.invoker` is granted to the scheduler SA.

### Communication

- **Don't ask 5 clarifying questions** before doing any work. Make one assumption, state it, proceed.
- **Don't say "this is a great question!"** Cross hates filler. Every word should add information.
- **Don't apologize over-effusively.** Acknowledge briefly, fix, move on.
- **Don't paste a code block expecting Cross to know which line to edit.** Give the full file every time.
- **Don't write multi-paragraph status updates.** One sentence + decision needed.

### Architectural

- **Don't try to consolidate ownership before the dashboard ships.** Path C first, dashboard live, _then_ Path A.
- **Don't suggest `gcloud run services proxy`** as primary path — only as ingress=internal fallback.
- **Don't trust handoff README assumptions.** The original repo handoff README assumed single OAuth token covers all channels — wrong for talent agency model. Verify against actual ownership before designing.
- **Don't treat mockup data as production validation.** The 4-tab mockup Cross built for YouTube audit was fake data — useful for the audit but not for verifying the pipeline works.

---

## Section 4 — Architectural decisions made (with rationale)

### Path C api_key mode for first deploy

50 talents own channels under different Google accounts. No single OAuth identity covers all. **Decision**: ship `api_key` mode now (covers Data API — subs, views, video metadata, liveStreamingDetails, search.list live). Defer Analytics API (`oauth` mode) until consolidation done. Got 7,599 rows ingesting in 1 day vs 1-3 weeks blocked.

### mart_content_daily as separate table

`mart_talent_daily_kpi` aggregates per channel per day — lost the video-vs-livestream distinction Cross needed. **Decision**: add `mart_content_daily` (per video per day) with `content_type` field. Dashboard tabs `Videos` and `Lives` filter on `content_type`. Storage cost trivial (~110MB / 30 days).

### content_type derivation

```
CASE
  WHEN NOT is_live_broadcast THEN 'video'
  WHEN live_actual_end_time IS NOT NULL THEN 'live_archive'
  WHEN live_actual_start_time IS NOT NULL THEN 'live_active'
  ELSE 'live_scheduled'
END
```

Uses 3 raw fields (`is_live_broadcast`, `live_actual_start_time`, `live_actual_end_time`) to fully classify content. NULL handling: scheduled lives have null start, archived have non-null end.

### BQ Scheduled Query for mart rollup (not Cloud Run)

Mart rollup is pure SQL — no need for a Cloud Run endpoint. **Decision**: register as BQ Scheduled Query, run at 04:00 / 04:15 UTC daily (after raw ETL at 02:00 UTC). Service account: `youtube-etl-runner@...` already has `roles/bigquery.dataEditor`. One-time grant of `roles/iam.serviceAccountTokenCreator` to BQ Data Transfer Service Agent.

### Connected Sheets + Apps Script for dashboard

Cross uses Google Sheets daily. **Decision**: dashboard built via Apps Script + BigQuery Advanced Service. Daily refresh trigger at 13:00 UTC+8 (after mart rollup). 6 tabs: Talent / Manager (with chart) / Top10 / Trend (last 30 days) / Videos / Lives.

### 4 Cloud Scheduler jobs cadence

| Job | Cron (UTC) | Purpose |
|-----|-----------|---------|
| daily | `0 2 * * *` | Full sweep all 50 channels |
| hourly | `5 * * * *` | Update <48h videos |
| live-poll | `*/5 * * * *` | 5-min concurrent viewer polling |
| analytics | `0 3 * * *` | (no-op in api_key mode, ready for oauth flip) |

Quota burn at this cadence: ~385 units/day = 3.85% of 10K default. Plenty of headroom.

---

## Section 5 — Anti-patterns observed (real failures this session)

| Anti-pattern | Manifestation | Lesson |
|--------------|---------------|--------|
| Trust deploy stdout URL | First `curl /healthz` 404 — deploy URL wasn't routable | Always `services describe` |
| Multi-fenced commands | `--condition=Nonegcloud projects ...` — paste smush | Single inline block |
| Skip SA-create before IAM bind | `Service account does not exist` | Verify with `describe` first |
| Patches not full files | GAS "BigQuery is not defined" — missed Service add | Full files, even for 1-line changes |
| Aggregate raw to mart too early | Cross asked "why no live vs video distinction" | Per-content table needed alongside per-channel |
| BQ reserved word as alias | `Unexpected keyword ROWS` | Use `row_count`, `cnt`, etc. |
| Single try in finally | quota_log lost when videos write 413'd | Each finally write in own try/except |
| Single OAuth assumption | handoff README assumed 1 token covers 50 channels | Verify ownership distribution upfront |
| GET `/healthz` for liveness | Google edge 404 even though Flask served it | POST endpoint instead |
| Per-channel HttpError unhandled | 6,798 BQ rows + 500 endpoint = ghost data | Per-call try/except continue |

---

## Section 6 — What worked extraordinarily well (worth replicating)

1. **Pre-flight schema verification** in Phase 2 — reading `bq_writer.py`, `transforms.py`, all DDL files BEFORE writing rollup SQL caught 0 column-name typos. Gotcha #36 in action.

2. **Path C → Path A staging** — shipping 80% (api_key) immediately rather than blocking on 100% (oauth). Cross had a working dashboard in 1 day.

3. **Single bundled diagnostic block** for Cloud Run debugging — 5 echo sections + queries in one paste. Solved the ingress / URL / IAM trifecta in one round.

4. **`buildContentTabs` separate function** — cleaner than monolithic buildDashboard. Easier to test and extend (e.g., adding `Per-Live-Detail` tab later).

5. **Documenting gotchas same-session** — #38-51 added to dev-guide.md as they surfaced. Compounding value: future Claude reads these and avoids them.

6. **`notify()` UI-safe wrapper** — standalone Apps Script doesn't have UI context, time-trigger runs don't either. Wrapper falls back to Logger.log gracefully.

7. **`recreateSheet` with edge case** — handles "only one tab in spreadsheet" via clear-then-populate instead of delete-then-insert.

---

## Section 7 — If you remember nothing else

1. **他 不 debug.** All your output should be debugged before he sees it.
2. **Full files. Always.** Never patches.
3. **Single block per Cloud Shell paste.** Use for-loop or && chain inline.
4. **`gcloud run services describe` for URL.** Stdout lies.
5. **`--ingress=all` at first deploy.** Org policy may block updates.
6. **Document gotchas immediately**, push to dev-guide.md same session.
7. **Pre-flight read source code** before any patch. No exceptions.
