# Pine Script — 本專案專用模式

## 專案工具函數（直接複製使用）

```pine
// Z-Score：裁剪到 ±3。不要改裁剪範圍。
zscore(float src, int len) =>
    float mean = ta.sma(src, len)
    float stdev = ta.stdev(src, len)
    float result = stdev > 0 and not na(src) ? (src - mean) / stdev : 0.0
    math.max(-3.0, math.min(3.0, result))

// 安全除法：所有除法都要用這個
safe_div(float a, float b) =>
    b != 0 and not na(b) ? a / b : 0.0

// ROC：百分比變化率
roc(float src, int len) =>
    not na(src) and not na(src[len]) and src[len] != 0 ? (src - src[len]) / math.abs(src[len]) * 100 : 0.0

// 資產評分轉標籤（±3 制）
asset_label(float score) =>
    score >= 2.5 ? "🟢 積極做多" : score >= 1.5 ? "🟢 偏多" : score >= 0.5 ? "△ 輕倉做多" : score > -0.5 ? "─ 觀望" : score > -1.5 ? "▽ 減碼/輕空" : score > -2.5 ? "🔴 偏空" : "🔴 強烈偏空/清倉"
```

## 表格建構：用 row += 1 遞增法
宣告行數要比實際多預留 5 行。溢出不報錯但會不顯示。

## 新增 request.security 前的檢查清單
1. 確認當前總數（目前 10）
2. 必須加 `lookahead=barmerge.lookahead_off`
3. 強制拉日線 `"D"` 不受圖表時間框架影響
4. 加 fallback：`nz(data, default_value)` 或備用 symbol
