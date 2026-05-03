# v10 Trading System — Claude 工作指令

> 這個檔案在每個 session 開始時自動載入。簡短、人類可讀、列原則而非全部規則。詳細內容用 @import 引用。

## 使用者

**Cross**，34 歲台灣人，mikai (17LIVE) COO，INTJ。**不是工程師、永遠不會是**。

- 偏好 繁體中文 + English（依照當下訊息切換）
- 時間是 COO 級昂貴，每次無謂來回都是成本
- 先結論後解釋，要結構化輸出，要選項而非開放題
- 講邏輯就接受推回，不要 yes-man

完整偏好：@context/cross-financial-profile.md

## 這個專案在做什麼

**台指期量化交易系統 v10**：從宏觀判斷 → 型態確認 → 自動進出場的完整 pipeline。

- 主檔：`strategy_v10.pine`（909 行單檔 TradingView Pine Script v5）
- 標的：`TAIFEX:TXF1!` 60 分鐘
- 帳號：TradingView **Essential**（10K bars 限制 → 回測僅 1.5-2 年；webhook ✅；20 active alerts；alert 60 天過期）
- 出場架構：1.5×ATR 固定停損 + 23% 波段拉回（>1×ATR 才啟動）+ OBV 翻轉 + 時間止損

策略全規格：@docs/strategy-v10.md

## 🔴 永遠不可違反的規則

### Rule 1：股價必須 web_search 驗證
**任何**涉及台股股價、PE、市值、可買股數的對話 → 第一步必須 web_search，不是填數字。
訓練資料台股價落後 6-12 個月（2025-2026 半導體暴漲 50-200%）。
**過去錯誤**：台達電訓練資料 480 vs 實際 1,550（3.2× 錯）、日月光 175 vs 350（2× 錯）。
詳見：@.claude/skills/price-validation/SKILL.md

### Rule 2：財務分析五步驟，不可跳步
① web_search 即時價 → ② 搜財報數據（EPS/ROE/負債比）→ ③ 用即時價算 PE 和股數 → ④ 跑五條件篩選 → ⑤ 建表
詳見：@.claude/skills/financial-analysis/SKILL.md

### Rule 3：寫/改 Pine Script 前必讀
- @docs/pattern-detector-pitfalls.md（**P1-5 致命陷阱**）
- @docs/dev-guide.md（Gotcha #1-32）
- 改完跑：`python3 scripts/validate_pine.py <檔名>`
詳見：@.claude/skills/pine-development/SKILL.md

### Rule 4：交易決策慎重
v10 訊號 + 五條件選股 + portfolio 配置決策 → 用 @.claude/skills/trading-decisions/SKILL.md

## 交付標準（Cross 的 Golden Rules）

1. **Cross 不 debug**：所有錯誤預期、邊界情況、測試由 Claude 負責
2. **先聲明限制**：寫 code 前列已知平台限制（GAS/Slack API timeout/權限）
3. **Ship complete**：單一自包含交付物，硬編碼 config，最多 5 步部署
4. **預檢清單**：端到端可跑？credentials 有標記為 placeholder？所有錯誤路徑明確？senior eng 會通過？
5. **失敗永久記錄**：失敗格式 `[平台] 出了什麼 — 下次怎麼做`，加進 @docs/dev-guide.md

完整守則：@context/cross-financial-profile.md

## 路由表

| 何時 | 讀什麼 |
|------|--------|
| 寫/改 Pine Script | @.claude/skills/pine-development/SKILL.md → @docs/pattern-detector-pitfalls.md |
| 任何涉及股價的對話 | @.claude/skills/price-validation/SKILL.md |
| 個股財務分析 / 五條件選股 | @.claude/skills/financial-analysis/SKILL.md |
| Portfolio 配置 / 交易決策 | @.claude/skills/trading-decisions/SKILL.md |
| **每日 Macro 推播 / Routine** | **@automation/README.md → @automation/routine/macro_snapshot_prompt.md** |
| **GAS bot 改造 / Telegram endpoint** | **@automation/gas-endpoint/macro_snapshot_handler.gs** |
| **Pine alert webhook 設定** | **@automation/gas-endpoint/pine_alert_webhook.md** |
| 經濟相態判斷 | @docs/module-1a.md（成長/通膨）+ @docs/module-1b.md（貨幣政策）|
| 跨市場同步性 | @docs/module-2.md |
| 先行指標 | @docs/module-leading.md |
| 寫新 Pine 指標 | @docs/pine-patterns.md + @docs/data-sources.md |
| 討論市場狀況 | @context/market-context.md |
| **每次對話開頭：不可控變數掃描** | **@context/uncontrollable-monitor.md** |
| **避險決策（Layer 1-3）** | **@context/hedge-decision-tree.md** |
| **Warsh 5/15 上任後監控** | **@context/warsh-failure-analysis.md → @context/uncontrollable-monitor.md** |
| **財報追蹤（持倉 / 已出清股）** | **@context/earnings-tracking.md** |
| **私人信貸危機判讀** | **@context/private-credit-watch.md**（深度）/ @context/private-credit-explainer.md（科普）|
| **Pine v10.1/v10.2 補強** | **@context/v10.1-task-spec.md / @context/v10.2-task-spec.md** |
| 查 Symbol 對應 | @config.json |

## 當前狀態快照（2026/05）

- v10 Pine 已完成、validate_pine 通過。Mock 6/6 通過，等實機驗證
- **v10.1 Pine 已產出**（私人信貸壓力 → 強制紅燈），檔案 `strategy_v10_1.pine`，等實機驗證
- **每日 Macro 推播 pipeline 已設計完成**：Claude Code Routine（雲端 cron 08:30 / 21:00）→ POST GAS Web App → 既有 Telegram bot 推播。配置檔在 `automation/`
- **v10 訊號即時推播**：Pine alert webhook → GAS → Telegram。設定指引在 `automation/gas-endpoint/pine_alert_webhook.md`
- 已開倉：2330 / 006208 / 2382 / QQQ / 9660 / 00632R / NFLX / NVDA / VOO / VTI / IXC
- **1810 小米 已於 4/29-30 全出清**（成本 54.88，分兩批 31.20 / 30.00 出，總損益 -NT$207K）
- 自動化 pipeline：TradingView Essential webhook → TradersPost → IB（Cross 入金中）
- 完整快照：@context/portfolio-2026-04-29.md（前一版 04-24 保留為歷史）

## 💬 互動風格

- **不要**：「這是個好問題！」開頭、過度道歉、5 個澄清問題前先做事
- **要**：直接回答 → 必要時補解釋；表格優於牆面文字；options 用按鈕（Cowork 介面有支援時）
- INTJ 卡住 = 多選最佳路徑癱瘓，幫我**砍**選項而非加；Se grip 時冷靜認可 + 給一個下一步行動

## 寫程式前的義務

如果準備寫 code，先讀：
1. 對應 skill（pine-development / price-validation / financial-analysis）
2. @docs/dev-guide.md 相關 Gotcha
3. 跑 validate（Pine 用 validate_pine.py、Python 用 mypy/pytest）

**沒跑驗證的 code 不算交付完成。**
