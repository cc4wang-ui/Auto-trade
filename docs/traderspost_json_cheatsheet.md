# TradersPost Webhook JSON Cheatsheet

Schema 抓自 TradersPost 官方 docs（2026-04-28 verified）。切 live 前再 fetch 一次。

Sources:
- https://docs.traderspost.io/docs/core-concepts/signals/webhooks
- https://github.com/TradersPost/docs/blob/main/core-concepts/webhooks.md

---

## Required fields

| Field | Type | Notes |
|---|---|---|
| `ticker` | string | IB symbol。stocks: `SOFI`、options: `SPY 240510C68`、futures: `MNQU2025`、crypto: `BTCUSD`。本專案用 `{{ticker}}` 動態填入。|
| `action` | enum | `buy` / `sell` / `exit` / `cancel` / `add`。put options 時 action 反向。|

## Core optional fields

| Field | Type | Allowed values / notes |
|---|---|---|
| `sentiment` | enum | `bullish` (= `long`) / `bearish` (= `short`) / `flat`。trade 後預期持倉狀態。|
| `signalPrice` 或 `price` | number | 訊號觸發當下市價，用來算 slippage / relative SL/TP。|
| `quantity` | number | 數量；省略 = 1。出場若省略 = 出全部部位。|
| `quantityType` | enum | `fixed_quantity` (default) / `dollar_amount` / `risk_dollar_amount` / `risk_percent` / `percent_of_equity` / `percent_of_position`。本專案用 `risk_dollar_amount`。|
| `orderType` | enum | `market` / `limit` / `stop` / `stop_limit` / `trailing_stop`。本專案用 `market`。|
| `limitPrice` | number | limit / stop_limit entry 用。|
| `stopPrice` | number | stop / stop_limit entry 用。|
| `trailAmount` | number | $ 距離（trailing_stop entry）|
| `trailPercent` | number | % 距離（trailing_stop entry）|
| `timeInForce` | enum | `day` / `gtc` / `opg` / `cls` / `ioc` / `fok`。本專案用 `day`。|
| `extendedHours` | bool | 盤前盤後（本專案 false）|
| `interval` | string | 圖表時間框（佐證用）|
| `time` | string | 訊號時間 ISO8601 |
| `delay` | number | 延遲秒數執行 |
| `cancel` | bool | 取消既有 open orders |
| `cancelOrderType` | string | 限定取消的單型（如 `stop`）|
| `ignoreTradingWindows` | bool | 忽略 strategy 設的交易時段 |
| `extras` | object | 自訂 metadata，TP 會原樣記在 activity log。本專案塞 pattern / quality / rr。|

## `takeProfit` object（三選一）

| Field | Notes |
|---|---|
| `limitPrice` | 絕對 limit price（本專案用這個）|
| `percent` | 進場價的相對百分比 |
| `amount` | 進場價的相對美元 |

## `stopLoss` object

| Field | Notes |
|---|---|
| `type` | `stop` / `stop_limit` / `trailing_stop` |
| `stopPrice` | 絕對 stop price（本專案用這個）|
| `percent` | 相對百分比 |
| `amount` | 相對美元 |
| `limitPrice` | stop_limit 才用 |
| `trailAmount` | trailing_stop 才用 |
| `trailPercent` | trailing_stop 才用 |

---

## 本專案標準 payload（snippet 產出的 JSON）

進場（long）：
```json
{
  "ticker": "SOFI",
  "action": "buy",
  "orderType": "market",
  "quantityType": "risk_dollar_amount",
  "quantity": 25,
  "stopLoss": {"type": "stop", "stopPrice": 14.50},
  "takeProfit": {"limitPrice": 17.00},
  "signalPrice": 15.50,
  "timeInForce": "day",
  "extras": {
    "pattern": "Inverted H&S",
    "quality": 78,
    "rr": 1.67,
    "interval": "60"
  }
}
```

TradersPost 收到後動作：
1. `risk_dollar_amount` $25 ÷ (entry $15.50 - stop $14.50) = 25 股
2. 送 IB：buy 25 SOFI @ market
3. 成交後自動掛 OCO bracket：sell 25 stop @ 14.50 + sell 25 limit @ 17.00（哪邊先到取消另一邊）

---

## 其他常用 payload 範例

### 完全市價出場（緊急平倉）

```json
{
  "ticker": "SOFI",
  "action": "exit",
  "sentiment": "flat"
}
```

### 部分出場（出 1 半）

```json
{
  "ticker": "SOFI",
  "action": "exit",
  "quantityType": "percent_of_position",
  "quantity": 50
}
```

### 取消所有未成交 stop orders（保留 entry/target）

```json
{
  "ticker": "SOFI",
  "action": "cancel",
  "cancelOrderType": "stop"
}
```

---

## 常見錯誤對照

| 症狀 | 原因 |
|---|---|
| TP 回 "ticker required" | JSON 缺 ticker 或 ticker 是空字串 |
| TP 回 "invalid action" | action 拼錯（注意是 `buy` 不是 `BUY`）|
| Quantity 永遠是 1 | quantityType 沒設或設成 `fixed_quantity` 而 quantity 沒填 |
| Risk-based sizing 回 0 股 | stopPrice == entry（risk distance = 0），或 stopPrice 方向錯 |
| Bracket 沒掛 | strategy 設定的 Bracket Orders 沒打開，或 JSON 缺 stopLoss/takeProfit |
| 收到但 IB 不下單 | broker connection 斷線（重新 OAuth）或 asset class 不對 |
