# automation/ — Cross 宏觀自動化

這個資料夾是 v10 交易系統的**自動化中樞**。核心理念（2026-06 新方向）：

> **自動化的家是 Claude 排程（Routines / Cowork），不是外部 server。**
> Claude 自己 web_search 抓數、自己判 regime、自己用 Gmail 寄信。**GAS 已棄用。**

## 結構

```
automation/
├── README.md                  ← 你在這
└── routines/
    └── macro_daily.md         ← 每日宏觀 routine 的 prompt（排程觸發後執行此檔）
```

## 每日 Macro Routine — 排程設定（唯一手動步驟）

到 **https://claude.ai/code** → Routines，新增一個排程：

| 欄位 | 值 |
|------|-----|
| **Name** | `daily-macro-regime` |
| **Repository** | `cc4wang-ui/Auto-trade` |
| **Working directory** | `.` |
| **Schedule (UTC)** | `0 6 * * 1-5`（= 台北 **14:00**，台股 13:30 收盤後，週一至五）|
| **Prompt** | `Read automation/routines/macro_daily.md and execute the routine.` |

> ⏰ **時區**：Routine cron 是 UTC。台北 = UTC+8。
> 台北 14:00 → cron `0 6`。想加美股盤前那班 → 再加一條 `0 13`（= 台北 21:00）。
>
> 📧 **Gmail**：routine 用 Gmail 工具寄到 `cc4wang@gmail.com`，
> 需確保排程的 Claude 環境已連 Gmail（這個 session 已連）。
>
> 🔑 **不需要任何 secret**：新方向不碰 GAS / Telegram，所以沒有 token / webhook URL 要設。

## 它每天做什麼

1. 台股收盤後觸發
2. web_search 抓 VIX、US 10Y/2Y（算曲線）、10Y 實質利率、DXY、SPX、TAIEX、ISM PMI、最近 FOMC + Fed 立場、WTI、CPI
3. 依四季框架判 regime（春 Goldilocks 現金 5% / 夏 Overheating 12% / 秋 Stagflation 18–28% / 冬 Deflation 12%）
4. 套硬規則（VIX>28 暫停買入、實質利率>2% 壓估值 🔴、ISM<50 收縮）
5. 同步性、緊縮度標「需 dashboard」不瞎猜
6. 輸出繁中 BLUF briefing，Gmail 寄到 Cross 信箱

詳細邏輯：見 [`routines/macro_daily.md`](routines/macro_daily.md)。

## 與舊架構的差異

| 項目 | 舊（已棄用） | 新（現行） |
|------|------------|-----------|
| 數據來源 | GAS 算 Macro Score v3 | Claude web_search + FRED + TWSE |
| 推播管道 | GAS → Telegram | Claude → Gmail |
| 外部依賴 | GAS Web App、token、webhook | 無 |
| 排程 | Anthropic Routine（雙時段） | Anthropic Routine（台股收盤後一班） |

> 根目錄的 `macro_snapshot_prompt.md`、`macro_snapshot_handler.gs` 是**舊 GAS 版，保留備查但不再使用**。
