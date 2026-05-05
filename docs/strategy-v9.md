# 期貨換倉突破策略 v9.0 — 記憶 + 變更記錄

## 狀態
- Pine Script v6 | 60 分鐘 | 標的：TAIFEX:TXF1!
- request.security：11/40
- Dashboard rows：40/55 | 總行數：~1,040

## 架構摘要

### 進場：三閘門聯合（A AND B AND C）
- **A** 價格確認：連續 N 根站穩 band 外 + 突破厚度 > 0.5x ATR
- **B** 量能確認：Volume Spike ≥ 2 根 OR OBV 斜率方向一致
- **C** 環境許可：Regime Filter（趨勢 + 系統風險 + 政策意外）
- effectiveConfirmBars = confirmBars + Regime 調整（WARNING+1, CRISIS+2, MIXED+2）

### 出場：四層優先級
- **P1** 結算日：虧損→平倉 / 盈利+動量健康→carry over / 盈利+動量弱→獲利了結
- **P2** 停損：初始 2x ATR + 追蹤（浮盈 >1.5 ATR 觸發）
- **P3** 動量衰竭：OBV 斜率連續 3 根反向 OR 峰值衰減 50%
- **P4** 反轉出場：5 根突破反向 band + OBV

### Regime Filter（11 個 request.security）
| Regime | 條件 | 做多 | 做空 | 部位 | confirm+ |
|--------|------|------|------|------|----------|
| HALT | VIX 深度倒掛 >1.1 | ❌ | ❌ | 0% | — |
| SHOCK | 2Y ROC >10% | ❌ | ❌ | 0% | — |
| CRISIS | 同步性>70 OR VIX倒掛 | ✅ | ✅ | 50% | +2 |
| WARNING | 同步性>50 OR 穩定度<40% | 依趨勢 | 依趨勢 | 100% | +1 |
| NORMAL | 正常 | 依趨勢 | 依趨勢 | 100% | 預設 |

### Carry-Over
觸發：結算日 + 盈利 + 動量健康 → 不平倉，帶入下週期，不開新倉

## Bug 修復記錄
| Bug | 修復 |
|-----|------|
| TVC:TWII invalid | → TWSE:TAIEX |
| alertcondition warning | → alert()（strategy 不支援 alertcondition）|
| carry-over 不生效 | 重置 peakOBVSlope + 結算日暫停 P3/P4 |

## v9.0 變更摘要（2026-03-23）
- 進場：三閘門（價格+量能+環境）
- 出場：四層優先級 + Carry-Over
- Regime Filter：Bridgewater 三層環境篩選（11 個 security）
- Dashboard：6+1 區塊
- 敏感度測試：6 項 input 預留不接邏輯
