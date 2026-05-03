# Warsh 貨幣政策失敗路徑分析

## 學術窮盡視角 + 不可控變數監控

> **建立日期**：2026-05-03
> **適用期間**：2026/5/15 Warsh 上任後 → 2027 Q4
> **核心命題**：Warsh 計畫成功機率約 25%，因為他只能直接控制 12 個關鍵變數中的 2 個

-----

# Part I：學術七框架失敗路徑

## 框架 1：Tinbergen Rule — 工具不足定理

### 核心定理

> N 個獨立政策目標需要 N 個獨立政策工具。
> 目標數 > 工具數 → 數學上無法同時達成。

### Warsh 的目標 vs 工具

**目標數 = 7**：通膨 2%、降房貸利率、維持就業、重建 credibility、滿足白宮、縮表 6T→4T、美元穩定

**工具數 = 2**：Fed Funds Rate + Active QT

**結論**：結構性失敗。

### 失敗模式 1.1 — Goal Displacement Cascade

工具不足時，央行被迫犧牲某些目標來達成另一些。預期犧牲順序：

- 最優先：滿足白宮壓力（短端降息）→ **犧牲通膨控制**
- 次優先：縮表（重建可信度）→ **犧牲長端利率穩定**
- 被犧牲：30Y 房貸利率 → 因 QT 推高長端

**12 個月觸發機率**：70%

-----

## 框架 2：Sims FTPL — 財政主導

### 核心定理（Sims 2011）

通膨不只是貨幣現象，更是**財政現象**。當 debt/GDP 超過閾值，貨幣政策被 fiscal dominance 吸收。

### 當前美國基本面

- 政府債務 / GDP > 130%
- 2026 赤字預估 7-8% GDP
- 30Y yield 4.97% 已 priced in 長期通膨

### 失敗模式 2.1 — Fiscal Dominance Trap

- 短端降息 → 名目利率下降
- Active QT → 長端供給增加 → term premium 升
- 30Y > 5.5% 持續 → 政府利息支出 / 稅收突破閾值
- 市場質疑 Fed 是否被迫退讓
- **預期通膨自我實現** → 實際通膨上升

**12 個月觸發機率**：30%（衝擊極高）

### 失敗模式 2.2 — Active QT 的 Fiscal Backfire

- Fed 賣長債 → 私人部門必須吸收 → term premium +50-100bp
- 政府年增加利息支出 ~$300-600B
- 財政部被迫縮短發行期限 → 短期利息上升 → 抵銷降息

**12 個月觸發機率**：50%

-----

## 框架 3：Brunnermeier-Sannikov 金融加速器

### 核心定理

金融中介資產負債表受壓 → 非線性放大效應。"Volatility paradox"：表面平靜時積累系統風險。

### 失敗模式 3.1 — SVB 2.0

- Active QT 推高長端 → 銀行 HTM 浮虧
- 區域銀行 capital ratio 跌至紅線
- 一個 trigger → 擠兌 → Fed 緊急停 QT 重啟 QE
- **Credibility 完全崩盤**

**12 個月觸發機率**：45%（衝擊極高）

### 失敗模式 3.2 — Repo Plumbing Crisis

2019/9 重演。Active QT > Passive QT 激進度。

**12 個月觸發機率**：35%
**監控指標**：銀行準備金/GDP < 8%、SOFR-IORB > 5bp、ON RRP 餘額枯竭

-----

## 框架 4：Mundell-Fleming + Triffin Dilemma

### 核心定理

Impossible Trinity：固定匯率 + 自由資本流動 + 獨立貨幣政策 → 三選二。
Triffin (1960)：reserve currency 提供全球流動性 vs 維持 credibility 的內在矛盾。

### 失敗模式 4.1 — 外資需求崩盤

- US Treasuries 30% 海外持有（中、日、英）
- Active QT + 外資同時賣 = double-supply shock
- 30Y 衝破 5.5% → 抵押品全面 repricing

**12 個月觸發機率**：25%

### 失敗模式 4.2 — 美元信任危機

- QT 過快 → 短期美元飆 → 表面勝利
- 同時降息 → 真實利率下降 → 中長期美元貶值
- BRICS、CBDC、黃金多元化加速

**12 個月觸發機率**：20%（不可逆）

-----

## 框架 5：Krugman-Eggertsson Forward Guidance

### 核心定理

Krugman (1998)：流動性陷阱下降息無效。
Kydland-Prescott (1977)：央行宣告 vs 行動不一致 → credibility 自我毀滅。

### 失敗模式 5.1 — Time Inconsistency Trap

Warsh 同時 commit：

- 短端持續降息
- Active QT 直到 balance sheet < $4T
- 通膨 2%

**三個 commitment 在路徑上相互矛盾**。

第一次 dovish pivot = credibility 崩盤。

**12 個月觸發機率**：65%

-----

## 框架 6：Kindleberger-Minsky 金融不穩定假說

### 核心定理

Minsky 5 階段：Displacement → Boom → Euphoria → Profit-taking → Panic。
當前位置：第 3-4 階段交界。

### 失敗模式 6.1 — Private Credit Cascade

- Active QT → SOFR 推高
- LBO ICR 跌破 1.5x covenant
- BDC NAV markdown -3 to -5%
- Redemption gates 法律訴訟
- HY spread +200bp → 同步性 > 75 → CRISIS regime

**12 個月觸發機率**：40%（衝擊極高）

### 失敗模式 6.2 — Stock-Bond Correlation Breakdown

- 短端降息 → 股市初期歡呼
- Active QT 推高長端 → DCF 折現率上升 → 高估值股壓
- 通膨預期升 → 債市跌
- **股債同跌**（2022 重演）

**12 個月觸發機率**：50%

-----

## 框架 7：Acemoglu-Robinson 制度理論

### 核心定理

Inclusive vs Extractive institutions → 政策成敗。Fed 獨立性是 inclusive institution 核心。

### 失敗模式 7.1 — Institutional Capture Perception

市場感覺 Fed 已被政治綁架：

- 長端 yield 永久性 term premium +100-150bp
- 美元儲備地位被質疑
- **不可逆的 credibility loss**

**12 個月觸發機率**：30%

### 失敗模式 7.2 — FOMC 公開分裂

4/29 已 4 dissenters（自 1992 來最多）。Warsh 上任後：

- Powell 留 Board 持續投反對
- 5-7 票分裂常態化
- 歷史先例：1979 Volcker 上任前夕

**12 個月觸發機率**：80%

-----

## 失敗模式機率矩陣

|#  |失敗模式                  |機率 |衝擊 |預期觸發點 |早期訊號            |
|---|----------------------|---|---|------|----------------|
|1.1|Goal Displacement     |70%|中  |上任 3 月|FOMC 投票分裂       |
|2.1|Fiscal Dominance Trap |30%|極高 |6-12 月|30Y > 5.5% 持續   |
|2.2|Treasury 縮短發行         |50%|高  |6 月   |TBAC 公布         |
|3.1|SVB 2.0               |45%|極高 |6-9 月 |區域銀行 HTM 跳水     |
|3.2|Repo Crisis           |35%|極高 |任何    |SOFR-IORB > 10bp|
|4.1|外資需求崩盤                |25%|高  |9-12 月|TIC 連 3 月淨賣     |
|4.2|美元信任危機                |20%|極高 |> 12 月|DXY < 92 持續     |
|5.1|Time Inconsistency    |65%|高  |3-6 月 |第一次 dovish pivot|
|6.1|Private Credit Cascade|40%|極高 |6-9 月 |HY > 4.5%       |
|6.2|Stock-Bond 正相關        |50%|高  |任何    |60/40 月跌 -3%    |
|7.1|Institutional Capture |30%|不可逆|立即    |term premium 跳升 |
|7.2|FOMC 公開分裂             |80%|中  |立即    |dissent ≥ 3 票   |

-----

## 複合情境機率

|情境                             |機率 |路徑             |市場特徵                  |
|-------------------------------|---|---------------|----------------------|
|**A. Soft Stagflation Loop**   |35%|1.1 → 5.1 → 6.2|12-18 月 U-turn，盤整下行   |
|**B. Repo + Private Credit 雙雷**|25%|3.1 + 6.1      |6 週內 SPX -20%，VIX > 35|
|**C. Fiscal Dominance Endgame**|15%|2.1 + 2.2 + 4.2|12 月慢燃，黃金 / BTC 主導    |
|**D. Smooth Success**          |25%|全部避開           |股市新高、yields 緩跌        |

-----

# Part II：12 個 Fed 不可控變數金字塔

> 失敗模式是「結果」。不可控變數是「原因」。
> Warsh 即使學術知識窮盡 7 個框架，也無法控制以下 10 個外部變數。

## 控制力 0/10 — 完全失控（Tier 1）

### 變數 1：地緣政治 / 戰爭

- 以伊衝突、台海危機、俄烏升級、北韓核試
- 決策者：外國領導人、軍事系統
- **對 Warsh 的殺傷**：油 +20% 一夜 → 通膨衝 → 降息劇本作廢

### 變數 2：天災 / 瘟疫

- 颶風、地震、瘟疫
- 決策者：自然界
- **對 Warsh 的殺傷**：COVID 級事件 = 24 小時內 QT 變 QE，credibility 歸零

### 變數 3：AI 革命速度

- AGI 出現、SaaS 全面崩盤、capex 泡沫破裂
- 決策者：OpenAI / Anthropic / Google 工程師
- **對 Warsh 的殺傷**：估值模型全面失效，所有預測錯位

-----

## 控制力 1-2/10 — 幾乎失控（Tier 2）

### 變數 4：白宮 / 國會財政

- 關稅、減稅、基建支出、軍事擴張
- 決策者：Trump、國會
- **對 Warsh 的殺傷**：QT $500 億/月 vs Treasury 發新債 $2,000 億/月 → QT 沒意義

### 變數 5：外國央行政策

- BOJ 放棄 YCC、PBoC 貶值人民幣、ECB 反向操作
- 決策者：外國央行
- **對 Warsh 的殺傷**：他的 Active QT 假設「私人吸收」，但外資同時賣 → 殖利率失控

### 變數 6：市場情緒 / 泡沫心理

- Meme stock 瘋狂、AI 泡沫破裂、crypto 恐慌
- 決策者：群眾心理
- **對 Warsh 的殺傷**：降息可能反而觸發 panic（「Fed 知道有事」）

-----

## 控制力 3-4/10 — 有限控制（Tier 3）

### 變數 7：科技顛覆 / 產業結構

- 電動車 vs 燃油車、雲端 vs 本地、量子 vs 加密
- 決策者：產業趨勢
- **對 Warsh 的殺傷**：GDP 模型基於過去結構，誤差大到政策錯位

### 變數 8：就業結構變化

- 年輕人失業率、labor force participation、AI 裁白領
- 決策者：經濟結構
- **對 Warsh 的殺傷**：用粗指標看細結構 → 藥開錯

-----

## 控制力 5-6/10 — 較有控制（Tier 4）

### 變數 9：銀行體系健康

- 監管權 + stress test + discount window
- **但只能事後反應**
- **對 Warsh 的殺傷**：6/10 控制力 vs 100/10 失敗成本 = 不對稱風險

### 變數 10：預期通膨

- 透過聲明、政策一致性緩慢塑造
- 需要多年累積，可一夜失去
- **對 Warsh 的殺傷**：他是 Powell 反面 → 預期立即不穩 → 沒 buffer

-----

## 控制力 7-8/10 — 高度控制（Tier 5）

### 變數 11：短期利率（Fed Funds Rate）

- 法律授權的核心工具
- **但仍非 100%**：FOMC 投票、market price-in、傳導 lag

### 變數 12：聯準會自己的資產負債表

- QT 速度、賣什麼資產、何時停止
- **但仍非 100%**：市場吸收能力、政治壓力、Fed 自身損益

-----

# Part III：對 Cross 投資決策的具體含義

## 短期（5/15 - Q3 2026）

- **三筆出清決策被學術驗證為正確**：情境 A+B+C 機率合計 75% → 防禦優先
- **量子計畫繼續延後**：credibility 重建前不加碼
- **TXF1! 做空訊號最強窗口**：情境 B（VIX > 35 + HY spread 跳升）

## 中期（Q4 2026 / 2027）

- **準備重新進場**：情境 A 結束時通常是好的進場點
- **避開**：商業房地產、私人信貸 ETF、區域銀行
- **超配**：黃金 / BTC（情境 C 最大受益者）、能源（情境 A 受益者）

## v10.2 監控指標升級建議

1. **30Y term premium**（NY Fed ACM model）
1. **SOFR-IORB spread**（Repo 早期警訊）
1. **TIC 外資 net flow**
1. **FOMC dissent count**
1. **ON RRP balance**（流動性枯竭警示）

-----

# Part IV：監控規則（Claude 自動執行）

詳見 `uncontrollable-monitor.md` — 包含 10 個外部變數的具體閾值與 surface 觸發條件。

-----

## 結語

Warsh 的整個計劃只能控制 2 個變數（Tier 5），但會被 10 個變數影響。

不是因為他不聰明，而是 **policy mix coordination problem 的數學限制 + 不可控變數的結構性影響**。

學術視角的窮盡判斷：**成功機率 25%**。

最關鍵的監控時點：**Warsh 上任後第一次 FOMC + 第一份 CPI**（5/15 後 4-6 週內）。市場會測試 commitment，credibility 戰鬥會在那時開打。
