import os
import sys
import time
import json
import traceback
import smtplib
import shutil
import re
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import xml.etree.ElementTree as ET
import requests
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from playwright.sync_api import sync_playwright
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ==========================================
# 📧 Email Notification Credentials & Config
# ==========================================
EMAIL_SENDER = os.environ.get("ALERT_EMAIL_SENDER", "")
EMAIL_PASSWORD = os.environ.get("ALERT_EMAIL_PASSWORD", "")
EMAIL_RECEIVER = os.environ.get("ALERT_EMAIL_RECEIVER", "")

# ==========================================
# 🌐 Google Apps Script Config
# ==========================================
GAS_WEBAPP_URL = os.environ.get("GAS_WEBAPP_URL", "")
GAS_AUTH_KEY = os.environ.get("GAS_AUTH_KEY", "")

EXPORTS_DIR = os.path.abspath("exports")
os.makedirs(EXPORTS_DIR, exist_ok=True)

TARGET_URLS = {
    "CMRT": "https://b5.caspio.com/dp/0c4a30006f6c908f547e41cfa9bc",
    "EMRT": "https://c0eku224.caspio.com/dp/0c4a3000f851a3fe32a54dbcbd38",
    "AMRT": "https://c0eku224.caspio.com/dp/0c4a300001be9d377b74464d8a65",
    "REVISIONS": "https://b5.caspio.com/dp/0c4a3000a9ae96d4b36e406fa326",
    "ACTIVE": "https://www.responsiblemineralsinitiative.org/facilities-lists/export-all-active/",
    "CONFORMANT": "https://www.responsiblemineralsinitiative.org/facilities-lists/export-all-conformant/"
}

BASE_TITLE = "RMI Smelter Data Daily Sync"
DAILY_HARVEST_FOLDER_NAME = "RMI Smelter Sync_Daily Harvest"

UUID_PATTERN = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')

class DualLogger:
    def __init__(self, filepath):
        self.terminal = sys.__stdout__
        self.log = open(filepath, "w", encoding="utf-8")

    def write(self, message):
        self.terminal.write(message)
        self.terminal.flush()
        if self.log and not self.log.closed:
            self.log.write(message)
            self.log.flush()

    def flush(self):
        self.terminal.flush()
        if self.log and not self.log.closed:
            self.log.flush()

    def close(self):
        try:
            if self.log and not self.log.closed:
                self.log.close()
        except Exception:
            pass

def sanitize_traceback(tb_str: str) -> str:
    sanitized = re.sub(r'([A-Za-z]:\\[^:\n\r]+|\/[a-zA-Z0-9_\.\-]+(?:\/[a-zA-Z0-9_\.\-]+)+)', '[INTERNAL_FILE_PATH]', tb_str)
    sanitized = re.sub(r'(auth|password|key|token|secret)[\'"]?\s*[:=]\s*[\'"][^\'"]+[\'"]', r'\1: "***MASKED***"', sanitized, flags=re.IGNORECASE)
    return sanitized

def send_daily_email_report(subject: str, body_text: str):
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("\n⚠️ [Email Notification Skipped]: Missing email credentials.")
        return

    try:
        msg = MIMEMultipart()
        msg["From"] = f"RMI Smelter Sync Bot <{EMAIL_SENDER}>"
        msg["To"] = EMAIL_RECEIVER
        msg["Subject"] = subject
        msg.attach(MIMEText(body_text, "plain", "utf-8"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"\n📧 [Email Report Sent Successfully] Receiver: {EMAIL_RECEIVER}")
    except Exception as ex:
        print(f"\n❌ [Email Delivery Failed]: {ex}")

def cleanup_local_temp_files():
    if not os.path.exists(EXPORTS_DIR):
        return
    cleaned = 0
    for filename in os.listdir(EXPORTS_DIR):
        file_path = os.path.join(EXPORTS_DIR, filename)
        if os.path.isfile(file_path) and UUID_PATTERN.match(filename):
            try:
                os.remove(file_path)
                cleaned += 1
            except Exception:
                pass
    if cleaned > 0:
        print(f"🧹 [Auto-Cleanup] Cleaned {cleaned} temporary Playwright download file(s).")

def purge_all_local_exports():
    if not os.path.exists(EXPORTS_DIR):
        return
    deleted_count = 0
    for filename in os.listdir(EXPORTS_DIR):
        file_path = os.path.join(EXPORTS_DIR, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.remove(file_path)
                deleted_count += 1
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
                deleted_count += 1
        except Exception:
            pass
    if deleted_count > 0:
        print(f"🔒 [Security Complete] Cleaned {deleted_count} file(s) from local exports.")

def download_caspio_direct(page, target_name, url):
    save_path = os.path.join(EXPORTS_DIR, f"{target_name}.xml")
    print(f"[{target_name}] Requesting live XML export...")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        time.sleep(1)

        btn = page.locator("a.cbResultSetDownloadLink, a[data-cb-name='DataDownloadButton']").first
        btn.wait_for(state="visible", timeout=25000)
        btn.click(force=True)
        time.sleep(1)

        with page.expect_download(timeout=45000) as download_info:
            opt = page.locator("a:has-text('Excel(XML)'), div:has-text('Excel(XML)'), li:has-text('Excel(XML)')").last
            if opt.is_visible(timeout=5000):
                opt.click(force=True)

        download = download_info.value
        download.save_as(save_path)
        size_kb = os.path.getsize(save_path) / 1024
        print(f"  -> ✅ [{target_name}] Downloaded: {size_kb:.1f} KB")
    except Exception as e:
        print(f"  -> ❌ [{target_name}] Failed: {e}")
        raise e

def handle_rmi_portal_export(page, target_name, url):
    save_path = os.path.join(EXPORTS_DIR, f"{target_name}.xml")
    print(f"\n[{target_name}] Navigating to portal: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)

        try:
            cookie_btn = page.locator("button.btn-close, .cookie-close, [aria-label='Close'], button:has-text('✕')").first
            if cookie_btn.is_visible(timeout=2000):
                cookie_btn.click(force=True)
                time.sleep(1)
        except Exception:
            pass

        try:
            accept_btn = page.locator("input[value='I Accept'], input[value*='Accept'], button:has-text('Accept')").first
            if accept_btn.is_visible(timeout=3000):
                accept_btn.click(force=True)
                print(f"  -> [{target_name}] Terms accepted ('I Accept' clicked)")
                time.sleep(3)
        except Exception:
            pass

        print(f"[{target_name}] Searching for download button across all frames...")

        target_dl_btn = None
        for _ in range(35):
            for frame in page.frames:
                btn = frame.locator("a[data-cb-name='DataDownloadButton'], a.cbResultSetDownloadLink, a:has-text('Download Data')").first
                try:
                    if btn.is_visible(timeout=1000):
                        target_dl_btn = btn
                        break
                except Exception:
                    continue
            if target_dl_btn:
                break
            time.sleep(1)

        if not target_dl_btn:
            page.evaluate("window.scrollTo(0, 500);")
            time.sleep(2)
            for frame in page.frames:
                btn = frame.locator("a[data-cb-name='DataDownloadButton'], a.cbResultSetDownloadLink, a:has-text('Download Data')").first
                try:
                    if btn.is_visible(timeout=1000):
                        target_dl_btn = btn
                        break
                except Exception:
                    continue

        if not target_dl_btn:
            raise Exception("Could not locate Download Data button in portal.")

        with page.expect_download(timeout=45000) as download_info:
            try:
                target_dl_btn.evaluate("el => el.click()")
            except Exception:
                target_dl_btn.click(force=True)

            try:
                opt = page.locator("a:has-text('Excel(XML)'), div:has-text('Excel(XML)'), li:has-text('Excel(XML)')").first
                if opt.is_visible(timeout=3000):
                    opt.click(force=True)
            except Exception:
                pass

        download = download_info.value
        download.save_as(save_path)
        size_kb = os.path.getsize(save_path) / 1024
        print(f"  -> ✅ [{target_name}] Downloaded: {size_kb:.1f} KB")
    except Exception as e:
        print(f"  -> ❌ [{target_name}] Failed: {e}")
        raise e

def run_live_pipeline():
    print("=========================================================")
    print(" 🚀 Phase 1: Automated Live XML Data Harvesting")
    print("=========================================================")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, downloads_path=EXPORTS_DIR)
        context = browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        context.add_cookies([
            {"name": "rmiViewAgree", "value": "true", "domain": ".responsiblemineralsinitiative.org", "path": "/"},
            {"name": "cb_disclaimer_agreed", "value": "true", "domain": ".caspio.com", "path": "/"}
        ])

        page = context.new_page()

        for name in ["CMRT", "EMRT", "AMRT", "REVISIONS"]:
            download_caspio_direct(page, name, TARGET_URLS[name])
            time.sleep(1)

        handle_rmi_portal_export(page, "ACTIVE", TARGET_URLS["ACTIVE"])
        time.sleep(2)

        handle_rmi_portal_export(page, "CONFORMANT", TARGET_URLS["CONFORMANT"])
        time.sleep(2)

        browser.close()

    cleanup_local_temp_files()

def parse_spreadsheet_ml(xml_path):
    if not os.path.exists(xml_path) or os.path.getsize(xml_path) < 100:
        return []
    tree = ET.parse(xml_path)
    root = tree.getroot()
    ns = {"ss": "urn:schemas-microsoft-com:office:spreadsheet"}
    grid = []
    for row in root.findall(".//ss:Row", ns):
        row_cells = []
        col_idx = 0
        for cell in row.findall("./ss:Cell", ns):
            idx_attr = cell.get("{urn:schemas-microsoft-com:office:spreadsheet}Index")
            if idx_attr:
                target_idx = int(idx_attr) - 1
                while col_idx < target_idx:
                    row_cells.append("")
                    col_idx += 1
            data_elem = cell.find("./ss:Data", ns)
            val = data_elem.text if data_elem is not None and data_elem.text else ""
            row_cells.append(val.strip())
            col_idx += 1
        if any(row_cells):
            grid.append(row_cells)
    return grid

def find_col_idx(headers, keywords):
    for i, h in enumerate(headers):
        if not h:
            continue
        clean_h = "".join(filter(str.isalnum, str(h))).lower()
        for kw in keywords:
            if "".join(filter(str.isalnum, kw)).lower() in clean_h:
                return i
    return -1

def format_date(val):
    val_str = str(val).strip()
    if len(val_str) >= 10 and val_str[:4].isdigit() and val_str[4] == "-" and val_str[7] == "-":
        return val_str[:10]
    return val_str

def consolidate_and_export(output_filename, timestamp_full_str):
    print("\n=========================================================")
    print(" 📊 Phase 2: Data Parsing, RMAP Mapping & Consolidation")
    print("=========================================================\n")

    base_rows = []
    conformant_map = {}
    active_set = set()
    revisions_map = {}
    type_counts = {"CMRT": 0, "EMRT": 0, "AMRT": 0}

    conf_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "CONFORMANT.xml"))
    if not conf_grid:
        raise ValueError("CONFORMANT.xml parsing failed.")
    headers = conf_grid[0]
    id_idx = find_col_idx(headers, ["smelterid", "smelteridentification", "cid"])
    date_idx = find_col_idx(headers, ["lastaudit", "auditdate"])
    cycle_idx = find_col_idx(headers, ["cycle", "auditcycle"])
    reaudit_idx = find_col_idx(headers, ["reaudit", "status"])
    for r in conf_grid[1:]:
        s_id = r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else ""
        if s_id:
            conformant_map[s_id] = {
                "lastAudit": format_date(r[date_idx]) if date_idx != -1 and date_idx < len(r) else "",
                "cycle": r[cycle_idx].strip() if cycle_idx != -1 and cycle_idx < len(r) and r[cycle_idx] else "",
                "reaudit": r[reaudit_idx].strip() if reaudit_idx != -1 and reaudit_idx < len(r) and r[reaudit_idx] else "No"
            }
    print(f"• Conformant smelters loaded: {len(conformant_map)} records")

    act_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "ACTIVE.xml"))
    if not act_grid:
        raise ValueError("ACTIVE.xml parsing failed.")
    headers = act_grid[0]
    id_idx = find_col_idx(headers, ["smelterid", "smelteridentification", "cid"])
    for r in act_grid[1:]:
        s_id = r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else ""
        if s_id:
            active_set.add(s_id)
    print(f"• Active smelters loaded: {len(active_set)} records")

    rev_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "REVISIONS.xml"))
    if not rev_grid:
        raise ValueError("REVISIONS.xml parsing failed.")
    headers = rev_grid[0]
    metal_idx = find_col_idx(headers, ["metal"])
    id_idx = find_col_idx(headers, ["smelterid", "smelteridentification", "cid"])
    name_idx = find_col_idx(headers, ["standardsmeltername", "smeltername"])
    country_idx = find_col_idx(headers, ["country"])
    basis_idx = find_col_idx(headers, ["basisforrevision", "basis", "revision"])
    details_idx = find_col_idx(headers, ["details", "comments", "history"])
    date_idx = find_col_idx(headers, ["revisiondate", "revdate", "date"])

    for r in rev_grid[1:]:
        s_id = r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else ""
        if s_id:
            metal = r[metal_idx].strip() if metal_idx != -1 and metal_idx < len(r) and r[metal_idx] else ""
            name = r[name_idx].strip() if name_idx != -1 and name_idx < len(r) and r[name_idx] else ""
            country = r[country_idx].strip() if country_idx != -1 and country_idx < len(r) and r[country_idx] else ""
            basis = r[basis_idx].strip() if basis_idx != -1 and basis_idx < len(r) and r[basis_idx] else ""
            details = r[details_idx].strip() if details_idx != -1 and details_idx < len(r) and r[details_idx] else ""
            rev_date = format_date(r[date_idx]) if date_idx != -1 and date_idx < len(r) else ""
            info = f"{basis}: {details}" if basis and details else (basis or details or "-")

            if s_id not in revisions_map or rev_date >= revisions_map[s_id]["date"]:
                revisions_map[s_id] = {
                    "metal": metal,
                    "name": name,
                    "country": country,
                    "info": info,
                    "date": rev_date
                }
    print(f"• Revision history loaded: {len(revisions_map)} records")

    for t_name in ["CMRT", "EMRT", "AMRT"]:
        t_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, f"{t_name}.xml"))
        if not t_grid:
            raise ValueError(f"{t_name}.xml parsing failed.")
        headers = t_grid[0]
        metal_idx = find_col_idx(headers, ["metal"])
        ref_idx = find_col_idx(headers, ["smelterreference", "reference"])
        name_idx = find_col_idx(headers, ["standardsmeltername", "smeltername"])
        country_idx = find_col_idx(headers, ["country"])
        id_idx = find_col_idx(headers, ["smelterid", "cid"])
        city_idx = find_col_idx(headers, ["city"])
        state_idx = find_col_idx(headers, ["stateprovince", "state", "province"])

        count_in_type = 0
        for r in t_grid[1:]:
            base_rows.append({
                "type": t_name,
                "metal": r[metal_idx].strip() if metal_idx != -1 and metal_idx < len(r) and r[metal_idx] else "",
                "smelterRef": r[ref_idx].strip() if ref_idx != -1 and ref_idx < len(r) and r[ref_idx] else "",
                "smelterName": r[name_idx].strip() if name_idx != -1 and name_idx < len(r) and r[name_idx] else "",
                "country": r[country_idx].strip() if country_idx != -1 and country_idx < len(r) and r[country_idx] else "",
                "smelterId": r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else "",
                "city": r[city_idx].strip() if city_idx != -1 and city_idx < len(r) and r[city_idx] else "",
                "state": r[state_idx].strip() if state_idx != -1 and state_idx < len(r) and r[state_idx] else "",
            })
            count_in_type += 1
        type_counts[t_name] = count_in_type

    print(f"• Base templates loaded (CMRT/EMRT/AMRT): {len(base_rows)} records")

    headers_out = [
        "No.", "Source", "Metal", "Smelter Reference", "Standard Smelter Name", "Country",
        "Smelter ID", "City", "State Province", "RMAP Status",
        "Audit / Cycle / Reaudit", "Revision History"
    ]

    all_table_data = []
    processed_ids = set()
    active_matched_count = 0
    conformant_matched_count = 0
    row_counter = 1

    for item in base_rows:
        s_id = item["smelterId"]
        rmap_status = "-"
        audit_info = ""

        if s_id and s_id in conformant_map:
            rmap_status = "Conformant"
            c = conformant_map[s_id]
            audit_info = f"{c['lastAudit']} / {c['cycle']} / {c['reaudit']}"
            conformant_matched_count += 1
        elif s_id and s_id in active_set:
            rmap_status = "Active"
            active_matched_count += 1

        rev_history = revisions_map[s_id]["info"] if s_id and s_id in revisions_map else ""

        all_table_data.append([
            row_counter,
            item["type"],
            item["metal"],
            item["smelterRef"],
            item["smelterName"],
            item["country"],
            item["smelterId"],
            item["city"],
            item["state"],
            rmap_status,
            audit_info,
            rev_history
        ])
        if s_id:
            processed_ids.add(s_id)
        row_counter += 1

    removed_count = 0
    for rev_id, rev_val in revisions_map.items():
        if rev_id not in processed_ids:
            all_table_data.append([
                row_counter,
                "REVISION",
                rev_val["metal"],
                "",
                rev_val["name"],
                rev_val["country"],
                rev_id,
                "",
                "",
                "Removed",
                "",
                rev_val["info"] or "Removed"
            ])
            processed_ids.add(rev_id)
            removed_count += 1
            row_counter += 1

    total_smelters = len(base_rows) + removed_count
    standard_count = total_smelters - conformant_matched_count - active_matched_count - removed_count

    summary_data = {
        "total": total_smelters,
        "cmrt": type_counts["CMRT"],
        "emrt": type_counts["EMRT"],
        "amrt": type_counts["AMRT"],
        "removed": removed_count,
        "conformant": conformant_matched_count,
        "active": active_matched_count,
        "standard": standard_count,
        "timestamp": timestamp_full_str
    }

    wb = openpyxl.Workbook()

    ws_summary = wb.active
    ws_summary.title = "Disclaimer & Summary"

    sum_headers = ["Data Consolidated", "Total", "Conformant", "Active", "Standard", "Removed"]
    sum_values = [timestamp_full_str, total_smelters, conformant_matched_count, active_matched_count, standard_count, removed_count]

    for col_idx, h_text in enumerate(sum_headers, start=2):
        ws_summary.cell(row=2, column=col_idx, value=h_text)
    for col_idx, val in enumerate(sum_values, start=2):
        ws_summary.cell(row=3, column=col_idx, value=val)

    font_summary_header = Font(name="Pretendard", size=11, bold=True, color="1E293B")
    fill_summary_header = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    font_summary_body = Font(name="Pretendard", size=11)
    align_center = Alignment(horizontal="center", vertical="center")

    thin_side = Side(style="thin", color="CBD5E1")
    box_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    ws_summary.row_dimensions[2].height = 24
    ws_summary.row_dimensions[3].height = 22

    for col in range(2, 8):
        c_head = ws_summary.cell(row=2, column=col)
        c_head.font = font_summary_header
        c_head.fill = fill_summary_header
        c_head.alignment = align_center
        c_head.border = box_border

        c_val = ws_summary.cell(row=3, column=col)
        c_val.font = font_summary_body
        c_val.alignment = align_center
        c_val.border = box_border

    disclaimer_text = (
        "a2MDS Consulting\n"
        "글로벌 제품환경규제 대응 전문기업\n"
        "IMDS | Responsible·Conflict Minerals | Product Environmental Compliance | Supply Chain Due Diligence\n"
        "APA Engineering과의 전략적 파트너십을 기반으로, 교육부터 컨설팅, 아웃소싱, 자동화 솔루션까지 One-stop으로 지원합니다.\n\n"
        "Disclaimer\n"
        "본 자료는 RMI(Responsible Minerals Initiative) 웹사이트에서 제공하는 제련소 목록을 기반으로 작성되었습니다.\n"
        "본 자료의 정보는 자료 송부일 이전에 확인된 내용을 기준으로 합니다.\n"
        "RMI 제련소 목록은 지속적으로 업데이트되므로, 본 자료의 작성일 이후 변경된 최신 정보와 차이가 있을 수 있습니다.\n"
        "따라서 본 자료는 통합 목록 예시로 활용하여 주시고, 최신 정보가 필요한 경우 RMI 공식 웹사이트에서 최신 제련소 정보를 직접 확인하시기 바랍니다.\n\n"
        "RMI 제련소 정보\n"
        "• 링크: https://www.responsiblemineralsinitiative.org/\n"
        "• 사용된 제련소 목록 정보: Smelter Reference List (for CMRT, EMRT & AMRT), Active smelter list & Conformant smelter list"
    )

    ws_summary.merge_cells("B5:G5")
    cell_b5 = ws_summary.cell(row=5, column=2, value=disclaimer_text)
    cell_b5.font = Font(name="Pretendard", size=11, color="1E293B")
    cell_b5.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)

    ws_summary.row_dimensions[5].height = 360

    summary_widths = {1: 4, 2: 35, 3: 14, 4: 16, 5: 14, 6: 14, 7: 14}
    for col_idx, width in summary_widths.items():
        ws_summary.column_dimensions[get_column_letter(col_idx)].width = width

    ws_log = wb.create_sheet(title="Smelter Log")
    ws_log.append(headers_out)
    for r_data in all_table_data:
        ws_log.append(r_data)

    font_body = Font(name="Pretendard", size=11)
    font_header = Font(name="Pretendard", size=11, bold=True, color="1E293B")
    fill_header = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    align_header = Alignment(horizontal="center", vertical="center")
    align_body = Alignment(vertical="center")

    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="medium", color="94A3B8")
    )

    ws_log.row_dimensions[1].height = 26
    for cell in ws_log[1]:
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_header
        cell.border = thin_border

    for row in ws_log.iter_rows(min_row=2):
        for cell in row:
            cell.font = font_body
            cell.alignment = align_body

    ws_log.freeze_panes = "D2"
    ws_log.auto_filter.ref = ws_log.dimensions
    custom_widths = [6, 10, 12, 22, 26, 16, 13, 14, 16, 14, 34, 38]
    for i, w in enumerate(custom_widths, 1):
        ws_log.column_dimensions[get_column_letter(i)].width = w

    output_filepath = os.path.join(EXPORTS_DIR, f"{output_filename}.xlsx")
    wb.save(output_filepath)

    print(f"\n✨ Final Master File Created: {output_filename}.xlsx")
    return output_filepath, summary_data, headers_out, all_table_data

def sync_to_google_services(excel_filepath, headers, rows_data):
    client_id = os.environ.get("GDRIVE_CLIENT_ID")
    client_secret = os.environ.get("GDRIVE_CLIENT_SECRET")
    refresh_token = os.environ.get("GDRIVE_REFRESH_TOKEN")
    parent_folder_id = os.environ.get("GDRIVE_FOLDER_ID")

    print("\n=========================================================")
    print(" ☁️ Phase 3: Syncing Files & Live Google Spreadsheet")
    print("=========================================================")

    if all([client_id, client_secret, refresh_token, parent_folder_id]):
        try:
            creds = Credentials(
                token=None,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret
            )
            creds.refresh(Request())
            drive_service = build("drive", "v3", credentials=creds)

            subfolder_query = f"'{parent_folder_id}' in parents and name = '{DAILY_HARVEST_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
            subfolder_results = drive_service.files().list(q=subfolder_query, fields="files(id, name)").execute()
            subfolders = subfolder_results.get("files", [])

            if subfolders:
                daily_harvest_folder_id = subfolders[0]["id"]
            else:
                folder_meta = {
                    "name": DAILY_HARVEST_FOLDER_NAME,
                    "mimeType": "application/vnd.google-apps.folder",
                    "parents": [parent_folder_id]
                }
                new_folder = drive_service.files().create(body=folder_meta, fields="id").execute()
                daily_harvest_folder_id = new_folder.get("id")
                print(f"📁 Created subfolder: '{DAILY_HARVEST_FOLDER_NAME}'")

            cleanup_query = f"('{parent_folder_id}' in parents or '{daily_harvest_folder_id}' in parents) and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
            existing_remote_items = drive_service.files().list(q=cleanup_query, fields="files(id, name)", pageSize=200).execute().get("files", [])

            deleted_remote_count = 0
            for r_file in existing_remote_items:
                if UUID_PATTERN.match(r_file["name"]):
                    try:
                        drive_service.files().delete(fileId=r_file["id"]).execute()
                        deleted_remote_count += 1
                    except Exception:
                        pass
            if deleted_remote_count > 0:
                print(f"🧹 [Drive Purge] Removed {deleted_remote_count} orphan UUID temp file(s) from Google Drive.")

            parent_query = f"'{parent_folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
            parent_files = {item["name"]: item["id"] for item in drive_service.files().list(q=parent_query, fields="files(id, name)", pageSize=100).execute().get("files", [])}

            sub_query = f"'{daily_harvest_folder_id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
            sub_files = {item["name"]: item["id"] for item in drive_service.files().list(q=sub_query, fields="files(id, name)", pageSize=100).execute().get("files", [])}

            VALID_EXTENSIONS = ('.xml', '.xlsx', '.txt')
            current_local_files = [
                f for f in os.listdir(EXPORTS_DIR)
                if os.path.isfile(os.path.join(EXPORTS_DIR, f))
                and f.lower().endswith(VALID_EXTENSIONS)
                and not UUID_PATTERN.match(f)
            ]

            for fname in current_local_files:
                fpath = os.path.join(EXPORTS_DIR, fname)
                media = MediaFileUpload(fpath, resumable=True)

                if fname.startswith("RMI Smelter Data Daily Sync_") or fname.startswith("RMI Smelter Data Sync_") or fname.startswith("RMI_Consolidated_Smelter_List_"):
                    target_folder_id = daily_harvest_folder_id
                    target_existing = sub_files
                    loc_label = "[Daily Harvest]"
                else:
                    target_folder_id = parent_folder_id
                    target_existing = parent_files
                    loc_label = "[Main Folder]"

                if fname in target_existing:
                    drive_service.files().update(
                        fileId=target_existing[fname],
                        media_body=media
                    ).execute()
                    print(f"  -> 🔄 {loc_label} Updated: {fname}")
                else:
                    file_metadata = {
                        'name': fname,
                        'parents': [target_folder_id]
                    }
                    drive_service.files().create(
                        body=file_metadata,
                        media_body=media,
                        fields='id'
                    ).execute()
                    print(f"  -> ⬆️ {loc_label} Uploaded: {fname}")
        except Exception as e:
            print(f"  -> ⚠️ Drive File Archive Warning: {e}")
    else:
        print("⚠️ Google Drive OAuth credentials missing. Skipping raw file upload.")

    if not GAS_WEBAPP_URL:
        raise ValueError("GAS_WEBAPP_URL environment variable is missing. Cannot sync to Google Spreadsheet.")

    print("\n  -> 📊 Updating Google Spreadsheet via Apps Script Live DB...")
    CHUNK_SIZE = 500
    total_rows = len(rows_data)
    total_chunks = (total_rows + CHUNK_SIZE - 1) // CHUNK_SIZE

    kst_now_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")

    try:
        for i in range(total_chunks):
            start = i * CHUNK_SIZE
            end = min(start + CHUNK_SIZE, total_rows)
            chunk = rows_data[start:end]

            payload = {
                "action": "save_smelters_chunk",
                "auth": GAS_AUTH_KEY,
                "isFirstChunk": (i == 0),
                "lastUpdated": kst_now_str,
                "headers": headers if (i == 0) else [],
                "rows": chunk
            }

            resp = requests.post(
                GAS_WEBAPP_URL,
                headers={"Content-Type": "text/plain;charset=utf-8"},
                data=json.dumps(payload),
                timeout=45
            )

            resp_json = {}
            try:
                resp_json = resp.json()
            except Exception:
                pass

            if resp.status_code != 200 or resp_json.get("status") != "success":
                raise Exception(f"Chunk {i+1}/{total_chunks} failed. Status: {resp.status_code}, Response: {resp.text}")

            print(f"  -> ⏳ Synced chunk ({i+1}/{total_chunks}) to Live Sheet...")

        print("  -> ✅ [Live Sheet Updated]: Successfully synced master data and refreshed Latest Harvest time!")
    except Exception as e:
        print(f"\n❌ Live Sheet Update Failed: {e}")
        traceback.print_exc(file=sys.stdout)
        raise e

    print("\n✅ Google Drive & Live Sync Completed Successfully!")

if __name__ == "__main__":
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    today_str = now_kst.strftime("%Y%m%d")
    timestamp_full_str = now_kst.strftime("%Y-%m-%d %H:%M:%S") + " KST (UTC+9)"
    
    # 📌 파일 명칭: RMI Smelter Data Daily Sync / 저장 시 날짜 접미사 적용
    base_name = f"{BASE_TITLE}_{today_str}"

    log_filepath = os.path.join(EXPORTS_DIR, f"{base_name}.txt")
    logger = DualLogger(log_filepath)
    sys.stdout = logger
    sys.stderr = logger

    print(f"\n=== RMI Smelter Daily Sync Started at {timestamp_full_str} ===")

    try:
        run_live_pipeline()
        excel_path, stats, headers, rows_data = consolidate_and_export(base_name, timestamp_full_str)
        sync_to_google_services(excel_path, headers, rows_data)

        success_subject = f"✅ [SUCCESS] RMI Smelter Daily Sync Report ({today_str})"
        success_body = (
            f"Dear Mr. CEO,\n\n"
            f"The daily automated harvesting, multi-template consolidation, and cloud database synchronization for RMI Smelter Data have been successfully completed.\n\n"
            f"==================================================\n"
            f" 📌 DAILY CONSOLIDATION SUMMARY ({today_str})\n"
            f"==================================================\n"
            f"1. Date consolidated: {stats['timestamp']}\n"
            f"2. Total Consolidated Facilities : {stats['total']:,} records\n"
            f"   - CMRT (3TG)                  : {stats['cmrt']:,}\n"
            f"   - EMRT (Cobalt/Mica)          : {stats['emrt']:,}\n"
            f"   - AMRT (Aluminum)             : {stats['amrt']:,}\n"
            f"   - Revision History (Removed) : {stats['removed']:,}\n\n"
            f"• RMAP Audit Compliance Breakdown\n"
            f"   - Conformant                  : {stats['conformant']:,}\n"
            f"   - Active                      : {stats['active']:,}\n"
            f"   - Standard (-)                : {stats['standard']:,}\n"
            f"   - Removed                     : {stats['removed']:,}\n\n"
            f"• Cloud & Database Synchronization\n"
            f"   - Master File                 : {base_name}.xlsx\n"
            f"   - Google Drive Archive        : Updated ([Daily Harvest] & [Main Folder])\n"
            f"   - Live Sheet Database         : Synced & Latest Harvest Timestamp Refreshed\n"
            f"==================================================\n\n"
            f"==================================================\n"
            f" 📖 CONSOLIDATION WORKFLOW & DATA PIPELINE\n"
            f"==================================================\n"
            f"1. Multi-Source Ingestion:\n"
            f"   - Downloads live XML exports directly from RMI Caspio databases and the RMI portal (CMRT, EMRT, AMRT, Revisions, Active, Conformant).\n\n"
            f"2. Template Parsing & ID Mapping:\n"
            f"   - Extracts core facility attributes (Metal, Reference, Smelter Name, Country, City, State) keyed by unique Facility ID (CID / Smelter ID).\n\n"
            f"3. Compliance Status & Audit Enrichment:\n"
            f"   - Cross-references facility IDs against RMAP audit databases:\n"
            f"     • Conformant: Enriched with last audit date, audit cycle, and re-audit progress status.\n"
            f"     • Active: Tagged as actively participating in the RMAP validation process.\n"
            f"     • Standard: Tagged with '-' when no active RMAP record exists.\n\n"
            f"4. Historical Revision Retention:\n"
            f"   - Preserves historical delisted/inactive smelters from the Revision History table as 'REVISION' (Status = 'Removed') to maintain complete compliance traceability.\n\n"
            f"5. Cloud Database Batch Ingestion:\n"
            f"   - Generates formatted multi-sheet Excel master artifacts (Disclaimer & Summary + Smelter Log) and streams data in 500-row chunks to Google Spreadsheet Cloud DB via Google Apps Script endpoint.\n"
            f"=================================================="
        )
        send_daily_email_report(success_subject, success_body)

    except Exception as e:
        error_trace = sanitize_traceback(traceback.format_exc())

        print("\n" + "="*57)
        print(" ❌ PIPELINE ERROR OCCURRED")
        print("="*57)
        print(f"Error Type: {type(e).__name__}")
        print(f"Error Message: {str(e)}\n")
        print("Detailed Traceback (Sanitized):")
        print(error_trace)
        print("="*57 + "\n")

        fail_subject = f"🚨 [FAILURE] RMI Smelter Sync Error Alert ({today_str})"
        fail_body = (
            f"Dear Mr. CEO,\n\n"
            f"An error occurred during the daily automated RMI Smelter synchronization pipeline. The operation has been halted.\n\n"
            f"==================================================\n"
            f" ❌ ERROR SUMMARY\n"
            f"==================================================\n"
            f"• Error Type    : {type(e).__name__}\n"
            f"• Error Message : {str(e)}\n\n"
            f"==================================================\n"
            f" 🔍 SANITIZED TRACEBACK\n"
            f"==================================================\n"
            f"{error_trace}\n"
            f"==================================================\n"
            f"※ You can forward this entire error traceback directly to ReS for prompt analysis and troubleshooting."
        )
        send_daily_email_report(fail_subject, fail_body)
        sys.exit(1)
    finally:
        purge_all_local_exports()
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__
        logger.close()
