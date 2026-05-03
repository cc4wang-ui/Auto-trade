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

### Pine Script 第二批陷阱（2026/05/03 v10.2 實機 debug 新增）
36. **🔴 `validate_pine.py` 不是充分條件** — 它通過不代表 TradingView 編譯會通過。實測案例（2026/05/03）：v10.2 `validate_pine.py` 通過，但實機編譯報「Syntax error at input 'end of line without line continuation'」。validator 只檢查純文字 lint（version、lookahead、safe_div、table size），不檢查語法陷阱。**寫完任何 Pine 必須在 TradingView 跑空 chart bar 0/5/50 三個邊界 case 才算驗收完。**
37. **🔴 多行 ternary 必爆** — 即使縮排對、無空白行，Pine v5 編譯器看到 `? "X" :\n` 跨行就死。Gotcha #7 早就寫過但 v10.1 / v10.2 仍違反 21 處。**永遠用 `if/else if`，從不用多行 ternary**。範例：
    ```pine
    // BAD（必爆）
    string level = condA ? "A" : condB ? "B" : "DEFAULT"
                                                       // ← 跨行就炸

    // GOOD（v10.0 風格）
    string level = "DEFAULT"
    if condA
        level := "A"
    else if condB
        level := "B"
    ```
38. **🔴 `array.get` 在 `or`/`and` 後面 → early bar 必炸** — Pine 的 `or`/`and` 不保證 short-circuit。`if sz == 0 or array.get(zzD, 0) != -1` 在 sz==0 時仍會評估 array.get → empty array index 0 out of bounds → 炸。pitfall P3-5 早寫過但 v10.0 base 就違反，從沒被測過早期 bar。**修法**：nested if + bool flag。
39. **🟡 CBOE specialty index 不在 Essential 帳號** — 實測 invalid：CBOE:BKX、可能也包含 BXY、SKEW 等。**fallback**：BKX → AMEX:KBE（SPDR S&P Bank ETF，相關係數 > 0.95）。CBOE:VIX / VIX3M / VIX9D 在 Essential 是 OK 的。
40. **🟡 GitHub private repo raw URL 對未登入瀏覽器回 404** — 不是 401/403 而是直接 404，會以為 URL 寫錯。傳 raw URL 給 user 前先確認 (a) repo visibility，(b) user 瀏覽器 GitHub 登入狀態。fallback：(a) 暫時 toggle public 30 秒、(b) chat 直接 dump 程式碼。

### 寫 Pine Script 強制 pre-push checklist（2026/05/03 新增）
- [ ] **讀過** `pattern-detector-pitfalls.md` 全部 P1-5（不是「以為記得」，是真的打開看一次）
- [ ] **讀過** `dev-guide.md` 上述 Pine 相關 Gotcha (#1-23 + #27-32 + #36-40)
- [ ] 任何 `if/and/or` 條件**沒有**包含 `array.get`（用 nested if）
- [ ] 任何 `string/color = condA ? X : condB ? Y :` **沒有**跨行
- [ ] 所有 `request.security` symbol 在 Essential 可用（避免 CBOE:BKX 等 specialty）
- [ ] `validate_pine.py` 通過
- [ ] **手動 trace bar 0、bar 5、bar 50 三個邊界 case**（最常被跳的步驟，但最會抓到 P3-5 類 bug）
- [ ] TradingView 實機編譯 + Add to chart + 看 dashboard render，**沒有任何 Caution/Error popup**

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
