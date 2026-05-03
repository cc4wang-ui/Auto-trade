# 技術型態偵測器 — 踩坑紀錄

本檔案記錄 v1.0/v1.1 開發過程中遇到的所有問題。
Claude 在寫 Pine 程式碼前必須讀這份檔案。

---

## 🔴 P1 — 致命：導致完全沒有輸出

### P1-1. Pivot 分離存儲導致型態偵測失敗

**症狀**：PH=10 PL=10 但偵測=0。pivot 充足但沒有型態命中。

**根因**：
把 pivot high 和 pivot low 存在兩個獨立 array（phP[], plP[]），
然後型態條件假設 `plP[0]` 和 `plP[1]` 之間一定有一個 `phP[0]`。
→ 分鐘線上，`ta.pivothigh` 和 `ta.pivotlow` 獨立觸發。
→ 可能連續出現 3 個 pivot low 才出 1 個 pivot high。
→ `plP[0]` 和 `plP[1]` 之間根本沒有 pivot high，條件永假。

**修正**：
改用 Zigzag 統一序列。合併所有 pivot 到單一 array，
強制交替（低→高→低→高）。連續同向 pivot 保留更極端的。

**教訓**：
不要假設兩個獨立事件源會自然交替。
這是整個 v1.0/v1.1 失敗的根本原因。

---

### P1-2. 所有型態都要求「已突破」才顯示

**症狀**：即使 zigzag 正確，大部分時間 dashboard 仍然空白。

**根因**：
每個型態的最後一個條件都是 `close > neckline`（多方）或 `close < support`（空方）。
市場大部分時間不在突破狀態 → 偵測結果永遠是 0。

**修正**：
加入「形成中」狀態。幾何條件通過但尚未突破 → 顯示灰色「待突破」。
已突破 → 顯示完整訊號。

---

## 🟡 P2 — 嚴重：導致訊號過多或全被過濾

### P2-1. 品質因子校準不切實際

**症狀**：偵測=1 → 過濾後=0。品質分設門檻 70，但所有型態都拿不到 70。

**根因**：
- 深度滿分要 2× ATR → 正常型態只有 0.8-1.5× ATR → 深度因子只拿 40-60%
- 突破力滿分要 1× ATR → 剛突破的訊號只超過 0.05-0.2× ATR → 突破因子拿 5-20%
- 量能滿分要 2× 均量 → 一般突破量是 1.2-1.5× → 量能因子拿 60-75%
- 對稱性滿分要差距 0% → 容差都設 2% 了卻要 0% 才滿分 → 矛盾

四個因子都拿不到高分 → 品質分天花板大約 45-55 → 過不了 70 門檻。

**修正**：
重新校準滿分門檻：
| 因子 | 舊滿分 | 新滿分 |
|------|--------|--------|
| 深度 | 2× ATR | 1× ATR |
| 突破力 | 1× ATR | 0.3× ATR |
| 量能 | 2× 均量 | 1.2× 均量 |
| 對稱性 | 差距 0% | 差距 < 容差×30% |

**教訓**：
品質因子設計後，先算一個「典型好型態」能拿幾分。
如果典型好型態拿不到門檻 → 校準有問題，不是型態的問題。

---

### P2-2. 沒有品質門檻可調參數

**症狀**：品質門檻寫死在程式碼裡，無法 debug。

**修正**：
品質門檻必須是 `input.int`，可以在 Settings 裡調。
Debug 時設 0 = 關掉品質過濾。

---

## 🟡 P3 — 中等：Pine Script 語法陷阱

### P3-1. ta.lowest / ta.sma 等內建函數不能放在 if 裡

**症狀**：Warning: "The function should be called on each calculation for consistency"

**根因**：
Pine v5 要求 `ta.lowest`、`ta.sma`、`ta.atr` 等函數在每根 K 線都執行。
放在 `if` 裡只在條件成立時執行 → 計算結果不一致。

**修正**：
所有 `ta.*` 函數提到全域 scope，結果存在變數裡，if 裡引用變數。
```pine
// ✗ 錯
if someCondition
    float x = ta.lowest(low, 40)

// ✓ 對
float lowest40 = ta.lowest(low, 40)  // 全域
if someCondition
    float x = lowest40               // 引用
```

---

### P3-2. 變數宣告順序 — 引用在宣告之前

**症狀**：Error: "Undeclared identifier 'atr14'"

**根因**：
工具函數 `isTallEnough()` 引用 `atr14`，但 `atr14` 在更下面才宣告。
Pine 由上往下解析，沒有 hoisting。

**修正**：
全域計算值（atr14、avgVol、lowest40、volOK）必須放在工具函數之前。
```
input 參數
↓
全域計算值（ta.atr, ta.sma 等）
↓
工具函數（可引用全域計算值）
↓
主邏輯
```

---

### P3-3. Pine v5 函數不能可靠修改全域變數

**症狀**：addResult 裡面的 rawDetections += 1 和 setCooldown 沒有生效。

**根因**：
Pine v5 的 user-defined function 對全域 `var` 變數的修改行為不可靠，
特別是在 array 操作和計數器遞增上。

**修正**：
不要在 addResult 裡面做過濾和副作用。
函數只做「收集資料」，所有過濾/排序/冷卻設定放在後處理階段。

---

### P3-4. barstate.isconfirmed 導致 label 不 reactive

**症狀**：label 和 line 只在 K 線收盤時才更新。

**根因**：
`if barstate.isconfirmed` 意味著只在 K 線確認收盤後才繪製。
品質分的突破力因子隨 tick 變化，但圖表上看不到即時變化。

**修正**：
移除 `barstate.isconfirmed`。
用 `var label sigLabel = na` + 每 tick `label.delete + label.new` 實現 reactive。

---

### P3-5. Pine `and` 不保證短路求值 — array.get 放在條件裡會炸

**症狀**：Error on bar 0: In 'array.get()' function. Index 0 is out of bounds, array size is 0.

**根因**：
```pine
// ✗ 危險：array 為空時 array.get(resState, 0) 仍然被執行
if showLines and resultCount > 0 and array.get(resState, 0) == "已突破"
```
Pine 的 `and` 不像 JS/Python 保證左邊為 false 就跳過右邊。
函數呼叫（如 `array.get()`）可能在條件鏈中無條件執行。

**修正**：
把 array 存取放在巢狀 if 裡，確保外層條件通過後才碰 array。
```pine
// ✓ 安全：先確認 array 有元素，再存取
if showLines and resultCount > 0
    if array.get(resState, 0) == "已突破"
        // ...
```

**教訓**：
Pine 條件裡永遠不要放 `array.get()`、`array.size()` 以外的 array 操作。
`and`、`or` 和 **ternary `?:`** 都不安全。先用 size 檢查，通過後在 if body 裡才存取。

---

## 🟢 P4 — 輕微：顯示問題

### P4-1. table 行數不夠

**症狀**：底部 debug 行不顯示。

**根因**：
`table.new(..., rows=10)` 但實際需要 12+ 行（標題 + 欄位 + 數據 + footer + debug）。
溢出不報錯，直接不顯示。

**修正**：
行數宣告 = 實際最大行數 + 5 的餘量。數據行算法：
`2（標題+欄位）+ maxSignals + 4（footer/debug）+ 5（餘量）`

---

## 📋 開發前檢查清單

每次寫或改 pattern detector 的 Pine code 前：

- [ ] 讀過本檔案，特別是 P1-1（zigzag 統一序列）
- [ ] 讀過 pattern-detector-design.md（架構決策）
- [ ] 全域計算值放在工具函數之前
- [ ] 所有 ta.* 函數在全域 scope
- [ ] addResult 只收集，不過濾
- [ ] 過濾在後處理做
- [ ] table 行數留餘量
- [ ] 品質門檻是 input 可調
- [ ] `and`、`or`、ternary `?:` 裡不放 array.get()，用巢狀 if
- [ ] 跑 validate_pine.py，0 個 ❌ 才交付
