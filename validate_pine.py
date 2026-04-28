#!/usr/bin/env python3
"""
Pine Script 靜態檢查器
Claude 在產出 .pine 檔後執行此腳本，在使用者貼進 TradingView 之前攔截常見錯誤。
"""
import sys
import re
from pathlib import Path

def check_pine(filepath: str) -> list[str]:
    code = Path(filepath).read_text(encoding="utf-8")
    issues = []

    # 1. Version check
    if "//@version=5" not in code and "//@version=6" not in code:
        issues.append("❌ 缺少 //@version=5 或 //@version=6")

    # 2. Lookahead leak
    sec_calls = re.findall(r'request\.security\([^)]+\)', code)
    for call in sec_calls:
        if "lookahead" not in call:
            issues.append(f"❌ request.security 缺少 lookahead 參數: {call[:60]}...")
        elif "lookahead_on" in call:
            issues.append(f"⚠️ lookahead_on 可能造成未來數據洩露: {call[:60]}...")

    # 3. Count security calls
    sec_count = len(sec_calls)
    if sec_count > 35:
        issues.append(f"🔴 request.security 數量 {sec_count}/40 接近上限！")
    elif sec_count > 25:
        issues.append(f"🟡 request.security 數量 {sec_count}/40")

    # 4. Division safety
    divs = re.findall(r'[^_a-zA-Z]\/[^/=]', code)
    safe_divs = code.count('safe_div')
    if len(divs) > safe_divs + 5:
        issues.append(f"⚠️ 發現 {len(divs)} 處除法但只有 {safe_divs} 處用 safe_div，檢查是否有除零風險")

    # 5. NaN protection on correlation
    corr_calls = re.findall(r'ta\.correlation\([^)]+\)', code)
    for call in corr_calls:
        # Check if wrapped in nz() or math.abs(nz(...))
        call_pos = code.find(call)
        context = code[max(0, call_pos-10):call_pos]
        if 'nz(' not in context and 'nz(' not in code[call_pos:call_pos+len(call)+5]:
            issues.append(f"⚠️ ta.correlation 未用 nz() 包裹，可能產生 NaN")
            break  # Only warn once

    # 6. Table row overflow check
    table_new = re.findall(r'table\.new\([^)]+,\s*(\d+)\s*,\s*(\d+)', code)
    row_increments = code.count('row += 1')
    for match in table_new:
        max_rows = int(match[1])
        if row_increments > max_rows - 2:
            issues.append(f"⚠️ table 宣告 {max_rows} 行但使用了 ~{row_increments} 行，可能溢出")

    # 7. Dashboard readability: check for number+interpretation pattern
    table_cells = re.findall(r'table\.cell\([^)]+\)', code)
    if len(table_cells) > 20:
        # Spot check: are there interpretation labels?
        has_labels = any(label in code for label in ['擴張', '收縮', '升溫', '降溫', '偏多', '偏空'])
        if not has_labels:
            issues.append("⚠️ 儀表板可能只有數字沒有解讀標籤")

    if not issues:
        issues.append("✅ 所有檢查通過")

    return issues

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python validate_pine.py <path-to-pine-file>")
        sys.exit(1)
    
    results = check_pine(sys.argv[1])
    print(f"\n{'='*50}")
    print(f"Pine Script 檢查結果: {sys.argv[1]}")
    print(f"{'='*50}")
    for r in results:
        print(f"  {r}")
    print()
    
    has_errors = any(r.startswith("❌") for r in results)
    sys.exit(1 if has_errors else 0)
