#!/usr/bin/env python3
"""
市場快照產生器
Claude 在更新 market-context.md 時使用此模板確保格式一致。
用法：Claude 不直接執行此腳本，而是參考 TEMPLATE 結構來填入搜尋到的數據。
"""

TEMPLATE = """# Market Context — 近期市場狀態記錄

## 最後更新：{date}

### 原始數據快照
| 數據點 | 數值 | 趨勢 |
|--------|------|------|
| US 10Y | {us10y} | {us10y_trend} |
| US 2Y | {us02y} | {us02y_trend} |
| 殖利率曲線 | {yc} | {yc_type} |
| S&P 500 | {spx} | {spx_trend} |
| VIX | {vix} | {vix_trend} |
| WTI 原油 | {oil} | {oil_trend} |
| 黃金 | {gold} | {gold_trend} |
| DXY | {dxy} | {dxy_trend} |
| 台股加權 | {twii} | {twii_trend} |
| Fed Funds | {ff} | {ff_trend} |

### 關鍵事件
{events}

### 儀表板預估讀數
- 經濟相態：{phase}
- 成長指數：{growth}
- 通膨指數：{inflation}
- 同步性指數：{sync}
- 綜合評分：{score}
- 台股建議：{tw_stock}
- 台指期建議：{tw_fut}
- 美股建議：{us_stock}
"""

# 使用方式：Claude 搜尋完市場數據後，
# 參考此模板結構填入 memory/market-context.md
# 確保每次更新格式一致，方便後續對話快速解讀
