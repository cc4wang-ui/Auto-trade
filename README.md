# v10 Trading System — 自動化

Cross 的台指期量化交易 + 個人理財自動化。**GAS / Telegram / Slack 全棄用**，現行只用
Claude 排程 + web_search + Google Sheet + Gmail + Apps Script。

## 兩條產線

### 1. 每早 Macro × 持倉電子報（Gmail）
- 觸發：Claude Routine，cron `0 23 * * 0-4`（台北週一至五 07:00）
- 流程：web_search 抓總經 → 讀個人 Google Sheet 持倉/已實現 → 套 `automation/newsletter/template.html` → Gmail 寄 `cc4wang@gmail.com`
- Prompt 檔：`automation/routines/macro_daily.md`
- 不需任何 secret / token

### 2. 即時持倉網頁（Google Apps Script）
- 同帳號私密讀三份 Sheet（持倉 / 已實現 / 市場 Macro）
- 部署「僅限我自己」= 只有 Cross 登入看得到
- 檔案 + 部署指南：`apps-script/`

## 資料來源（Cross 個人 Google 帳號）

| 用途 | Sheet ID |
|------|----------|
| 持倉（未實現，GOOGLEFINANCE 即時）| `1j6B-QVHOQ-4n6dIbj5-Zc-laJmGooORPSf4VUGmWTxE` |
| 已實現損益（賣出 / 配息）| `1POxFcuegsTyYtgfi7RI_qpJX0fO66-314x-5679EBrM` |
| 市場 Macro（每早 email 自動更新）| `15jTuymkg5Rv-K7-6lVS8LWP7iZ_NYZmdkY6mbRfnBk0` |

## 目錄

```
automation/
├── README.md                  ← 排程設定（唯一手動步驟）
├── routines/macro_daily.md    ← 每早 routine 的 prompt
└── newsletter/template.html   ← 電子報版型
apps-script/                   ← 即時持倉網頁（Code.gs + Index.html + README）
docs/                          ← 策略與模組文件
strategy_v10.pine              ← v10 主策略
```

> 舊 GAS pipeline（macro_snapshot_prompt / handler）已刪除。Pine 策略開發見 `docs/`。
