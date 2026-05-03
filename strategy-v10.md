# Strategy v10 — 規格文件

> 取代 strategy-v9.md。v10 為 Macro Score v3 + 四門進場 + 波段追蹤出場的完整策略。
> Mock 6/6 驗證通過，Pine 實作完成於 `strategy_v10.pine`（909 行）。

---

## 設計哲學

**v9 → v10 改動主軸**：
- 從「靜態判分」→ **方向燈 + 四門控制**
- 從「快進快出」→ **波段追蹤吃完整趨勢**
- 從「v9 沒考慮 stagflation」→ **明確 Stagflation Override**

**核心信念**：
- 宏觀方向佔 70% 績效權重，技術型態佔 30%
- 寧可少做、不可錯做（高品質門檻、強冷卻、四門過濾）
- 風險管理 > 收益最大化（先有停損、後有利潤）

---

## Layer M：Macro Score v3（方向燈）

### 軸線結構

**成長軸（-3 ~ +3）** — 7 個指標：
| 指標 | 加分條件 | 扣分條件 |
|------|--------|--------|
| ISM 製造業 | > 52: +0.5 | < 50: -0.5 |
| ISM 新訂單 | > 52: +0.3 | < 50: -0.3 |
| ISM 新訂單方向 | — | < 上月: -0.2 |
| NFP 非農 | > 150K: +0.2 | < 100K: -0.5 |
| 消費者信心 | > 80: +0.3 | < 60: -0.6 |
| 銅 ROC（20D） | > 5%: +0.3 | < -5%: -0.3 |
| ISM 就業 | > 50: +0.3 | < 47: -0.5 |

**殖利率曲線特殊處理**（Gotcha #9 Bear vs Bull Steepening）：
- 倒掛 < -0.2: -0.6（衰退信號）
- Bear Steepening（10-2 > 0.5 且 2Y 5D ROC > 5%）: -0.3（通膨推長端）
- Bull Steepening（> 0.5）: +0.1（降息預期）

**通膨軸（-3 ~ +3，正值 = 升溫）** — 5 個指標：
| 指標 | 升溫扣分 | 降溫加分 |
|------|--------|--------|
| ISM 物價支付 | > 65: +0.6 | < 50: -0.3 |
| 油價 ROC（20D） | > 20%: +0.7 / > 10%: +0.4 | < -20%: -0.5 |
| 通膨預期（10Y BEI） | > 2.5: +0.5 | < 1.8: -0.3 |
| Core PCE YoY | > 3.0%: +0.6 | < 2.0%: -0.3 |
| 平均時薪 YoY | > 4.0%: +0.4 | < 2.5%: -0.2 |

### 四季判定（Gotcha #30 門檻 ±0.5）

| 條件 | 季節 | 基準分 |
|------|------|-------|
| 成長 > 0.5 且 通膨 < 0.5 | 🟢 春 Growth | +15 |
| 成長 > 0.5 且 通膨 ≥ 0.5 | 🟡 夏 Stagflation 警戒 | +5 |
| 成長 ≤ -0.5 且 通膨 ≥ 0.5 | 🔴 秋 Stagflation | -15 |
| 成長 ≤ -0.5 且 通膨 < 0.5 | 🔵 冬 Recession | +10（逆向） |
| 其他 | 🟡 轉換期 | 0 |

> 冬天為何 +10：Marks COVID 案例「最壞時刻往往是最佳買點」

### Marks 估值覆蓋

```
val_adj = 0
val_adj -= max(0, SPX_PE - 25) × 1.0
val_adj -= max(0, TW_PE - 22) × 1.0
val_adj -= 3 if CAPE > 35 else 1 if CAPE > 30 else 0

# ERP（股權風險溢價）= (100/SPX_PE) - 10Y 殖利率
ERP > 3:    +6（最強做多訊號）
ERP > 1:    +3
ERP > 0:    0
ERP > -1:  -4
ERP ≤ -1:  -6（最強做空訊號 — Gotcha #29）
```

### Marks 信用覆蓋

```
HY spread > 7%: -5;  > 5%: -2
Real rate > 3%: -3;  > 2%: -1
DXY 1Y Z-score > 1: -2
```

### 情緒逆向（Gotcha #28 降權機制）

```
contra = 0
contra += 6 if VIX > 30 else 3 if VIX > 25 else 0
contra += 4 if VIX/VIX3M > 1.05 else 0  # ⚠ 倒掛 = 恐慌
contra += 5 if Put/Call > 1.2 else 0
contra += 5 if AAII Bears > 45 else 0
contra -= 3 if AAII Bulls > 55 else 0   # 過度樂觀

# 降權條件
if (base + val_adj + credit_adj) < -30:
    contra *= 0.5  # 已經很慘時不再用情緒逆向救
```

### 燈號判定

```
total_score = base + val_adj + credit_adj + contra

stagflation_override = total < -40 and 通膨軸 > 1.5

穩定度 = 成長軸 7 指標中與主導方向同號的比例 × 100%

if 穩定度 < 40% and not stagflation_override:
    強制 🟡 黃燈（不做進場）
elif stagflation_override:
    🔴 紅燈（積極做空）
elif total > +15:
    🟢 綠燈（可做多）
elif total < -20:
    🔴 紅燈（可做空）
else:
    🟡 黃燈
```

---

## Layer 1-4：型態偵測（沿用 pattern_detector_v2 架構）

### 啟用的 6 種核心型態（按勝率）

**做多型態**（▲）：
1. **反轉頭肩底** — 89%
2. **雙重底** — 88%
3. **上升三角** — 83%

**做空型態**（▼）：
4. **下降三角** — 87%
5. **頭肩頂** — 81%
6. **雙重頂** — 73%

### 品質因子（calcQ）

```
Q = round((sym × 0.30 + depth × 0.25 + breakout × 0.20 + vol × 0.25) × 100)
```

- **sym**：左右對稱（容差 30%）
- **depth**：型態高度 / ATR（min 1×ATR）
- **breakout**：突破程度 / 0.3×ATR（已突破）；接近度（形成中）
- **vol**：當前量 / (均量 × 1.2 倍)

### 過濾規則

- 跨度 < 5 根 K 線 → 砍
- 高度 < 0.5×ATR → 砍
- R:R < 1.0 → 砍
- 排序：Tier 升序 + 有效勝率（Q × BWR / 100）降序
- **只保留前 3**

---

## Layer 5：四門進場 + 波段追蹤出場

### D1 方向燈門
- 多單：🟢 綠燈
- 空單：🔴 紅燈（含 Stagflation Override）
- 黃燈：禁止進場

### D2 型態品質門
- 最高分型態 Q ≥ **90**
- 必須是「已突破」狀態（避免假訊號）
- 方向必須對齊 D1（綠燈→只認多型態，紅燈→只認空型態）

### D3 量能 + OBV 門
- 當根量 ≥ 均量 × **1.8 倍**
- OBV 5SMA 方向：多單需 ↑、空單需 ↓

### D4 冷卻期門
- 距上次進場 ≥ **20 根 K 線**

### 四門 AND（同時滿足才進場）

### 出場規則（四層並行）

| 出場類型 | 觸發條件 | 動作 |
|---------|--------|------|
| **固定停損** | 浮虧達 1.5×ATR（進場時） | 全平 |
| **波段拉回** | 浮盈 ≥ 1×ATR 後啟動，從峰值回撤 23% | 全平 |
| **OBV 翻轉** | OBV 5SMA 方向逆轉 | 全平 |
| **時間止損** | 10 根 K 線未達 1×ATR 浮盈 | 全平 |

> Gotcha #32：1×ATR 啟動門檻避免「輕微浮盈即觸發 23% 拉回」過早出場

### 倉位
- 策略內固定 1 口
- 實際操作 2 口小台 → 手動複製訊號開第二口

---

## 輸入參數（Pine 預設）

### 月更 Macro 數據（每月第 1 工作日 + 第 1 週五更新）

| Input | 預設值 | 來源 / 更新頻率 |
|-------|-------|----------------|
| ism_mfg | 52.7 | ISM Manufacturing 月初公布 |
| ism_new_orders | 53.5 | 同上 |
| ism_new_orders_prev | 55.8 | 上月值（手抄）|
| nfp_k | 178 | 月第 1 週五 |
| consumer_sentiment | 57.9 | 密西根大學 |
| ism_employment | 48.7 | ISM 副指標 |
| ism_prices | 78.3 | ISM 副指標 |
| core_pce_yoy | 3.1 | 月最後一週 |
| avg_hourly_yoy | 3.5 | 隨 NFP |

### 週更 / 季更

| Input | 預設值 | 更新時點 |
|-------|-------|---------|
| spx_pe_input | 28.4 | 季 EPS 後校準 |
| tw_pe_input | 29.5 | 季 EPS 後 |
| cape_input | 35.0 | 季 |
| put_call_input | 0.75 | CBOE 每日 |
| aaii_bears | 30 | 每週四 |
| aaii_bulls | 42 | 每週四 |

### 自動拉取（request.security × 13）

US10Y / US02Y / 通膨預期 / DXY / WTI / 黃金 / 銅 / VIX / VIX3M / HY spread

---

## Mock 驗證結果（6/6 通過）

| 情境 | 預期 | Mock 結果 |
|------|------|---------|
| 2022/06 Stagflation | 🔴 紅燈做空 | -45, override 觸發 ✅ |
| 2024/05 Goldilocks | 🟢 綠燈做多 | +28 ✅ |
| 2020/03 COVID 底 | 🔵 冬, +10 base + VIX 逆向 | +18 ✅ |
| 2025/12 過熱頂 | 🟡 黃燈警戒（PE 高、ERP 負）| -8 ✅ |
| 2026/01 轉換期 | 🟡 黃燈（穩定度不足）| -12, 穩定度 28% → 強制黃 ✅ |
| 2026/04（當前）| 🟡 黃燈 | -16 ~ -30（依算法版本）✅ |

---

## 已知限制

1. **TradingView Essential**：10K bars → 60 分鐘圖回測僅 1.5-2 年，無法回測 2022 完整崩盤
2. **request.security**：v10 用 13 個，Essential 上限 40 個，安全
3. **alert 60 天過期**：日曆要記每 2 個月重設
4. **手動 input**：7 個月更值，更新節奏取決於 Cross 紀律
5. **Put/Call 來源**：TradingView 免費帳號可能沒即時，採 input 手動

---

## 維護備忘

- 季 EPS 後 → 校準 SPX_PE / TW_PE / CAPE
- ISM Manufacturing day → 一次更新 ism_mfg / new_orders / employment / prices
- NFP day（月第 1 週五）→ 更新 nfp_k / avg_hourly_yoy
- Core PCE day → 更新 core_pce_yoy
- 每週四晚 → 更新 aaii_bears / aaii_bulls
- 每日（如有） → put_call_input（or 用週均值）

下次大改建議方向：
- v10.1：把月更 Macro 改成 Google Sheet 中介（Cross 已有 GAS 串接基建）
- v11：考慮多時框疊加（H1 訊號 + D1 確認）
- v11：加入波動度過濾（VIX > 35 自動空倉）
