# Cross 下一步 — 4 個動作（總時間約 30 分鐘）

> 寫於 2026-05-05。Phase A-D + Phase E2 已由 Claude 完成。剩 Cross 親自操作的 4 件事。

## 進度快照

| Phase | 內容 | 狀態 |
|---|---|---|
| A | Auto-trade 內部 reorg | ✅ merged (PR #15) |
| B | 9 個 open PR 留 migration comment | ✅ done |
| C | Master plan 文件 | ✅ `docs/dispatch-extract-bot-repo.md` |
| D | Hardcoded 字串 audit | ✅ 0 hits |
| E1 | 建空 repo (telegram-trade-bot, mikai-youtube-etl) | ✅ Cross 已建 |
| E2 | 建 extraction branches | ✅ pushed |
| **E3** | **接收端 push（兩個新 sessions）** | ⏳ Cross 起 sessions |
| **E3.5** | **transfer playwrightbot + Kirby（web UI）** | ⏳ Cross |
| E4 | Auto-trade 收尾、close PRs、刪 branches | ⏳ 等 E3 完成 |
| F | claude-templates submodule | ⏳ E4 之後 |

---

## ① Telegram bot 接收（10-15 分鐘）

**動作：** 開 Claude Code Web session 在 `cc4wang-ui/telegram-trade-bot`

**貼這段 prompt：**

```
你被開在剛建好的空 repo: cc4wang-ui/telegram-trade-bot。

任務：接收從 cc4wang-ui/Auto-trade 拆出來的 Telegram bot 服務內容。

來源 branch: extract/telegram-bot @ cc4wang-ui/Auto-trade
完整指引：那 branch 根目錄的 MIGRATION-MANIFEST.md

執行流程：
1. git clone --branch extract/telegram-bot --single-branch https://github.com/cc4wang-ui/Auto-trade.git /tmp/source
2. 跑 manifest 裡的 audit grep
3. 把 /tmp/source 的 gas/ prompts/ docs/ skills/ 複製到當前 repo 根
4. 用 manifest 裡建議的 CLAUDE.md / README.md 模板，建本 repo 的 CLAUDE.md 和 README.md
5. 加 .gitignore（manifest 裡有範本）
6. git commit + git push origin main
7. 開 draft PR 給 Cross review

完成後在這個 session 回報：
- 哪些 source PR 對應這個 destination PR（#2, #5, #6, #13）
- 是否有任何意外的 audit hit

不要做的：
- 不要拉 pine/、context/、或 strategy 相關文件
- 不要修改 source branch（read-only）
```

**完成後：** Cross 看 destination PR 沒問題就 merge。

---

## ② mikai YouTube ETL 接收（10-15 分鐘）

**動作：** 開 Claude Code Web session 在 `crosswang-collab/mikai-youtube-etl`

**貼這段 prompt：**

```
你被開在剛建好的空 repo: crosswang-collab/mikai-youtube-etl（17LIVE 工作 org）。

🔴 SENSITIVE：這是工作 org，禁止帶入任何個人交易/財務內容。
若 source branch audit fail 或發現意外的 trading content，立即停止並回報。

任務：接收從 cc4wang-ui/Auto-trade 拆出來的 YouTube ETL 服務內容。

來源 branch: extract/mikai-youtube-etl @ cc4wang-ui/Auto-trade
完整指引：那 branch 根目錄的 MIGRATION-MANIFEST.md

執行流程：
1. git clone --branch extract/mikai-youtube-etl --single-branch https://github.com/cc4wang-ui/Auto-trade.git /tmp/source
2. 跑 manifest 裡的雙重 audit:
   grep -r -i "cross-financial|hedge|private-credit|strategy_v10|TXF1|台指期|macro_score|TradersPost" /tmp/source/youtube-etl/
   應該 0 hit。任何 hit → 停止 + 回報。
3. 把 /tmp/source/youtube-etl/* 複製到當前 repo 根（保留 youtube-etl/ 子目錄結構）
4. 用 manifest 裡建議的 CLAUDE.md（mikai 工作版本，無個人 context）建 CLAUDE.md
5. 用 manifest 裡建議的 README.md 模板建 README.md（給 17LIVE 同事看的）
6. 加 Python .gitignore（manifest 裡有範本）
7. git commit + git push origin main
8. 開 draft PR 給 Cross review

完成後回報：
- audit 結果
- destination PR URL
- 對應 source PR：#3, #4, #14
```

**完成後：** Cross 看 destination PR 沒問題就 merge。

---

## ③ Transfer playwrightbot（web UI，2 分鐘）

**動作：** GitHub web UI 直接 transfer，不需要 Claude

1. https://github.com/cc4wang-ui/playwrightbot/settings
2. 滑到最底 → **Danger Zone** → **Transfer ownership**
3. New owner: `crosswang-collab`
4. 確認 repo 名稱輸入 `playwrightbot`
5. Click Transfer

**Transfer 完之後（在 crosswang-collab 改名）：**

6. https://github.com/crosswang-collab/playwrightbot/settings
7. General → Repository name → 改成 `mikai-jobcan-bot`
8. Click Rename

GitHub 會自動 redirect 舊 URL，**不會破壞既存 git clone**（只要 `git remote set-url` 一下）。

---

## ④ Transfer Kirby-transition-plan（web UI，1 分鐘）

**動作：** 同上

1. https://github.com/cc4wang-ui/Kirby-transition-plan/settings
2. Danger Zone → Transfer ownership
3. New owner: `crosswang-collab`
4. 確認 repo 名稱輸入 `Kirby-transition-plan`
5. Click Transfer

不需要改名（保留 `Kirby-transition-plan`）。

---

## 我（Claude，本 session）做不了什麼、為什麼

| 動作 | 原因 |
|---|---|
| 開那 2 個新 Claude Code Web sessions | 必須由 Cross 在 web UI 開（每個 session bind 一個 repo） |
| 直接把 extraction branch 內容 push 到 telegram-trade-bot / mikai-youtube-etl | 我的 GitHub MCP scope 鎖在 `cc4wang-ui/Auto-trade` 一個 repo |
| Transfer playwrightbot / Kirby | 需要 admin 權限的 web UI 操作；MCP 沒 transfer API |

→ 接手 sessions 跑完，回到這個 session（或新開 follow-up session 在 Auto-trade）做 Phase E4 收尾（close PRs + 刪 branches）。

---

## 驗收 checklist（4 件做完後 Cross 要看的）

- [ ] `cc4wang-ui/telegram-trade-bot` main 有 7 個檔案 + CLAUDE.md + README.md
- [ ] `crosswang-collab/mikai-youtube-etl` main 有 39 個 youtube-etl 檔案 + CLAUDE.md + README.md，audit 0 hit
- [ ] `crosswang-collab/mikai-jobcan-bot`（從 playwrightbot rename）存在
- [ ] `crosswang-collab/Kirby-transition-plan` 存在
- [ ] `cc4wang-ui/Auto-trade` 的 9 個 open PR 還在（暫不關，等 destination 準備好再 close）

驗收完跟我說「都好了」，我做 Phase E4（close 7 個 migrate-target PR、刪 source branches、刪 extraction branches）+ Phase F（claude-templates submodule）。
