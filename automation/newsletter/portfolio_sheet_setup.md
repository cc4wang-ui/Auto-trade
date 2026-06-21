# Portfolio Google Sheet — 設定指南

> 這個 Sheet 是電子報 + 即時網頁 dashboard 的**唯一資料來源**。
> 你只動「股數 / 成本」,股價、匯率、市值、損益全部 `GOOGLEFINANCE()` 自動算。

Sheet URL（Cross 個人帳號）：
`https://docs.google.com/spreadsheets/d/1Xm5KlGrv0eU6CX3i21wCk6FZPtc2XOwM75LmyJapLFE/edit`

---

## ⚠ 前置：讓自動化讀得到（一次性）

✅ **已完成**：sheet 已分享給 `crosswang@17.media`,自動化讀得到了。

> ⚠ 這個 sheet 目前裝的是舊的「盤前 Daily Post」內容(22 萬字元)。**不要覆蓋它**——
> 開一個新分頁(tab)叫 **`Portfolio`**,把下面的模板貼在新分頁,再把**那個分頁**發布為 CSV。
> routine 跟網頁都只讀這條 CSV,不碰整份 sheet(整份太大每天讀會爆)。

---

## 欄位設計（貼到 `Portfolio` 分頁 A1）

| 欄 | 標題 | 你填? | 內容 / 公式 |
|----|------|-------|------------|
| A | `代號` | ✅ | GOOGLEFINANCE 代號（見下表）|
| B | `名稱` | ✅ | 中文名 |
| C | `類別` | ✅ | Core / Satellite / 避險 |
| D | `股數` | ✅ | 持有股數 |
| E | `成本(原幣)` | ✅ | 平均成本 |
| F | `幣別` | ✅ | TWD / USD / HKD |
| G | `現價(原幣)` | 自動 | `=IFERROR(GOOGLEFINANCE(A2,"price"),"")` |
| H | `匯率→TWD` | 自動 | `=IF(F2="TWD",1,GOOGLEFINANCE("CURRENCY:"&F2&"TWD"))` |
| I | `市值TWD` | 自動 | `=D2*G2*H2` |
| J | `成本TWD` | 自動 | `=D2*E2*H2` |
| K | `損益TWD` | 自動 | `=I2-J2` |
| L | `損益%` | 自動 | `=IFERROR(K2/J2,"")` |
| N | `備註` | ✅ | 自由填 |

**操作**：填好 A–F 的 13 列後,在 **G2** 貼 G/H/I/J/K/L 六條公式,選 `G2:L2` 往下拉到第 14 列。完成。

---

## 你的 13 檔 — GOOGLEFINANCE 代號 + 起始值（取自 4/24 快照,自行修正）

| 代號(A) | 名稱(B) | 類別(C) | 股數(D) | 成本(E) | 幣別(F) |
|---------|---------|---------|---------|---------|---------|
| `TPE:2330` | 台積電 | Core | 1018 | 972 | TWD |
| `TPE:006208` | 富邦台50 | Core | 4545 | 100.7 | TWD |
| `TPE:2382` | 廣達 | Satellite | 2188 | 264.31 | TWD |
| `TPE:00632R` | 台灣50反1 | 避險 | 30000 | 13.33 | TWD |
| `00956`（手填價）| CTBC TOPIX | Satellite | 4308 | 37.0 | TWD |
| `HKG:1810` | 小米 | Satellite | 2200 | 54.88 | HKD |
| `HKG:9660` | Horizon Robotics | Satellite | 16800 | 6.59 | HKD |
| `QQQ` | Nasdaq-100 | Core | 38 | 345 | USD |
| `VOO` | Vanguard S&P500 | Core | 18 | 607 | USD |
| `VTI` | Total US Market | Core | 10 | 183 | USD |
| `NFLX` | Netflix | Satellite | 100 | 28.48 | USD |
| `NVDA` | NVIDIA | Satellite | 15 | 132 | USD |
| `IXC` | Global Energy | 避險 | 60 | 53.07 | USD |

> ⚠ **00956（CTBC TOPIX）**：GOOGLEFINANCE 沒有此自訂標的 → G 欄改成手動填現價,其他公式照算。
> ⚠ GOOGLEFINANCE 台股/港股價約延遲 15–20 分,給每日電子報足夠;網頁即時版同此精度。

---

## 資料流

```
Snowball App ─(更新股數/成本)─► Portfolio 分頁 ─(發布為 CSV)─┬─► 每早 routine 讀 CSV → 套模板 → Gmail
                                (GOOGLEFINANCE)               └─► Vercel 私密網頁讀 CSV → 隨時即時看
```

## 發布 Portfolio 分頁為 CSV（你做,一次性）

1. 點 **`Portfolio` 分頁**(確定停在這個 tab)
2. 檔案 → 共用 → **發布到網路**
3. 左邊下拉選 **`Portfolio`(不是整份文件)**,右邊選 **CSV**
4. 按「發布」→ 複製網址 → **貼給我**

這串網址不可猜但技術上公開可讀,**會含你的淨值** → 網頁前面我會加密碼保護(你選的方案)。
routine 也讀同一條 CSV,所以不碰整份 22 萬字的 sheet。
