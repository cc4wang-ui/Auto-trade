# Repo Split Master Plan

> 作者：Claude（senior staff 顧問身份）
> 對象：Cross（COO，非工程師）
> 目標：把 `cc4wang-ui/Auto-trade` 這個疊床架屋的單 repo，拆成清楚的 3-4 個 service repo
> 狀態：**Phase A 已完成、Phase E 待 Cross 批准後執行**

---

## TL;DR

| 拆出去的內容 | 去哪個 repo | Branch 來源 |
|---|---|---|
| Telegram bot WF1-4（portfolio / 新聞 / 目標價 / 法說）+ GAS endpoints | `cc4wang-ui/telegram-trade-bot`（已建空 repo）| 5 個 telegram-* / busy-meitner / brave-dirac / update-telegram-bot branches |
| YouTube ETL（17LIVE / mikai 工作）| `crosswang-collab/mikai-youtube-etl`（已建空 repo）| 3 個 youtube-etl-* branches |
| Playwright jobcan bot | `crosswang-collab/mikai-jobcan-bot`（rename）| 不在本 repo，在 `cc4wang-ui/playwrightbot` |
| Vtuber division 交接清單 | `crosswang-collab/Kirby-transition-plan`（保留名稱）| 不在本 repo，在 `cc4wang-ui/Kirby-transition-plan` |
| 留下的 = 純 v10 量化交易核心 + macro routine + Pine alert webhook + dashboard | `cc4wang-ui/Auto-trade`（瘦身後）| main + 核心 PR |
| 不動：個人成長 command center | `cc4wang-ui/combatsystem`（不變）| 個人，不在本次切割範圍 |

---

## 為什麼這樣切

**單一原則：service 邊界 = repo 邊界。**

| Repo | 部署目標 | Stakeholder | 部署頻率 |
|---|---|---|---|
| Auto-trade | TradingView Pine + Claude Code Routine + GAS（macro-only） | 個人交易 | 週/月 |
| telegram-trade-bot | GAS Web App 多 endpoint + Telegram bot | 個人交易 | 日（PR queue 多） |
| mikai-youtube-etl | GCP / BigQuery | 17LIVE 同事 | 季度 |
| (假設) mikai-jobcan-bot | （Playwright 排程）| 17LIVE 同事 | 季度 |

把它們塞同一個 repo 的後果（你已經踩到的）：
1. PR queue 混雜 → 一個 review 要切 3 種 context
2. 部署 secrets 混在同一個 GitHub Settings → 工作 secrets 漏到個人帳號
3. CLAUDE.md 變成 600 行雜燴 → Claude 讀完已經吃 5K context
4. README / docs 互相矛盾（trading repo 卻有 mikai BigQuery 部署文件）

---

## Phase 表

| Phase | 內容 | 狀態 | 做的人 |
|---|---|---|---|
| A | 內部 reorg（root → context/ docs/ automation/ pine/ scripts/）| ✅ 已完成 commit `3257bca` | Claude（this session） |
| B | PR triage（9 open PRs） | 進行中 | Claude（this session） |
| C | 寫本文件 | ✅ 進行中 | Claude（this session） |
| D | Hardcoded `Auto-trade` 字串 audit | ✅ 0 hits | Claude（this session） |
| E1 | 建空 repo `cc4wang-ui/telegram-trade-bot` + `crosswang-collab/mikai-youtube-etl` | ✅ 已完成 | Cross（manual） |
| E2 | 在 Auto-trade 內準備 extraction branches（filtered subtree）| 待 Cross 批准 | Claude（this session） |
| E3 | 在新 repo 各開 Claude Code Web session 執行接收 | 待 E2 完成 | Cross 起 session、新 Claude 執行 |
| E4 | Auto-trade 端刪除被搬走的檔案、close 對應 PR | 待 E3 完成 | Claude（this session 或新 session） |
| F | claude-templates submodule 設定（Q5 選了 option 1）| 待 E 全完 | Claude（新 session） |

---

## E2：Extraction Branch 設計

不用 `git filter-repo`（會改寫 history、且這個 repo 太多檔案 cross-reference）。改用**乾淨的 cherry-pick + 整理**做法：

### `extract/telegram-bot`（從 main 派生）

要保留的檔案：
- `automation/gas-endpoint/macro_snapshot_handler.gs` → 之後 split：bot 端只保留 telegram dispatch、保留 v10_signal endpoint
- 所有 telegram-bot-* / earnings 相關 PR 的內容 squash 進來
- 新增 `README.md`（service-level）
- 新增 `CLAUDE.md`（service-specific，不繼承交易策略 context）

要 **不** 帶過去：
- `pine/` 全部
- `context/` 全部（個人財務）
- `docs/strategy-*`、`docs/pattern-detector-*`、`docs/module-*`
- `scripts/validate_pine.py`

### `extract/mikai-youtube-etl`

需要先 inspect 目前 youtube-etl-* branches 內容才能定。**Phase E2 開始前先讀那 3 個 branches 的 file diff，本文件再加一個小節列檔案清單。**

---

## E3：Handoff Prompts（給新 Claude Code Web sessions）

### Session A：開在 `cc4wang-ui/telegram-trade-bot`

```
你被開在一個剛建好的空 repo: cc4wang-ui/telegram-trade-bot。

你的任務是接收從 cc4wang-ui/Auto-trade 拆過來的 Telegram bot 內容。

來源：
- repo: cc4wang-ui/Auto-trade
- branch: extract/telegram-bot
- 檔案：見該 branch 根目錄 MIGRATION-MANIFEST.md

執行步驟：
1. 從 source branch 拉內容到本 repo main
2. 跑 source branch 裡的 verify.sh 確認檔案完整
3. 建立本 repo 的 CLAUDE.md（service-specific，不繼承交易策略）
4. 建立本 repo 的 README.md
5. 開 PR 給 Cross review

不要做的：
- 不要拉 pine/ 或 context/ 或 strategy 相關文件
- 不要修改 source branch（read-only）

完成後回報：哪些 PR 對應 source branch 的哪些 commit，以便關 source PR。
```

### Session B：開在 `crosswang-collab/mikai-youtube-etl`

```
你被開在一個剛建好的空 repo: crosswang-collab/mikai-youtube-etl（17LIVE 工作 org）。

【🔴 Sensitive context】
這是工作 org，絕對不能帶入任何個人交易/財務內容。如果 source branch 裡有這些檔案，
回報並停止，不要 push。

來源：
- repo: cc4wang-ui/Auto-trade
- branch: extract/mikai-youtube-etl
- 檔案：見該 branch MIGRATION-MANIFEST.md

執行步驟：
1. 拉檔案前先 audit：grep -i "portfolio\|cross-financial\|hedge\|private-credit\|strategy_v10" 應該 0 hit
2. 通過 audit 才 push 到 main
3. 建 CLAUDE.md（service-specific：BigQuery / GCP / Cloud Shell context）
4. 建 README.md（給 17LIVE 同事看的部署 SOP）
5. 開 draft PR 給 Cross review

完成後：source PR (#3, #4, #14) close 掉、留 comment 指向新 repo PR。
```

---

## E4：Auto-trade 收尾

被搬走後，從 main 刪這些檔案/branches：

- 刪 branches: `claude/telegram-bot-*`, `claude/busy-meitner-*`, `claude/brave-dirac-*`, `claude/update-telegram-bot-*`, `claude/youtube-etl-*`
- 從 `automation/gas-endpoint/macro_snapshot_handler.gs` **保留** macro + v10_signal endpoint，**刪掉** earnings/news/target/portfolio handler（如果有）
- close 對應 PRs，每個 PR 留：`Migrated to cc4wang-ui/telegram-trade-bot#X / crosswang-collab/mikai-youtube-etl#X`

---

## PR Triage 決策（Phase B）

| PR # | Branch | 屬於 | 動作 |
|---|---|---|---|
| #1 | deploy-ib-automation-LGEVQ | Auto-trade core | review → merge（TradersPost layer 6 屬於下單 pipeline） |
| #3 | youtube-etl-review-i4TIH | mikai | label `to-migrate:mikai-youtube-etl`、不 merge、E3 後 close |
| #4 | youtube-etl-review-KUnqD | mikai | 同 #3 |
| #5 | telegram-bot-progress-HUX8o | telegram-bot | label `to-migrate:telegram-trade-bot`、不 merge、E3 後 close |
| #6 | telegram-bot-workflows-9Xsus | telegram-bot | 同 #5 |
| #11 | brave-dirac-XkLmB | telegram-bot（GAS routine bug 是 macro endpoint 的）| 待判斷 — 看 commit 是只動 macro 還是動 bot WF |
| #12 | fix-pine-multiline-ternary | Auto-trade core | review → merge |
| #13 | busy-meitner-k7RNn | telegram-bot | label `to-migrate:telegram-trade-bot` |
| #14 | youtube-etl-data-api-mode | mikai | 同 #3 |

**不 merge 而 label** 的理由：merge 進 main 之後，E3 拉 main 會把 bot/mikai 的東西也帶進 Auto-trade，違背切割目的。改成 label + 從 branch 直接抽。

---

## Cross 已確認的決策（2026-05-05）

1. ✅ `cc4wang-ui/playwrightbot` → 搬到 `crosswang-collab/mikai-jobcan-bot`（rename）
2. ✅ `cc4wang-ui/Kirby-transition-plan` → 搬到 `crosswang-collab/Kirby-transition-plan`（Vtuber division 工作交接清單）
3. ✅ `cc4wang-ui/combatsystem` → 留 `cc4wang-ui/`（個人成長用，不在本次切割）
4. ✅ PR #11 `brave-dirac-XkLmB` → 抄出 3 條 gotcha 進當前 PR、close PR #11（branch stale + dirty）

---

## Phase F：claude-templates submodule（Q5 option 1）

Cross 選了「建 `cc4wang-ui/claude-templates` repo，兩邊當 submodule」。

### 設計

```
cc4wang-ui/claude-templates           # 新 repo
├── CLAUDE-base.md                    # 通用 Claude Code 指令（語氣 / Cross 偏好 / Golden Rules）
├── validate_pine.py                  # 通用 Pine 驗證腳本（如果其他 repo 也用 Pine）
├── docs/
│   ├── dev-guide-base.md             # 通用 Gotchas
│   └── cross-financial-profile.md    # 通用 Cross 偏好（不含財務 portfolio）
└── README.md                         # 描述如何在子 repo 裡引用
```

### 在子 repo 內引用方式

```bash
# 子 repo 一次性設定（Claude Code Web session 幫忙做）
git submodule add https://github.com/cc4wang-ui/claude-templates .templates
git submodule update --init

# 子 repo 的 CLAUDE.md 改成
@.templates/CLAUDE-base.md
@.templates/docs/dev-guide-base.md
... 加上各 repo 自己的 service-specific 指令
```

### Cross 永遠不需要碰 git submodule

所有 submodule 操作都由 Claude Code Web session 處理。Cross 只要：
- 改 templates 內容 → 在 templates repo 開 PR
- 同步到子 repo → 開 Claude Code Web session，說「sync templates」

### 為什麼 pin 到 tag 而不是 main

submodule 預設追特定 commit。**我會在 templates repo 用 git tag** (`v1.0`, `v1.1`...) 標版本，子 repo pin 到 tag。
- 好處：templates 有 breaking change 不會炸子 repo
- 子 repo 升 templates = 換 tag 的單一動作

---

## Rollback 計畫

如果 Phase E 出錯：

| 出錯點 | 影響 | Rollback |
|---|---|---|
| E2 extraction branch 內容錯 | 還沒 push 到新 repo，無 production 影響 | 直接刪 branch、重做 |
| E3 push 到 telegram-trade-bot 後發現少檔 | 新 repo 髒、production 不受影響（GAS / Telegram URL 還沒切） | force push 重來、或直接刪 repo 重建 |
| E3 push 到 mikai-youtube-etl **不小心帶了個人財務檔** | 🚨 嚴重：工作 org 看到個人交易 | 立即 `git filter-repo` 抹除 + force push、且通知 GitHub support 清快取 |
| E4 從 Auto-trade 刪檔後 macro pipeline 壞 | 早晨 macro 推播失敗 | revert E4 commit、重設 Routine |

→ E3 對 mikai-youtube-etl 的 push 必須**強制**先做 audit（已寫進 handoff prompt）。

---

## 時程估計（給 Cross 看時間預算）

| 動作 | 估時 | 誰做 |
|---|---|---|
| Phase A reorg | 已完成（5 min）| Claude this session |
| Phase B PR triage | 10 min | Claude this session |
| Phase C 寫本文件 | 已完成（10 min）| Claude this session |
| Phase E1 建空 repo | 已完成（5 min）| Cross |
| Phase E2 extraction branches | 15-25 min | Claude this session |
| Phase E3 接收（兩個新 session） | 各 10-20 min | Cross 起 session、新 Claude 執行 |
| Phase E4 收尾 | 10 min | Claude（this 或新 session） |
| Phase F templates submodule | 30 min | Claude（新 session） |
| **Cross 總時間** | **~30 min**（含建空 repo + 起 sessions + review PR）| |
| **Claude 總時間** | **~2 小時**（自己跑） | |
