# MIGRATION MANIFEST — telegram-trade-bot

> 這份檔案告訴接手 Claude（在 `cc4wang-ui/telegram-trade-bot` repo 開的新 Claude Code Web session）該怎麼把這個 branch 的內容部署到那個空 repo。

## Source

- **Source repo:** `cc4wang-ui/Auto-trade`
- **Source branch:** `extract/telegram-bot`
- **Migration date:** 2026-05-05

## Destination

- **Destination repo:** `cc4wang-ui/telegram-trade-bot`（空 repo，Cross 已建立）
- **Destination branch:** `main`

## 為什麼切出來

`cc4wang-ui/Auto-trade` 原本同時混了：
1. v10 Pine 量化交易策略（trading core）
2. Telegram bot WF1-4（portfolio / news / target / earnings 推播功能）
3. mikai YouTube ETL（17LIVE 工作）

按 service 邊界切：
- Auto-trade = Pine + Macro Routine prompt + Pine alert webhook 設定（trading source of truth）
- **telegram-trade-bot（這個 repo）= GAS Web App 多 endpoint + Telegram bot 推播服務**
- mikai-youtube-etl = 工作搬走

## File inventory（7 個檔案）

```
.
├── MIGRATION-MANIFEST.md             # 這份檔（receiving session 看完可刪）
├── gas/                              # GAS Web App 原始碼（手動貼進 Apps Script）
│   ├── macro_snapshot_handler.gs     # 主 handler，含 macro / v10_signal / WF1-4 多 endpoint routing
│   └── earnings_report_handler.gs    # 法說會追蹤模組
├── prompts/
│   └── earnings_routine_prompt.md    # 給 Claude Code Routine 跑 earnings 排程用
├── docs/
│   ├── deploy-runbook.md             # GAS + Telegram bot 端到端部署 SOP
│   ├── deploy-mobile-wf2-5.md        # 手機部署懶人版（5 分鐘）
│   └── wf234-dispatch.md             # WF2-4 dispatch 文件
└── skills/
    └── macro-daily-analyst-report/
        └── SKILL.md                  # macro 每日分析師 skill（推 Telegram 用）
```

## Cross-repo dependency map

這個 bot repo 跟 `cc4wang-ui/Auto-trade` 透過 **HTTP webhook** 解耦，不需要 git submodule：

```
Auto-trade（Pine + Routine）           telegram-trade-bot（這裡）
  ↓ Pine alert (HTTP webhook)            ↓
  ↓ Routine POST (HTTP)            GAS Web App 收 ?endpoint=...
                                         ↓
                                       Telegram
```

Auto-trade 的 `automation/gas-endpoint/macro_snapshot_handler.gs` 在 PR #15 reorg 後留在那邊，但它**真正的 source of truth 是這個 repo 的 `gas/macro_snapshot_handler.gs`**（含最新 WF1-4 endpoints）。Auto-trade 之後 Phase E4 收尾時應該刪掉那個 stale 副本，留個 README.md pointer。

## Receiving session 操作流程

```bash
# 1. Clone source extraction branch
git clone --branch extract/telegram-bot --single-branch \
  https://github.com/cc4wang-ui/Auto-trade.git /tmp/source-telegram-bot

# 2. Audit (應該 0 hit)
grep -r "claude/telegram-bot-workflows-9Xsus\|claude/busy-meitner\|claude/telegram-bot-progress" \
  /tmp/source-telegram-bot \
  && echo "🔴 stale branch refs" || echo "✅ AUDIT PASS"

# 3. Copy contents to destination root
cp -r /tmp/source-telegram-bot/{gas,prompts,docs,skills} .

# 4. Create destination CLAUDE.md
#    — see "Suggested CLAUDE.md template" below

# 5. Create destination README.md

# 6. Add minimal .gitignore
cat > .gitignore <<'EOF'
.DS_Store
*.log
.env
.env.local
node_modules/
__pycache__/
EOF

# 7. git add . && git commit -m "Initial import from cc4wang-ui/Auto-trade extract/telegram-bot"
# 8. git push origin main
# 9. Open draft PR for Cross review
```

## Suggested `CLAUDE.md` template (destination repo)

```markdown
# telegram-trade-bot — Claude 工作指令

> 這個 repo 是 Cross 個人交易系統的 **Telegram bot 推播服務**。獨立於 Pine 策略 repo (`cc4wang-ui/Auto-trade`)。

## 使用者

**Cross**，34 歲台灣人，mikai (17LIVE) COO，INTJ。**非工程師，永遠不會是**。

操作風格：
- 繁中 + English（依當下訊息切換）
- 先結論後解釋；表格 > 牆面文字；options > 開放題
- 講邏輯就接受推回，不要 yes-man

## 這個 repo 在做什麼

GAS Web App + Claude Code Routine + Telegram bot 推播 pipeline。

支援的 endpoints（在 `gas/macro_snapshot_handler.gs` route）：
- `?endpoint=macro_snapshot` — Macro 每日推播（Routine 觸發）
- `?endpoint=v10_signal` — Pine v10 訊號（TradingView alert webhook 觸發）
- `?endpoint=earnings` — 法說會追蹤（在 `gas/earnings_report_handler.gs`）
- `?endpoint=portfolio` / `news` / `target_price`（WF1-4，逐步上線）

## 入口

| 想做什麼 | 讀哪份 |
|---|---|
| 第一次部署 GAS + bot | `docs/deploy-runbook.md` |
| 手機快速部署 | `docs/deploy-mobile-wf2-5.md` |
| WF2-4 設計細節 | `docs/wf234-dispatch.md` |
| 改 GAS handler 邏輯 | `gas/*.gs` |
| 改 Routine 行為（earnings） | `prompts/earnings_routine_prompt.md` |
| Macro skill 邏輯 | `skills/macro-daily-analyst-report/SKILL.md` |

## 跟 cc4wang-ui/Auto-trade 的關係

| 屬於 Auto-trade | 屬於這個 repo |
|---|---|
| Pine 策略 (`pine/strategy_v10*.pine`) | GAS handler (`gas/*.gs`) |
| Macro Routine prompt (`automation/routine/macro_snapshot_prompt.md`) | Earnings Routine prompt (`prompts/earnings_routine_prompt.md`) |
| Pine alert webhook 設定文件 (`automation/gas-endpoint/pine_alert_webhook.md`) | GAS deployment runbook (`docs/deploy-runbook.md`) |
| `context/`（個人財務）| 不複製過來 — 工作邊界，bot 不需要 portfolio context |

## 不可違反

1. **不存 token / secret 在 .gs 檔裡**。所有 secret 用 GAS Script Properties。
2. **TradingView Pine alert webhook URL** 改變時，要同時更新 `pine_alert_webhook.md`（在 Auto-trade）和 GAS Script Properties。
3. **任何 endpoint 的 dedup 邏輯不可跳過** — 重複推播 = 你 Telegram 會被洗掉。

## 來源

從 `cc4wang-ui/Auto-trade` 的 `extract/telegram-bot` branch 抽出，2026-05-05 完成。原始 source PRs（已 close）：#2、#5、#6、#13。
```

## Suggested `README.md` template (destination repo)

```markdown
# telegram-trade-bot

Cross 個人交易系統的 Telegram bot 推播服務。GAS Web App 多 endpoint + Claude Code Routine 排程 + Telegram bot 推播。

## 架構

```
TradingView Pine alert ──┐
                          ▶ GAS Web App (多 endpoint) ──▶ Telegram
Claude Code Routine ─────┘
```

## 入口

- 部署：`docs/deploy-runbook.md`（完整版）/ `docs/deploy-mobile-wf2-5.md`（手機版）
- 設計：`docs/wf234-dispatch.md`
- GAS source：`gas/`
- Routine prompts：`prompts/`

## 相關 repo

- Pine 策略 + Macro Routine prompt：[cc4wang-ui/Auto-trade](https://github.com/cc4wang-ui/Auto-trade)
```

## After successful migration

1. 在 source repo (`cc4wang-ui/Auto-trade`) close 對應的 PRs：#2、#5、#6、#13
2. 每個 close 留 comment 指向 destination repo 的新 PR
3. `git push origin --delete claude/telegram-bot-progress-HUX8o claude/telegram-bot-workflows-9Xsus claude/update-telegram-bot-IZMsS claude/busy-meitner-k7RNn`
4. `git push origin --delete extract/telegram-bot`
5. 在 Auto-trade 開一個 follow-up PR 把 stale 的 `automation/gas-endpoint/macro_snapshot_handler.gs` 換成 README.md pointer 指向這個 repo
