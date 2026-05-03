# Dispatch — v10.1 Pine 主檔工作 + 收尾驗證

> 給接手 session 的 Claude Code 用的 self-contained 規格。Cross 用遠端 dispatch 把這份工作跑完。
>
> **不要再問 Cross**——所有 context、規格、驗證、不要做的事都列在這。

---

## 0. 你接手的狀態

### Branch / PR
- Branch：`claude/telegram-bot-workflows-9Xsus`
- PR：#6（draft, open）— 已 push 9 個 commits 涵蓋 WF2-5 + v10.1 bot-side hooks + Pine WF3/WF5 整合
- 最新 commit：`a12d6b9` Fix P3-5 array.get out-of-bounds in zigzag pivot append

### 已完成（**不要重做**）
1. ✅ **WF2** — macro snapshot 加 `news_pulse` 4-6 條當日新聞，Telegram 渲染【今日新聞脈絡】
2. ✅ **WF3** — v10 訊號加 target / target_r 欄位，Telegram 顯示「目標: XXX (R:R = X.X)」
3. ✅ **WF4** — earnings summary 加 call_highlights / qa_highlights，Telegram【Call 重點】+【分析師 Q&A】
4. ✅ **WF5** — v10_state snapshot pipeline（Pine 推 → GAS sheet → Routine 撈），自動取得 D2/D3 取代手動進 TV
5. ✅ **v10.1 bot-side hooks** — GAS 已能接收 `credit_stress` / `regime` / `regime_upgrade_reason` / `hy_pressure_level` / `hy_weekly_jump` / `hy_acute_event`，Telegram 渲染【信用壓力】section + Regime 升級行
6. ✅ **strategy_v10.pine 整合** — WF3 target/target_r entry 拼接 + WF5 snapshot alert 末尾 + P3-5 zigzag pivot 修復

### 已部署（Cross 手動跑過）
- GAS：新版 `macro_snapshot_handler.gs` 已貼進 Apps Script + 5 mock test 全綠 + redeploy 完成
- TradingView：v10 strategy 已套含 WF3/WF5 + P3-5 fix 版本
- TradingView snapshot alert：⚠ Cross 正在 Phase 2.5 設定中（請**不要**動）
- Anthropic Routine prompt：⚠ Cross **還沒** 更新（請**不要**動，這是他要手動做的）

---

## 1. 你的工作（v10.1 Pine 主檔補強）

### 1.1 任務目標
把私人信貸壓力訊號整合進 v10 Regime Filter — **HY spread 急性升溫強制升級 regime** — 避免在信用危機形成期做多。

### 1.2 完整規格（必讀，以下是 source of truth）
規格本體已寫好，去讀以下任一個來源：

**主要來源**：
- 對話紀錄裡 Cross 給的「v10 補強任務 — 整合私人信貸壓力監控」spec（在這份 dispatch 之前的訊息）
- 如果 dispatch session 看不到對話紀錄，到 PR #6 的 description 看 v10.1 hooks 部分有完整欄位列表

**參考檔**（**讀完才能寫 code**）：
- `pattern-detector-pitfalls.md`（特別是 **P3-5**：array.get / 條件表達式陷阱 — 我剛剛在 strategy_v10.pine 撞到這個 bug，必須避免重蹈）
- `dev-guide.md`（Gotcha #1-32，v10 是 #27-32）
- `docs/strategy-v9.md` 或現有 v10 主檔（理解三閘門 + Regime Filter 架構）
- `private-credit-watch.md`（如果有）— Cross 提的私人信貸觀察筆記

### 1.3 必做事項（摘要 spec）

#### A. 新增 Pine input（給 Cross 可調）
```pine
group_credit = "═══ 私人信貸壓力 ═══"
hyWarnLevel    = input.float(3.5, "HY spread WARNING (%)", minval=2.0, maxval=6.0, step=0.1, group=group_credit)
hyCrisisLevel  = input.float(4.5, "HY spread CRISIS (%)",  minval=3.0, maxval=8.0, step=0.1, group=group_credit)
hyAcuteJump    = input.float(1.0, "急性跳升閾值 (%/週)",   minval=0.3, maxval=3.0, step=0.1, group=group_credit)
hyLookbackBars = input.int(5,    "週期 K 線數",            minval=3,   maxval=10,   group=group_credit)
```

#### B. 新增變數（在 Module 2 信用區塊之後）
- `hy_pressure_level`：N/A / NORMAL / ELEVATED / WARNING / CRISIS
- `hy_5d_ago` + `hy_weekly_jump`：用 `nz()` 包 `[5]` 索引
- `hy_acute_event`：`hy_weekly_jump > hyAcuteJump and not na(hy_spread_val)`
- `hy_force_crisis`、`hy_force_warning`：對 regime 的影響旗標

#### C. 修改既有 Regime Filter（**不要**刪除原邏輯，加 base + override）
```pine
string regime_base = vix_deep_backwardation ? "HALT" :
                     us2y_roc_extreme       ? "SHOCK" :
                     sync_index > sync_danger or vix_backwardation ? "CRISIS" :
                     sync_index > sync_warn or stability_low       ? "WARNING" :
                     "NORMAL"

string regime = regime_base
if hy_force_crisis and regime != "HALT" and regime != "SHOCK"
    regime := "CRISIS"
else if hy_force_warning and regime == "NORMAL"
    regime := "WARNING"

string regime_upgrade_reason = regime != regime_base ?
    (hy_acute_event ? "HY 急性跳升 +" + str.tostring(hy_weekly_jump, "#.##") + "%" :
     hy_pressure_level == "CRISIS" ? "HY 信用危機 (" + str.tostring(hy_spread_val, "#.##") + "%)" :
     "HY 信用壓力 (" + str.tostring(hy_spread_val, "#.##") + "%)") :
    ""
```

⚠ 注意 P3-5：上面這個 `?:` 巢狀 ternary **只用字串拼接**，無 array.get，不踩 P3-5。但**不要**把任何 `array.get` 放進類似的條件表達式 — 拆 nested if。

#### D. Dashboard 加【私人信貸壓力】區塊（在「綜合宏觀訊號」之前）
3-4 行：HY 等級 + 一週變化 + 升級原因（如果有）。用既有 `dash` table，行數預留檢查（Gotcha #5）。

#### E. Alert condition（選用，看 Pine 是否為 strategy）
- Indicator 版本：`alertcondition(hy_acute_event, ...)` + `alertcondition(hy_pressure_level == "CRISIS" and hy_pressure_level[1] != "CRISIS", ...)`
- Strategy 版本：用 `alert()` 函數，**不能** alertcondition（dev-guide.md Bug #2）

#### F. **新增 alert payload 欄位給 GAS**（Bot 端已 ready 接收）
找到既有的 `alert(snapMsg, ...)` snapshot 區塊（在檔案末尾）+ entry signal `alertMsg` 拼接（line ~643 / ~666），把這 6 個欄位加進 JSON：

```pine
'"regime":"' + (na(regime) ? "" : regime) + '",' +
'"regime_base":"' + (na(regime_base) ? "" : regime_base) + '",' +
'"regime_upgrade_reason":"' + (na(regime_upgrade_reason) ? "" : regime_upgrade_reason) + '",' +
'"hy_pressure_level":"' + (na(hy_pressure_level) ? "" : hy_pressure_level) + '",' +
'"hy_weekly_jump":' + str.tostring(na(hy_weekly_jump) ? 0.0 : hy_weekly_jump, "#.##") + ',' +
'"hy_acute_event":' + (na(hy_acute_event) ? "false" : (hy_acute_event ? "true" : "false")) + ',' +
```

3 個地方都要加：long entry、short entry、daily snapshot。

GAS 端已測 + 已部署，加完 Cross 直接看 Telegram【信用壓力】section 自動填值。

### 1.4 檔案規格

#### 改檔策略 — 直接改 strategy_v10.pine
- 規格說「開 v10.1 新檔案」，但**這份 dispatch 改變策略**：直接改 `strategy_v10.pine`（已是當前主檔），版本標 v10.1
- 理由：bot 端已對 v10.1 schema ready，分檔反而 Cross 要在 TV 切換麻煩；strategy 邏輯零改動（只加 regime 升級層）所以安全
- Cross 既有的 alerts 不用重設

#### 容量管理（**hard NO**）
- ❌ **不要新增** `request.security` — 既有 `hy_spread_val` 重用即可（line ~107 附近）。當前 13/40 容量，0 新增。
- ❌ **不要刪除** `regime_base` 變數（debug 顯示要用）
- ❌ **不要把 alert 邏輯放進 strategy** 用 alertcondition — 用 `alert()`

### 1.5 Pre-flight checklist（**按順序，不可跳**）

```
☐ 1. 讀 pattern-detector-pitfalls.md — 全部
☐ 2. 讀 dev-guide.md — Gotcha #1-32（v10 是 #27-32）
☐ 3. 讀 strategy-v9.md or 現有 v10 主檔 — 找到既有 regime 判定邏輯位置
☐ 4. 確認 hy_spread_val 變數位置（line ~107）+ dash table 結構
☐ 5. grep "regime" strategy_v10.pine 找出所有 regime 用法
☐ 6. 確認當前 strategy_v10.pine 是 949 行（含 WF3/WF5/P3-5 fix）
```

跳過任一步 → 高機率踩坑 → 不要 ship。

### 1.6 驗證（必做）

#### Pine 編譯 + validator
```bash
python3 validate_pine.py strategy_v10.pine
```
預期：警告 0 / 錯誤 0（除了 pre-existing safe_div noise）

#### TradingView 編譯 + dashboard 視覺驗證
- 載入 TXF1! 60min → ✅ Compiled
- Dashboard 出現「私人信貸壓力」區塊
- HY 等級顯示對應顏色（NORMAL=綠 / ELEVATED=黃 / WARNING=橙 / CRISIS=紅）
- 改 hyWarnLevel 從 3.5 → 2.0 → 等級立刻升 WARNING（驗證 input 連動）
- request.security 計數仍 13（**不能** 14）

#### 歷史回測驗證
| 期間 | HY spread 高峰 | 應觸發狀態 |
|---|---|---|
| 2020-03 (COVID) | ~10.9% | CRISIS + 急性跳升 |
| 2022-09 (Fed 鷹) | ~5.8% | CRISIS |
| 2023-03 (SVB) | ~5.2% | CRISIS |
| 2025-09 (Tricolor) | ~4.0% | WARNING + 短暫急升 |

任一期間沒觸發 → 邏輯有問題，重看條件閾值。

#### Bot 端整合驗證
- 在 TV 觸發一根 snapshot bar close（用 Bar Replay）
- 開 Google Sheet `v10_state` 分頁 → 看到 6 個新 column 都有值（regime / regime_base / regime_upgrade_reason / hy_pressure_level / hy_weekly_jump / hy_acute_event）
- 從 Apps Script 跑 `testReadV10State` → console 回傳含這 6 個 field

### 1.7 Ship 前自檢

```
☐ Pine validator 0 errors
☐ TV compile pass + Add to chart 過
☐ Dashboard 4 行 credit stress 區塊出現
☐ 4 期歷史回測全觸發
☐ request.security 仍 13
☐ snapshot + entry alertMsg 都加了 6 個 v10.1 欄位
☐ Sheet v10_state 收到完整資料
☐ commit message 含 "v10.1"
☐ push 到 claude/telegram-bot-workflows-9Xsus
```

任一項 ❌ → 不准 ship，回去 debug。

### 1.8 Commit / push 規格
```bash
git add strategy_v10.pine
git commit -m "Integrate HY credit stress regime upgrade (v10.1)"
git push -u origin claude/telegram-bot-workflows-9Xsus
```

⚠ **不要** 開新 PR，追加到 PR #6（draft）。

如果你也碰到其他 P3-5 / Gotcha → 同一個 commit 順手修，commit message 裡寫清楚。

---

## 2. 不要做的事（hard NO）

```
❌ 不要動 macro_snapshot_handler.gs（GAS 已部署完成）
❌ 不要動 macro_snapshot_prompt.md / pine_alert_webhook.md / 其他 docs（已 ship）
❌ 不要動 Anthropic Routine（Cross 自己會手動更新）
❌ 不要新增 request.security（容量紀律）
❌ 不要把 alert 邏輯放進 strategy 用 alertcondition（用 alert()）
❌ 不要寫「初版能跑後續再優化」的 code — 一次寫對
❌ 不要改 v10.0 既有的 strategy 退場邏輯（停損 / 拉回 / OBV 翻轉 / 時間止損）
❌ 不要碰 P3-5 已修復的 zigzag pivot block（line 317-348）— 那是 nested if pattern，不要還原成 or
```

---

## 3. 完成後跟 Cross 講

回報格式（≤ 200 字）：
1. commit hash
2. dashboard 截圖描述（哪行哪色）
3. 4 期回測結果表（觸發 / 不觸發 + HY 高峰時的 regime 升級邏輯）
4. v10_state sheet 是否收到 6 個新欄位的真實值
5. 已知 caveats（如果有）

**不要** report「我覺得應該可以」「初步看來」「之後可優化」 — 報結果，不報心理活動。

---

## 4. 預估時間

| 階段 | 時間 |
|---|---|
| Pre-flight 讀檔 | 15 min |
| 寫 Pine code（120 行 + 6 欄位 alert） | 35 min |
| Pine compile + validator | 5 min |
| TV dashboard 視覺驗證 | 5 min |
| 歷史回測 4 期 | 25 min |
| Bot 端整合驗證（sheet + read_v10_state） | 5 min |
| Commit + push + 回報 | 5 min |
| **總計** | **~95 min** |

超過 2 小時 → 停下來重看 pitfalls.md，可能踩到陷阱。

---

## 5. INTJ note from Cross

> 這次補強是**結構性盲點修補**。
> v9/v10 原本只看「市場是否已經恐慌」，沒看「信用市場是否在悄悄升溫」。
> 2007-2008 教訓：信用先動，股市才動，相差 12-14 個月。
> 我做空訊號要抓的就是這個窗口 — 信用悶燒期，但股市還沒崩。
> 不要為了求快省 verification。Ship 完這版，下次重大事件來時 dashboard 必須會閃紅燈。
> Cross 不 debug。Claude Code 不 ship 半成品。
