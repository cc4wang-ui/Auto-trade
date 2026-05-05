# Module 1A：經濟相態 — 設計決策與陷阱

## 非直覺的設計選擇（Claude 預設不會這樣做）

### 成長指數權重：位置 40% + 方向 30% + 曲線 30%
為什麼方向拿 30%：2022 年初 SPX 還在高位（位置正值），但動量已翻轉（方向負值）。只看位置會晚兩個月才發現問題。

### Bear Steepening 打折機制
殖利率曲線正值時，Claude 的預設直覺是「正值=經濟好」。錯。
Bear Steep（10Y 被通膨推高）時曲線正值但經濟在惡化。
→ `yc_growth_signal = yield_curve_z * 0.3`（打七折）
判定條件：`yield_curve > 0 AND us10y_roc > us02y_roc AND us10y_roc > 0`

### 通膨指數：油價權重 50%
Claude 可能會平均分配。不要。油價是 CPI 最大波動源且最即時。
breakeven 反而有延遲且部分帳號無數據。

### 相態穩定度公式
`phase_stability = min(|growth_index|/1.5, 1.0) × 100`
< 40% 觸發轉換預警。1.5 這個分母是經驗值，從 2020-2025 回測校準。
