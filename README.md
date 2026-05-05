# Auto-trade — v10 量化交易系統

台指期 60 分鐘宏觀策略 + Telegram 推播 + 自動下單 pipeline。

## 入口

| 想做什麼 | 看哪裡 |
|---|---|
| 第一次接觸這個 repo | [`docs/start-here.md`](docs/start-here.md) |
| 跑 / 改 Pine 策略 | [`pine/strategy_v10.pine`](pine/strategy_v10.pine)（latest: `strategy_v10_2.pine`）|
| 設定每日 Macro 推播 + Pine alert webhook | [`automation/README.md`](automation/README.md) |
| 個股財務 / portfolio / 市場狀況 context | [`context/`](context/) |
| Pine / strategy / 模組設計文件 | [`docs/`](docs/) |
| Claude Code 工作指令 | [`CLAUDE.md`](CLAUDE.md) |

## 結構

```
.
├── CLAUDE.md            # Claude Code 主指令（每個 session 自動載入）
├── config.json          # symbol overrides + 帳號設定
├── pine/                # Pine Script 策略原始檔
├── automation/          # Macro routine + GAS endpoint + Pine webhook
│   ├── routine/         # Claude Code Routine 雲端 prompt
│   └── gas-endpoint/    # GAS Web App 接 Telegram bot
├── context/             # 個人財務 / portfolio / 市場狀況 / 風險監控
├── docs/                # 策略設計、Pine pitfalls、模組說明
└── scripts/             # validate_pine.py 等工具
```

## 相關 repos

- [`cc4wang-ui/telegram-trade-bot`](https://github.com/cc4wang-ui/telegram-trade-bot) — Telegram bot 服務（從本 repo 拆出）
- [`crosswang-collab/mikai-youtube-etl`](https://github.com/crosswang-collab/mikai-youtube-etl) — 17LIVE YouTube ETL（搬到工作 org）

切割細節見 [`docs/dispatch-extract-bot-repo.md`](docs/dispatch-extract-bot-repo.md)。
