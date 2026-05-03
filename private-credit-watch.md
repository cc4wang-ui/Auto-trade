# 私人信貸危機監控 — Private Credit Watch

## 最後更新：2026-04-30

> 整合進 v10 期貨做空訊號架構。私人信貸危機是觸發 SHOCK / CRISIS regime 的潛在路徑。
> 殖利率衝擊 → BDC NAV markdown → redemption gates → HY spread 跳升 → 同步性升溫 → TXF1! 做空窗口

-----

## 一、為什麼納入監控

### 規模 + 不透明度

- 市場規模：$2.1 trillion（BlackRock 估 2030 翻倍）
- 不透明：私下定價、quarterly internal NAV、無 daily mark-to-market
- 槓桿黑箱：First Brands 表面 5x 實際 20x
- 評等通膨：私人評級機構商業壓力給高分

### 已知結構性問題

- 雙重抵押欺詐：Tricolor + First Brands + HPS（BlackRock 旗下）電信案
- AI 顛覆 SaaS 風險：Apollo BDC 軟體曝險 12%、直接借貸軟體曝險 ~26%
- Refinance 牆：2026-2027 LBO 高峰
- Redemption pressure：Ares、Apollo、Blue Owl、Cliffwater、Blackstone BCRED 全部限贖

-----

## 二、五大監控指標（整合進 dashboard）

### 1. HY 信用利差（FRED:BAMLH0A0HYM2）— 最關鍵

|區間          |燈號     |對 v10 影響                 |
|------------|-------|-------------------------|
|< 3.0%      |🟢 正常   |無影響                      |
|3.0-3.5%    |🟡 偏緊   |加強觀察                     |
|3.5-4.5%    |🟠 信用壓力 |同步性權重 +5                 |
|> 4.5%      |🔴 信用危機 |**同步性自動 +10**，可能觸發 CRISIS|
|一週跳升 > 100bp|🔴🔴 急性事件|立即推到 CRISIS regime       |

### 2. VIX 期限結構（CBOE:VIX vs CBOE:VIX3M）

- Contango（VIX < VIX3M）：恐慌會消退 = 正常
- Backwardation（VIX > VIX3M）：恐慌不會消退 = 警示
- Deep Backwardation（VIX > VIX3M × 1.1）：HALT regime → **不交易**

### 3. 同步性指數（Module 2）

|區間   |燈號    |對 v10 影響                               |
|-----|------|---------------------------------------|
|< 50 |🟢 正常  |無影響                                    |
|50-70|🟡 升溫  |WARNING regime → confirmBars +1        |
|> 70 |🔴 系統風險|CRISIS regime → 部位 50% + confirmBars +2|

### 4. BDC NAV Watch（手動季度檢查）

每季財報後檢查前 5 大 BDC：

- Apollo Debt Solutions BDC（軟體曝險 >12%）
- Blue Owl Capital
- Ares Strategic Income Fund
- Blackstone BCRED
- Cliffwater

**警示閾值**：任一 BDC 單月 NAV -3%+ = 重大訊號

### 5. 主要事件 trigger

- 新「蟑螂」事件（雙重抵押欺詐、receivables 假帳）
- 大型 BDC 限贖比率 > 10%
- 銀行對 NDFI 揭露擴大（regulatory pressure）
- Fed 提到「private credit」(過往從未提及)

-----

## 三、信貸危機 → TXF1! 做空傳導路徑

```
1. 5/13 Core CPI > 3.3%
   ↓
2. 殖利率衝 4.6%+，SOFR 跟漲
   ↓
3. 中型企業 ICR 從 2.3 跌破 2.0
   ↓
4. 某大型 BDC 季底 NAV markdown -3%
   ↓
5. Redemption gates 大量觸發
   ↓
6. HY spread 跳升 +100bp
   ↓
7. 同步性 > 70 → CRISIS regime
   ↓
8. TXF1! 跌破下軌 + Volume Spike → 三閘門觸發
   ↓
9. 做空進場（CRISIS 規則：50% 部位 + confirmBars+2）
```

-----

## 四、整合進 v10 Regime Filter

### Regime 規則更新（基於私人信貸壓力）

|現有 Regime|條件               |私人信貸補強                  |
|---------|-----------------|------------------------|
|HALT     |VIX 深度倒掛 >1.1    |+ HY spread 一週 >100bp 跳升|
|SHOCK    |2Y ROC >10%      |+ 大型 BDC 限贖 >10%        |
|CRISIS   |同步性>70 OR VIX 倒掛 |+ HY spread > 4.5%      |
|WARNING  |同步性>50 OR 穩定度<40%|+ HY spread 3.5-4.5%    |
|NORMAL   |正常               |HY < 3.5%               |

### Pine Script 補強建議（待 v10 加入）

```pine
// 私人信貸壓力指標
hy_credit_pressure = hy_spread_val > 4.5 ? "CRISIS" : 
                     hy_spread_val > 3.5 ? "WARNING" : 
                     hy_spread_val > 3.0 ? "ELEVATED" : "NORMAL"

// 一週跳升偵測
hy_weekly_jump = hy_spread_val - hy_spread_val[5]  // 5 個交易日（一週）
hy_acute_event = hy_weekly_jump > 1.0  // 100bp 跳升

// 整合進 regime
if hy_acute_event
    regime := "CRISIS"  // 強制升級
```

-----

## 五、14 天監控時程

|日期           |事件        |信貸危機指標關注                    |
|-------------|----------|----------------------------|
|**5/1 (五)**  |NFP       |殖利率反應 → SOFR 連動             |
|**5/13 (二)** |CPI       |鷹派 vs 鴿派 → 信貸成本走向           |
|**5/14 (三)** |PPI       |二次通膨 → 殖利率持續壓力              |
|**5/15 (五)** |Powell 任期到|政策不確定性 → HY spread          |
|**5 月底-6 月初**|Q1 BDC 財報季|Apollo / Blue Owl / Ares NAV|
|**6 月中**     |FOMC      |easing bias 是否刪除            |
|**6 月底**     |Q2 季底     |第一批可能 markdown              |
|**7 月底**     |Q2 BDC 財報 |真正壓力浮現                      |

-----

## 六、判讀框架（給 Claude 自動 surface 用）

每次對話開始時，如果以下任一條件成立 → 主動 surface 警示：

- HY spread > 3.5%
- HY spread 一週跳升 > 50bp
- 任何前 5 大 BDC 出現 NAV 重大事件
- 新「蟑螂」case 浮現（雙重抵押 / 假 receivables）
- 同步性 > 65（接近 CRISIS）
- VIX 期限結構出現倒掛

警示格式：

```
🔴 私人信貸警示（YYYY-MM-DD）
- 觸發指標：XXX
- 當前值：XXX vs 閾值 XXX
- 對 v10 regime 影響：NORMAL → WARNING / CRISIS
- 對 TXF1! 做空意義：XXX
- 建議行動：XXX
```

-----

## 七、為什麼還沒大規模恐慌（防火牆機制）

供 Claude 判讀「危機真假」用：

1. **沒有 mark-to-market** — 估值內部 quarterly，不像股票每秒定價
1. **Redemption gates** — 強制限贖把恐慌「凍結」
1. **長期 lock-up** — PE/私人信貸基金 7-10 年鎖定，無擠兑機制
1. **風險集中大行** — JPM 能吸收，區域銀行壓力但未崩
1. **AI capex 敘事** — GDP 預期樂觀抵銷違約恐慌

**判讀含義**：恐慌「凍結」≠ 不存在。任一防火牆失效都是 trigger。

-----

## 八、歷史類比（INTJ 視角）

|維度   |2007 年中               |2026 年中                      |
|-----|----------------------|-----------------------------|
|主要案例 |Bear Stearns 對沖基金     |First Brands + Tricolor + HPS|
|規模   |Subprime ~$1.3T       |私人信貸 $2.1T                   |
|透明度  |CDO 不透明               |BDC NAV 不透明                  |
|估值機制 |模型估值                  |內部 quarterly                 |
|主流意見 |「太小，不系統性」             |「idiosyncratic，不是系統」         |
|央行警告 |不明顯                   |BoE Bailey 公開警告              |
|距離大爆發|14 個月（→ 2008/9 Lehman）|待觀察                          |

**當前位置 ≈ 2007 年 6-8 月**。下一個 trigger 是「BDC 出 Bear Stearns 等級事件」。
