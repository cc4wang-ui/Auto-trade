# TradingView 數據源對照表

## 目前使用中（v2.0，共 13 個 request.security）

| 用途 | 主要 Symbol | 備用 Symbol | 備註 |
|------|------------|-------------|------|
| 美國 10Y 殖利率 | `TVC:US10Y` | `FRED:DGS10` | TVC 更即時 |
| 美國 2Y 殖利率 | `TVC:US02Y` | `FRED:DGS2` | |
| S&P 500 | `SP:SPX` | `FOREXCOM:SPX500` | SP:SPX 較可靠但部分帳號沒有 |
| Fed Funds Rate | `FRED:DFF` | 用 2Y 近似 | 有延遲，v1.2 新增 |
| 通膨損益平衡率 | `FRED:T10YIE` | 無（用油價替代） | 部分帳號無法取得 |
| 美元指數 | `TVC:DXY` | `CURRENCYCOM:DXY` | |
| WTI 原油 | `TVC:USOIL` | `NYMEX:CL1!` | |
| 黃金 | `TVC:GOLD` | `COMEX:GC1!` | |
| 台灣加權 | `TVC:TWII` | `TWSE:TAIEX` | |
| VIX | `CBOE:VIX` | `TVC:VIX` | |
| 銅期貨 | `COMEX:HG1!` | `CAPITALCOM:COPPER` | v2.0 新增 |
| VIX 3個月 | `CBOE:VIX3M` | 用 VIX 本身 | v2.0 新增 |
| 高收益利差 | `FRED:BAMLH0A0HYM2` | 跳過信用判斷 | v2.0 新增，延遲1-2天 |

## 剩餘額度
40 - 13 = 27 個 request.security 可用於後續模組

## 未來可能新增
| 用途 | Symbol | 模組 |
|------|--------|------|
| 美國 3M 殖利率 | `TVC:US03MY` | Module 3（波動率） |
| 台指期 | `TAIFEX:TXF1!` | Module 3-6 |
| 銅 | `COMEX:HG1!` | 成長指數加強 |
| 半導體指數 | `NASDAQ:SOX` | 台股相關性 |

## FRED 數據注意事項
- 更新頻率：大多為每日，但有 1-2 天延遲
- 歷史數據：通常可回溯數十年
- 假日：美國假日無數據，Pine Script 會用前一日收盤
