# 開發指南 Development Guide

## 版本命名
- 主版本：功能大改（v1.0 → v2.0）
- 次版本：新模組或邏輯調整（v1.1 → v1.2）
- 修補版本：bug fix 或小優化（v1.2 → v1.2a）

## 每次修改必須
1. 說明改了什麼以及為什麼
2. 用真實市場案例驗證（優先用 2022 年或當前市場）
3. 確認 `request.security` 總數（上限 40，當前用 13）
4. 更新 `memory/changelog.md`

## Pine Script 規範
- 必須使用 v6（`//@version=6`）
- 所有 `request.security` 必須設 `lookahead=barmerge.lookahead_off`
- 所有除法必須用 `safe_div()` 防止除零
- Z-Score 必須裁剪到 ±3 防止極端值
- 儀表板數值必須同時顯示「數字」和「解讀」（如 `+0.25 △ 擴張`）
- 所有顏色必須用 `color.new()` 包裹
- 所有 `input` 參數必須包含 `tooltip` 說明
- 程式碼片段見 `references/pine-patterns.md`

## 常見陷阱 Gotchas

### Pine Script 陷阱
1. **`FOREXCOM:SPX500` vs `SP:SPX`** — `SP:SPX` 更可靠但某些帳號沒有。N/A 時切換到 `FOREXCOM:SPX500`
2. **`FRED:T10YIE`** — 部分帳號無法取得。fallback 用油價動量替代
3. **`FRED:DFF`** — 有延遲。fallback 用 2Y 殖利率近似
4. **`plot()` vs `line.new()`** — plot 隨圖表縮放移動，固定價位用 line.new()
5. **table 行數上限** — 宣告時預留足夠行數，溢出不報錯但不顯示
6. **`ta.correlation` 的 NaN** — 數據不足回傳 NaN，必須 `nz()` 包裹
7. **Pine Script ternary 不能跨行** — 多條件判斷改用 `switch` 語法
8. **60 分鐘框架的日期判斷** — 同一天有多根K線，用 `var` 狀態機避免重複觸發

### 市場數據陷阱
9. **殖利率曲線假象** — 正值不等於經濟好。Bear Steepening（長端被通膨推高）vs Bull Steepening（短端降息預期）含義相反
10. **PPI/CPI 公布日效應** — 物價數據超預期時 2Y 當天劇烈反應。用 2Y ROC 偵測
11. **油價衝擊非對稱性** — 台灣能源進口國，油價暴漲對台股衝擊 >> 美股
12. **黃金流動性擠壓** — 同步性高時黃金因保證金壓力被拋售，「戰爭=黃金漲」不成立
13. **不要平等加總** — 台股怕油價+匯率，美股怕實質利率，敏感度不同
14. **變化率 > 水位** — 成長指數 +0.3 但快速下降 比 -0.5 但穩定更危險

### v2.0 先行指標陷阱
15. **`COMEX:HG1!`** — 銅期貨連續合約。部分帳號需改 `CAPITALCOM:COPPER`
16. **`CBOE:VIX3M`** — 3 個月 VIX。免費帳號可用，但偶爾有延遲。fallback 用 VIX 本身（此時期限結構比值=1，等於沒有訊號）
17. **`FRED:BAMLH0A0HYM2`** — 高收益利差。延遲 1-2 天，但信用利差是慢變量所以可接受。如果 N/A，信用相關判斷全部跳過
18. **銅金比的絕對值無意義** — 只看方向（ROC）。黃金十年漲 3 倍讓比值長期下降，但不代表經濟一直在弱化
19. **先行指標不能單獨使用** — 設計為「確認或推翻」滯後模組，不是獨立訊號。單看銅金比做交易會被假突破打臉

### 策略（strategy）特有陷阱
20. **`strategy.exit` 的 trail_points 單位是 tick** — 必須除以 `syminfo.mintick` 轉換
21. **`pyramiding` 設定** — 影響最大同時持倉筆數，加碼邏輯必須配合
22. **`process_orders_on_close`** — 必須設 true，否則訊號延遲一根K線
23. **台指期結算日非固定週三** — 春節等假期會調整，不能硬編碼「第三週三」

### 財務分析陷阱（2026/3/25 新增）
24. **🔴 台股股價不可用 AI 訓練資料** — 2025-2026 年半導體股暴漲 50-200%，訓練資料中的價格完全不可信。必須先 `web_search` 拉即時報價再做任何計算。實測案例：台達電訓練資料 480 元 vs 實際 1,550 元（差 3.2 倍）、日月光訓練資料 175 元 vs 實際 350 元（差 2 倍）。錯誤的價格導致 PE 判定、五條件篩選、可買股數全部失準。
25. **財務分析必須按順序** — ① 搜即時股價 → ② 搜財報數據 → ③ 算 PE → ④ 跑篩選 → ⑤ 建表。跳過任何步驟就會出錯。尤其不可「覺得自己知道」就跳過步驟①。越熟悉的股票越容易犯錯。
26. **交叉驗證** — 每個數字都要 sanity check。PE × EPS 應 ≈ 股價。可買股數 × 股價 應 ≈ 預算。不一致代表某個輸入有誤。

### Telegram bot 部署陷阱（2026/5/3 新增 — WF2-5 上線血淚）

27. **🔴 GAS Web App 部署「Who has access」必須 = `Anyone`（完全匿名）** — 任何「Anyone with Google account」/「Only myself」/「Domain」設定都會讓外部 POST 被 302 redirect 到 Google login URL，Anthropic Routine / curl / Pine alert 全部送不到。失敗症狀：Routine logs 看到 "POST 被 302 redirect 到需要 Google Cookie 的 URL"。修法：Deploy → Manage deployments → Edit → Who has access: **Anyone** → New version。URL 不會變。

28. **🔴 Anthropic Cloud Routine 沒檔案系統** — Routine prompt 不能寫「讀 `.claude/skills/.../SKILL.md`」這種跨檔引用，雲端執行環境讀不到本機 repo 檔案。失敗症狀：Routine 自診斷出「SKILL.md 不存在」但 silently 繼續產出半成品。修法：把所有規範 inline 進 prompt 本體（macro_snapshot_prompt.md Step 5.5 就是範例）。

29. **`manual_test` session 不能解讀為「跳過數據撈取」** — Routine prompt Step 0 把非排程觸發標 `manual_test`，model 容易解讀成「只是測試不用真的撈」直接送空殼 payload。失敗症狀：Telegram 收到全 dashes 訊息。修法：prompt 必須明文「不論 session 為何，Steps 1-5 全部必跑」（Bug 5）。

30. **🔴 GAS endpoint 必須有 payload completeness check（4th-layer guard）** — 只有 token / timestamp / dedup 三層不夠。空殼 payload 過了三層 → silent 渲染一堆 dashes 推到使用者面前。修法：在 dedup **之前**加第 4 層 — 檢查 `analyst_report.headline` 或 `light/macro_score/season` 至少一者存在，否則 reject 並推 ⚠ 警告。

31. **空殼 payload guard 必須在 dedup 之前** — 若 guard 放 dedup 後面，空殼 payload 已經占用了當天 dedup 配額（如 `manual_test_2026-05-03`），同一 session 後續 POST 永遠被 dedup 攔下，guard 永遠跑不到。順序：lock → token → timestamp → **payload-completeness** → dedup → render。

32. **Test 函數的 session 必須唯一** — `testEmptyPayload` 用固定 session `manual_test` 會撞到歷史空殼留下的 dedup → 永遠跑不到 guard。改用 `'test_empty_' + Date.now()` 確保每次唯一。

33. **舊版/legacy renderer 應該 section-conditional 不應死板填 dashes** — partial payload 若強制填 `'—'` 看起來像 bug。每段獨立檢查 `hasAny(obj, keys)`，整段缺資料就跳過該段（不要印標題）。

34. **Telegram bot token 401 → 先用 GAS 隔離測試** — 收到 401 不能立刻假設 token 死了，可能只是某一端 secret 過期。先在 Apps Script 跑 `testMacroSnapshotAnalyst()`，如果 GAS 推 Telegram 成功 → token 對 GAS 是好的，問題在 Routine 端 secret。GAS 失敗才是 token 真的需要重發（BotFather → Revoke + Renew）。

35. **GAS 自診斷函數是必備** — 部署一次 1000+ 行的檔案，paste truncation / Script Properties 缺 / sheet 沒建 / 函數沒定義都會 silent 失敗。寫一個 `dryRunDoctor()` 把 Script Properties / 必要 sheets / 命名函數可達性 / 4-layer guard 是否存在全 check 一次，部署完先跑這個再跑 testXxx。

36. **Pine v5 短路評估與 array.get 致命組合（P3-5 重申）** — `if sz == 0 or array.get(zzD, 0) != -1` Pine 不保證短路評估，TradingView 在 Add to chart 時可能重 evaluate from bar 0 → 觸發 `array.get out of bounds`。改 nested if 配 guard bool 模式。歷史踩過：strategy_v10.pine 修補在 commit `a12d6b9`。

## 溝通原則

### 做
- 用真實市場事件解釋（「2022 年 SPX 跌 27%」而非「stagflation 期間股票表現不佳」）
- 先說結論再解釋原因
- 數值和解讀同時呈現
- 承認不確定性和模型局限

### 不做
- 過度抽象（使用者說「看不懂」時立即換方式）
- 用物理公式嚇人
- 假裝模型完美
- 用訓練資料中的股價做計算（用 web_search 拉即時價）
