import os
from dotenv import load_dotenv
load_dotenv("my_secrets.env")
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
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.cell.rich_text import TextBlock, CellRichText
from openpyxl.cell.text import InlineFont
from playwright.sync_api import sync_playwright

# Google API Libraries
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# ==========================================
# 📧 Email Notification Credentials & Config
# ==========================================
EMAIL_SENDER = os.environ.get("ALERT_EMAIL_SENDER", "")
EMAIL_PASSWORD = os.environ.get("ALERT_EMAIL_PASSWORD", "")
EMAIL_RECEIVER = os.environ.get("ALERT_EMAIL_RECEIVER", "")

# ==========================================
# 🌐 Google Sheets & Storage Config (Direct SA)
# ==========================================
TARGET_SPREADSHEET_ID = os.environ.get("RMI_SPREADSHEET_ID") or os.environ.get("TARGET_SPREADSHEET_ID", "1u_fOmUwj1AdAif6sBVcWgMuR3vAcxGb6Bz1tY0Bz45Q")
SA_KEY_STR = os.environ.get("GDRIVE_SA_KEY") or os.environ.get("SA_KEY") or os.environ.get("REG_SA_KEY", "")
GDRIVE_FOLDER_ID = os.environ.get("GDRIVE_FOLDER_ID", "")

# 격리된 작업 임시 폴더
TEMP_EXPORTS_DIR = os.path.abspath("exports")
os.makedirs(TEMP_EXPORTS_DIR, exist_ok=True)

TARGET_URLS = {
    "CMRT": "https://b5.caspio.com/dp/0c4a30006f6c908f547e41cfa9bc",
    "EMRT": "https://c0eku224.caspio.com/dp/0c4a3000f851a3fe32a54dbcbd38",
    "AMRT": "https://c0eku224.caspio.com/dp/0c4a300001be9d377b74464d8a65",
    "REVISIONS": "https://b5.caspio.com/dp/0c4a3000a9ae96d4b36e406fa326",
    "PUBLIC": "https://www.sbsolutionsllc.net/eicc/smelter-conformant-active/",
    "ELIGIBLE": "https://c0eku224.caspio.com/dp/0c4a30001fb4dc1742cd4c88bda8"
}

BASE_TITLE = "RMI Smelter Data Sync"
UUID_PATTERN = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def get_google_credentials():
    """Service Account Credentials 객체 생성"""
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    if SA_KEY_STR:
        try:
            key_data = json.loads(SA_KEY_STR)
            return Credentials.from_service_account_info(key_data, scopes=scopes)
        except Exception as e:
            print(f"⚠️ Failed to parse SA_KEY JSON string: {e}. Trying service_key.json...")

    if os.path.exists("service_key.json"):
        return Credentials.from_service_account_file("service_key.json", scopes=scopes)

    raise ValueError("No valid Google Service Account Credentials found in SA_KEY or service_key.json")


def sanitize_traceback(tb_str: str) -> str:
    sanitized = re.sub(r'([A-Za-z]:\\[^:\n\r]+|\/[a-zA-Z0-9_\.\-]+(?:\/[a-zA-Z0-9_\.\-]+)+)', '[INTERNAL_FILE_PATH]', tb_str)
    sanitized = re.sub(r'(auth|password|key|token|secret)[\'"]?\s*[:=]\s*[\'"][^\'"]+[\'"]', r'\1: "***MASKED***"', sanitized, flags=re.IGNORECASE)
    return sanitized


def fetch_previous_summary_direct() -> dict:
    """Google Sheet의 'Summary History' 시트 최신 행 데이터를 직접 읽어옵니다."""
    try:
        creds = get_google_credentials()
        gc = gspread.authorize(creds)
        sh = gc.open_by_key(TARGET_SPREADSHEET_ID)

        try:
            ws = sh.worksheet("Summary History")
        except gspread.exceptions.WorksheetNotFound:
            print("ℹ [Previous Summary] 'Summary History' tab not found. Initial run.")
            return {}

        records = ws.get_all_values()
        if len(records) <= 1:
            print("ℹ [Previous Summary] No previous history rows found. Initial run.")
            return {}

        last_row = records[-1]
        def to_int(val):
            try:
                return int(str(val).replace(",", "").strip())
            except Exception:
                return 0

        d = {
            "date": last_row[0] if len(last_row) > 0 else "",
            "cmrt": to_int(last_row[1]) if len(last_row) > 1 else 0,
            "emrt": to_int(last_row[2]) if len(last_row) > 2 else 0,
            "amrt": to_int(last_row[3]) if len(last_row) > 3 else 0,
            "revision": to_int(last_row[4]) if len(last_row) > 4 else 0,
            "eligible": to_int(last_row[5]) if len(last_row) > 5 else 0,
            "public": to_int(last_row[6]) if len(last_row) > 6 else 0,
            "total": to_int(last_row[7]) if len(last_row) > 7 else 0,
            "logged": to_int(last_row[8]) if len(last_row) > 8 else 0,
            "unique_id": to_int(last_row[9]) if len(last_row) > 9 else 0,
            "conformant": to_int(last_row[10]) if len(last_row) > 10 else 0,
            "active": to_int(last_row[11]) if len(last_row) > 11 else 0,
            "identified": to_int(last_row[12]) if len(last_row) > 12 else 0,
            "removed": to_int(last_row[13]) if len(last_row) > 13 else 0,
            "others": to_int(last_row[14]) if len(last_row) > 14 else 0
        }

        print(f"📥 [Previous Summary Loaded]: Last record on {d.get('date')} (Total Unique: {d.get('unique_id')})")
        return {
            "raw_sources": {
                "CMRT": d["cmrt"],
                "EMRT": d["emrt"],
                "AMRT": d["amrt"],
                "Revision": d["revision"],
                "Eligible": d["eligible"],
                "Public": d["public"],
                "total": d["total"]
            },
            "unique_status": {
                "conformant": d["conformant"],
                "active": d["active"],
                "identified": d["identified"],
                "removed": d["removed"],
                "others": d["others"],
                "total": d["unique_id"]
            }
        }
    except Exception as e:
        print(f"⚠️ [Previous Summary Fetch Failed]: {e}. Proceeding without diff.")
        return {}


def format_diff_badge(current_val: int, prev_val: int = None) -> str:
    if prev_val is None:
        return '<span style="color: #94a3b8;">-</span>'
    diff = current_val - prev_val
    if diff > 0:
        return f'<span style="color: #16a34a; font-weight: 600;">▲ +{diff:,}</span>'
    elif diff < 0:
        return f'<span style="color: #dc2626; font-weight: 600;">▼ {diff:,}</span>'
    return '<span style="color: #94a3b8;">-</span>'


def send_email_report(subject: str, body_html: str):
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("\n⚠️ [Email Notification Skipped]: Missing email credentials.")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"RMI Facility Harvest <{EMAIL_SENDER}>"
        msg["To"] = EMAIL_RECEIVER
        msg["Subject"] = subject
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"\n📧 [Email Report Sent Successfully] Receiver: {EMAIL_RECEIVER}")
    except Exception as ex:
        print(f"\n❌ [Email Delivery Failed]: {ex}")


def cleanup_local_temp_files():
    if not os.path.exists(TEMP_EXPORTS_DIR):
        return
    cleaned = 0
    for filename in os.listdir(TEMP_EXPORTS_DIR):
        file_path = os.path.join(TEMP_EXPORTS_DIR, filename)
        if os.path.isfile(file_path) and UUID_PATTERN.match(filename):
            try:
                os.remove(file_path)
                cleaned += 1
            except Exception:
                pass
    if cleaned > 0:
        print(f"🧹 [Auto-Cleanup] Cleaned {cleaned} temporary Playwright download file(s).")


def download_caspio_direct(page, target_name, url, max_retries=3):
    save_path = os.path.join(TEMP_EXPORTS_DIR, f"{target_name}.xml")
    print(f"[{target_name}] Requesting live XML export from Caspio DataPage...")

    last_ex = None
    for attempt in range(1, max_retries + 1):
        try:
            page.goto(url, wait_until="commit", timeout=60000)
            try:
                page.wait_for_load_state("domcontentloaded", timeout=30000)
            except Exception:
                pass
            time.sleep(2)

            btn = page.locator(
                "a.cbResultSetDownloadLink, a[data-cb-name='DataDownloadButton'], a:has-text('Download Data')"
            ).first
            btn.wait_for(state="attached", timeout=30000)

            try:
                btn.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass

            time.sleep(1)

            with page.expect_download(timeout=50000) as download_info:
                btn.click(force=True)
                time.sleep(1)

                opt = page.locator("a:has-text('Excel(XML)'), div:has-text('Excel(XML)'), li:has-text('Excel(XML)')").last
                if opt.is_visible(timeout=5000):
                    opt.click(force=True)
                else:
                    try:
                        opt.wait_for(state="attached", timeout=3000)
                        opt.click(force=True)
                    except Exception:
                        page.keyboard.press("Enter")

            download = download_info.value
            download.save_as(save_path)
            size_kb = os.path.getsize(save_path) / 1024
            print(f"   -> ✅ [{target_name}] Downloaded: {size_kb:.1f} KB")
            return

        except Exception as e:
            last_ex = e
            if attempt < max_retries:
                wait_sec = attempt * 5
                print(f"   ⚠️ [{target_name}] Attempt {attempt}/{max_retries} failed ({e}). Retrying in {wait_sec}s...")
                time.sleep(wait_sec)
            else:
                print(f"   -> ❌ [{target_name}] Failed after {max_retries} attempts: {e}")
                raise last_ex


def handle_rmi_public_export(page, url):
    print(f"\n[PUBLIC] Navigating to direct data page: {url}")
    try:
        page.goto(url, wait_until="commit", timeout=60000)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=30000)
        except Exception:
            pass

        print("[PUBLIC] Waiting for dataTable rendering...")
        page.locator("#dataTable").wait_for(state="attached", timeout=30000)
        time.sleep(2)

        page.evaluate("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(1)

        print("[PUBLIC] Searching for 'Download Excel' button...")
        excel_selectors = [
            "button.buttons-excel",
            "button:has-text('Download Excel')",
            "a.buttons-excel",
            "input[value='Download Excel']"
        ]

        excel_btn = None
        for sel in excel_selectors:
            cand = page.locator(sel).first
            try:
                if cand.count() > 0 and cand.is_visible(timeout=2000):
                    excel_btn = cand
                    break
            except Exception:
                continue

        if not excel_btn:
            raise Exception("Could not locate 'Download Excel' button on the direct page.")

        print("   -> [PUBLIC] 'Download Excel' button found. Triggering download...")
        excel_btn.scroll_into_view_if_needed(timeout=3000)
        time.sleep(1)

        with page.expect_download(timeout=60000) as download_info:
            excel_btn.click(force=True)

        download = download_info.value
        suggested_name = download.suggested_filename
        ext = os.path.splitext(suggested_name)[1].lower() or ".xlsx"
        save_path = os.path.join(TEMP_EXPORTS_DIR, f"PUBLIC{ext}")
        download.save_as(save_path)

        size_kb = os.path.getsize(save_path) / 1024
        print(f"   -> ✅ [PUBLIC] Downloaded as '{os.path.basename(save_path)}' ({size_kb:.1f} KB)")
        return save_path

    except Exception as e:
        print(f"   -> ❌ [PUBLIC] Failed: {e}")
        raise e


def run_live_pipeline():
    print("=========================================================")
    print(" 🚀 Phase 1: Automated Live Data Harvesting")
    print("=========================================================")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            downloads_path=TEMP_EXPORTS_DIR,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        context = browser.new_context(
            accept_downloads=True,
            ignore_https_errors=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        context.add_cookies([
            {"name": "rmiViewAgree", "value": "true", "domain": ".responsiblemineralsinitiative.org", "path": "/"},
            {"name": "cb_disclaimer_agreed", "value": "true", "domain": ".caspio.com", "path": "/"}
        ])

        page = context.new_page()

        for name in ["CMRT", "EMRT", "AMRT", "REVISIONS", "ELIGIBLE"]:
            download_caspio_direct(page, name, TARGET_URLS[name], max_retries=3)
            time.sleep(1)

        handle_rmi_public_export(page, TARGET_URLS["PUBLIC"])
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


def parse_flexible_grid(filepath):
    if not os.path.exists(filepath):
        return []

    try:
        wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
        sheet = wb.active
        grid = []
        for row in sheet.iter_rows(values_only=True):
            row_vals = [str(c).strip() if c is not None else "" for c in row]
            if any(row_vals):
                grid.append(row_vals)
        wb.close()
        if grid:
            return grid
    except Exception:
        pass

    try:
        grid = parse_spreadsheet_ml(filepath)
        if grid:
            return grid
    except Exception:
        pass

    return []


def find_col_idx(headers, keywords):
    for kw in keywords:
        clean_kw = "".join(filter(str.isalnum, kw)).lower()
        for i, h in enumerate(headers):
            if not h:
                continue
            clean_h = "".join(filter(str.isalnum, str(h))).lower()
            if clean_kw in clean_h:
                return i
    return -1


def format_date(val):
    val_str = str(val).strip()
    if len(val_str) >= 10 and val_str[:4].isdigit() and val_str[4] == "-" and val_str[7] == "-":
        return val_str[:10]
    return val_str


def log_summary_to_sheets_direct(timestamp_log_str, original_source_counts, total_logged_count, unique_id_count, unique_counts):
    """Google Sheet 'Summary History' 시트에 한 줄 직접 추가"""
    try:
        creds = get_google_credentials()
        gc = gspread.authorize(creds)
        sh = gc.open_by_key(TARGET_SPREADSHEET_ID)

        try:
            ws = sh.worksheet("Summary History")
        except gspread.exceptions.WorksheetNotFound:
            ws = sh.add_worksheet(title="Summary History", rows=100, cols=20)
            headers = [
                "Date", "CMRT", "EMRT", "AMRT", "Revision", "Eligible", "Public",
                "Total Sources", "Logged Records", "Unique CID Count",
                "Conformant", "Active", "Identified", "Removed", "Others"
            ]
            ws.append_row(headers)

        total_sources_sum = sum(original_source_counts.values())
        row_to_append = [
            timestamp_log_str,
            original_source_counts["CMRT"],
            original_source_counts["EMRT"],
            original_source_counts["AMRT"],
            original_source_counts["Revision"],
            original_source_counts["Eligible"],
            original_source_counts["Public"],
            total_sources_sum,
            total_logged_count,
            unique_id_count,
            unique_counts["conformant"],
            unique_counts["active"],
            unique_counts["identified"],
            unique_counts["removed"],
            unique_counts["others"]
        ]

        ws.append_row(row_to_append)
        print(f"   -> 📈 [Summary History Logged]: Successfully appended row (A~O) directly to Google Sheet 'Summary History'.")
    except Exception as e:
        print(f"   ⚠️ Could not record summary history to Sheets: {e}")


def consolidate_and_export(output_filename, timestamp_full_str, today_str):
    print("\n=========================================================")
    print(" 📊 Phase 2: Data Parsing, DD Mapping & Consolidation")
    print("=========================================================")

    base_rows = []
    public_facility_map = {}
    eligible_facility_map = {}
    revisions_map = {}

    original_source_counts = {
        "CMRT": 0,
        "EMRT": 0,
        "AMRT": 0,
        "Revision": 0,
        "Eligible": 0,
        "Public": 0
    }

    # 1. RMI Public List 파싱
    pub_candidates = [
        os.path.join(TEMP_EXPORTS_DIR, f) for f in os.listdir(TEMP_EXPORTS_DIR)
        if f.startswith("PUBLIC.") or f.startswith("PUBLIC_LIST.")
    ]
    if not pub_candidates:
        raise ValueError("PUBLIC download file not found in temp directory.")

    public_file_path = pub_candidates[0]
    public_grid = parse_flexible_grid(public_file_path)
    if not public_grid:
        raise ValueError(f"Failed to parse public facilities list: {public_file_path}")

    header_row_idx = 0
    for idx, row in enumerate(public_grid[:5]):
        if find_col_idx(row, ["facilityid", "smelterid"]) != -1:
            header_row_idx = idx
            break

    pub_headers = public_grid[header_row_idx]
    p_metal_idx = find_col_idx(pub_headers, ["metal"])
    p_id_idx = find_col_idx(pub_headers, ["facilityid", "cid", "smelterid"])
    p_name_idx = find_col_idx(pub_headers, ["standardfacilityname", "standardsmeltername", "facilityname"])
    p_op_status_idx = find_col_idx(pub_headers, ["facilityoperationalstatus", "operationalstatus"])
    p_level_idx = find_col_idx(pub_headers, ["supplychainlevel"])
    p_country_idx = find_col_idx(pub_headers, ["countrylocation", "country"])
    p_rmap_status_idx = find_col_idx(pub_headers,
                                     ["assessmentprogramstatus", "duediligenceassessmentprogramstatus", "programstatus",
                                      "rmapstatus"])
    p_cycle_idx = find_col_idx(pub_headers, ["duediligenceassessmentcycle", "assessmentcycle"])
    p_audit_date_idx = find_col_idx(pub_headers, ["lastonsiteassessmentdate", "lastaudit", "auditdate"])
    p_reaudit_idx = find_col_idx(pub_headers, ["reassessmentinprogress", "reaudit"])

    for r in public_grid[header_row_idx + 1:]:
        cid = r[p_id_idx].strip() if p_id_idx != -1 and p_id_idx < len(r) and r[p_id_idx] else ""
        if not cid:
            continue

        public_facility_map[cid] = {
            "metal": r[p_metal_idx].strip() if p_metal_idx != -1 and p_metal_idx < len(r) and r[p_metal_idx] else "",
            "name": r[p_name_idx].strip() if p_name_idx != -1 and p_name_idx < len(r) and r[p_name_idx] else "",
            "op_status": r[p_op_status_idx].strip() if p_op_status_idx != -1 and p_op_status_idx < len(r) and r[
                p_op_status_idx] else "",
            "level": r[p_level_idx].strip() if p_level_idx != -1 and p_level_idx < len(r) and r[p_level_idx] else "",
            "country": r[p_country_idx].strip() if p_country_idx != -1 and p_country_idx < len(r) and r[
                p_country_idx] else "",
            "rmap_status": (r[p_rmap_status_idx].strip() if p_rmap_status_idx != -1 and p_rmap_status_idx < len(r) and
                            r[p_rmap_status_idx] else "") or "-",
            "cycle": r[p_cycle_idx].strip() if p_cycle_idx != -1 and p_cycle_idx < len(r) and r[p_cycle_idx] else "",
            "audit_date": format_date(r[p_audit_date_idx]) if p_audit_date_idx != -1 and p_audit_date_idx < len(
                r) else "",
            "reaudit": (r[p_reaudit_idx].strip() if p_reaudit_idx != -1 and p_reaudit_idx < len(r) and r[
                p_reaudit_idx] else "") or "No"
        }
    original_source_counts["Public"] = len(public_facility_map)
    print(f"• Facilities in original RMI Public List: {original_source_counts['Public']} records")

    # 2. RMI Eligible Facilities List 파싱
    elg_candidates = [
        os.path.join(TEMP_EXPORTS_DIR, f) for f in os.listdir(TEMP_EXPORTS_DIR)
        if f.startswith("ELIGIBLE.") or f.startswith("ELIGIBLE_LIST.")
    ]
    if elg_candidates:
        elg_file_path = elg_candidates[0]
        elg_grid = parse_flexible_grid(elg_file_path)
        if elg_grid:
            elg_hdr_idx = 0
            for idx, row in enumerate(elg_grid[:5]):
                if find_col_idx(row, ["facilityid", "cid", "smelterid"]) != -1:
                    elg_hdr_idx = idx
                    break
            elg_headers = elg_grid[elg_hdr_idx]
            e_metal_idx = find_col_idx(elg_headers, ["metal"])
            e_id_idx = find_col_idx(elg_headers, ["facilityid", "cid", "smelterid"])
            e_name_idx = find_col_idx(elg_headers, ["standardfacilityname", "facilityname"])
            e_level_idx = find_col_idx(elg_headers, ["supplychainlevel", "level"])
            e_country_idx = find_col_idx(elg_headers, ["countrylocation", "country"])
            e_state_idx = find_col_idx(elg_headers, ["stateprovinceregion", "state", "province"])

            for r in elg_grid[elg_hdr_idx + 1:]:
                cid = r[e_id_idx].strip() if e_id_idx != -1 and e_id_idx < len(r) and r[e_id_idx] else ""
                if not cid:
                    continue
                eligible_facility_map[cid] = {
                    "metal": r[e_metal_idx].strip() if e_metal_idx != -1 and e_metal_idx < len(r) and r[
                        e_metal_idx] else "",
                    "name": r[e_name_idx].strip() if e_name_idx != -1 and e_name_idx < len(r) and r[e_name_idx] else "",
                    "level": r[e_level_idx].strip() if e_level_idx != -1 and e_level_idx < len(r) and r[
                        e_level_idx] else "Pinch Point",
                    "country": r[e_country_idx].strip() if e_country_idx != -1 and e_country_idx < len(r) and r[
                        e_country_idx] else "",
                    "state": r[e_state_idx].strip() if e_state_idx != -1 and e_state_idx < len(r) and r[
                        e_state_idx] else ""
                }
            original_source_counts["Eligible"] = len(eligible_facility_map)
            print(f"• Facilities in original RMI Eligible List: {original_source_counts['Eligible']} records")

    # 3. Revision History 파싱
    rev_grid = parse_spreadsheet_ml(os.path.join(TEMP_EXPORTS_DIR, "REVISIONS.xml"))
    if not rev_grid:
        raise ValueError("REVISIONS.xml parsing failed.")
    headers_rev = rev_grid[0]
    metal_idx_rev = find_col_idx(headers_rev, ["metal"])
    id_idx_rev = find_col_idx(headers_rev, ["smelterid", "cid", "facilityid"])
    name_idx_rev = find_col_idx(headers_rev,
                                ["standardsmeltername", "standardfacilityname", "smeltername", "facilityname"])
    country_idx_rev = find_col_idx(headers_rev, ["country"])
    basis_idx_rev = find_col_idx(headers_rev, ["basisforrevision", "basis", "revision"])
    details_idx_rev = find_col_idx(headers_rev, ["details", "comments", "history"])
    date_idx_rev = find_col_idx(headers_rev, ["revisiondate", "revdate", "date"])

    for r in rev_grid[1:]:
        s_id = r[id_idx_rev].strip() if id_idx_rev != -1 and id_idx_rev < len(r) and r[id_idx_rev] else ""
        if s_id:
            metal = r[metal_idx_rev].strip() if metal_idx_rev != -1 and metal_idx_rev < len(r) and r[
                metal_idx_rev] else ""
            name = r[name_idx_rev].strip() if name_idx_rev != -1 and name_idx_rev < len(r) and r[name_idx_rev] else ""
            country = r[country_idx_rev].strip() if country_idx_rev != -1 and country_idx_rev < len(r) and r[
                country_idx_rev] else ""
            basis = r[basis_idx_rev].strip() if basis_idx_rev != -1 and basis_idx_rev < len(r) and r[
                basis_idx_rev] else ""
            details = r[details_idx_rev].strip() if details_idx_rev != -1 and details_idx_rev < len(r) and r[
                details_idx_rev] else ""
            rev_date = format_date(r[date_idx_rev]) if date_idx_rev != -1 and date_idx_rev < len(r) else ""
            info = f"{basis}: {details}" if basis and details else (basis or details or "-")

            if s_id not in revisions_map or rev_date >= revisions_map[s_id]["date"]:
                revisions_map[s_id] = {
                    "metal": metal,
                    "name": name,
                    "country": country,
                    "info": info,
                    "date": rev_date
                }
    original_source_counts["Revision"] = len(revisions_map)
    print(f"• Unique facilities in Revision History: {original_source_counts['Revision']} records")

    # 4. CMRT / EMRT / AMRT 템플릿 데이터 로드
    for t_name in ["CMRT", "EMRT", "AMRT"]:
        t_grid = parse_spreadsheet_ml(os.path.join(TEMP_EXPORTS_DIR, f"{t_name}.xml"))
        if not t_grid:
            raise ValueError(f"{t_name}.xml parsing failed.")
        headers_t = t_grid[0]
        metal_idx = find_col_idx(headers_t, ["metal"])
        ref_idx = find_col_idx(headers_t, ["smelterreference", "reference"])
        name_idx = find_col_idx(headers_t, ["standardsmeltername", "standardfacilityname", "smeltername"])
        country_idx = find_col_idx(headers_t, ["country"])
        id_idx = find_col_idx(headers_t, ["smelterid", "cid", "facilityid"])
        city_idx = find_col_idx(headers_t, ["city"])
        state_idx = find_col_idx(headers_t, ["stateprovince", "state", "province"])

        count_in_type = 0
        for r in t_grid[1:]:
            cid_val = r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else ""
            if not cid_val and not (r[name_idx].strip() if name_idx != -1 and name_idx < len(r) else ""):
                continue
            base_rows.append({
                "type": t_name,
                "metal": r[metal_idx].strip() if metal_idx != -1 and metal_idx < len(r) and r[metal_idx] else "",
                "smelterRef": r[ref_idx].strip() if ref_idx != -1 and ref_idx < len(r) and r[ref_idx] else "",
                "facilityName": r[name_idx].strip() if name_idx != -1 and name_idx < len(r) and r[name_idx] else "",
                "country": r[country_idx].strip() if country_idx != -1 and country_idx < len(r) and r[
                    country_idx] else "",
                "cid": cid_val,
                "city": r[city_idx].strip() if city_idx != -1 and city_idx < len(r) and r[city_idx] else "",
                "state": r[state_idx].strip() if state_idx != -1 and state_idx < len(r) and r[state_idx] else "",
            })
            count_in_type += 1
        original_source_counts[t_name] = count_in_type
        print(f"• Facilities in original {t_name} Reference List: {count_in_type} records")

    headers_out = [
        "No.", "Source", "Metal", "CID", "Operation Status", "Level", "CAHRA",
        "Standard Facility Name", "Country", "Smelter Reference", "City",
        "State Province", "DD Status", "Audit / Cycle / Reaudit", "Revision History"
    ]

    all_table_data = []
    processed_ids = set()
    cid_to_status = {}
    row_counter = 1

    # 5-1. 베이스 템플릿(CMRT/EMRT/AMRT) 머지
    for item in base_rows:
        cid = item["cid"]
        country = item["country"]
        op_status = ""
        level = "Pinch Point"
        rmap_status = "-"
        audit_info = ""

        if cid and cid in eligible_facility_map:
            level = eligible_facility_map[cid]["level"] or level

        if cid and cid in public_facility_map:
            pub_info = public_facility_map[cid]
            op_status = pub_info["op_status"]
            level = pub_info["level"] or level
            if not country:
                country = pub_info["country"]
            rmap_status = pub_info["rmap_status"]

            if "conform" in rmap_status.lower():
                audit_info = f"{pub_info['audit_date']} / {pub_info['cycle']} / {pub_info['reaudit']}"

        rev_history = revisions_map[cid]["info"] if cid and cid in revisions_map else ""

        all_table_data.append([
            row_counter,
            item["type"],
            item["metal"],
            cid,
            op_status,
            level,
            "",
            item["facilityName"],
            country,
            item["smelterRef"],
            item["city"],
            item["state"],
            rmap_status,
            audit_info,
            rev_history
        ])

        if cid and cid not in cid_to_status:
            if cid in public_facility_map:
                pub_stat = public_facility_map[cid]["rmap_status"].lower()
                if "conform" in pub_stat:
                    cid_to_status[cid] = "conformant"
                elif "active" in pub_stat or "participat" in pub_stat:
                    cid_to_status[cid] = "active"
                else:
                    cid_to_status[cid] = "others"
            else:
                cid_to_status[cid] = "identified"

        if cid:
            processed_ids.add(cid)
        row_counter += 1

    # 5-2. Eligible Facilities List 추가 머지
    for elg_cid, elg_val in eligible_facility_map.items():
        if elg_cid not in processed_ids:
            country = elg_val["country"]
            op_status = ""
            level = elg_val["level"] or "Upstream"
            rmap_status = "-"
            audit_info = ""

            if elg_cid in public_facility_map:
                pub_info = public_facility_map[elg_cid]
                op_status = pub_info["op_status"]
                level = pub_info["level"] or level
                if not country:
                    country = pub_info["country"]
                rmap_status = pub_info["rmap_status"]

                if "conform" in rmap_status.lower():
                    audit_info = f"{pub_info['audit_date']} / {pub_info['cycle']} / {pub_info['reaudit']}"

            rev_history = revisions_map[elg_cid]["info"] if elg_cid in revisions_map else ""

            all_table_data.append([
                row_counter,
                "Eligible",
                elg_val["metal"],
                elg_cid,
                op_status,
                level,
                "",
                elg_val["name"],
                country,
                "",
                "",
                elg_val["state"],
                rmap_status,
                audit_info,
                rev_history
            ])

            if elg_cid not in cid_to_status:
                if elg_cid in public_facility_map:
                    pub_stat = public_facility_map[elg_cid]["rmap_status"].lower()
                    if "conform" in pub_stat:
                        cid_to_status[elg_cid] = "conformant"
                    elif "active" in pub_stat or "participat" in pub_stat:
                        cid_to_status[elg_cid] = "active"
                    else:
                        cid_to_status[elg_cid] = "others"
                else:
                    cid_to_status[elg_cid] = "identified"

            processed_ids.add(elg_cid)
            row_counter += 1

    # 5-3. Public List 단독 시설 추가 머지
    for pub_cid, pub_val in public_facility_map.items():
        if pub_cid not in processed_ids:
            country = pub_val["country"]
            rmap_status = pub_val["rmap_status"]
            audit_info = ""

            if "conform" in rmap_status.lower():
                audit_info = f"{pub_val['audit_date']} / {pub_val['cycle']} / {pub_val['reaudit']}"

            rev_history = revisions_map[pub_cid]["info"] if pub_cid in revisions_map else ""

            all_table_data.append([
                row_counter,
                "Public",
                pub_val["metal"],
                pub_cid,
                pub_val["op_status"],
                pub_val["level"],
                "",
                pub_val["name"],
                country,
                "",
                "",
                "",
                rmap_status,
                audit_info,
                rev_history
            ])

            if pub_cid not in cid_to_status:
                pub_stat = rmap_status.lower()
                if "conform" in pub_stat:
                    cid_to_status[pub_cid] = "conformant"
                elif "active" in pub_stat or "participat" in pub_stat:
                    cid_to_status[pub_cid] = "active"
                else:
                    cid_to_status[pub_cid] = "others"

            processed_ids.add(pub_cid)
            row_counter += 1

    # 5-4. Revision History (삭제된 제련소) 머지
    for rev_id, rev_val in revisions_map.items():
        if rev_id not in processed_ids:
            country = rev_val["country"]

            all_table_data.append([
                row_counter,
                "Revision",
                rev_val["metal"],
                rev_id,
                "",
                "",
                "",
                rev_val["name"],
                country,
                "",
                "",
                "",
                "Removed",
                "",
                rev_val["info"] or "Removed"
            ])

            if rev_id not in cid_to_status:
                cid_to_status[rev_id] = "removed"

            processed_ids.add(rev_id)
            row_counter += 1

    # Unique Status 집계
    unique_counts = {
        "conformant": sum(1 for s in cid_to_status.values() if s == "conformant"),
        "active": sum(1 for s in cid_to_status.values() if s == "active"),
        "identified": sum(1 for s in cid_to_status.values() if s == "identified"),
        "removed": sum(1 for s in cid_to_status.values() if s == "removed"),
        "others": sum(1 for s in cid_to_status.values() if s == "others")
    }

    summary_stats = {
        "total_logged": len(all_table_data),
        "unique_total": len(cid_to_status),
        "cmrt": original_source_counts["CMRT"],
        "emrt": original_source_counts["EMRT"],
        "amrt": original_source_counts["AMRT"],
        "revision": original_source_counts["Revision"],
        "eligible": original_source_counts["Eligible"],
        "public": original_source_counts["Public"],
        "timestamp": timestamp_full_str
    }

    # 6. 마스터 엑셀 워크북 빌드
    wb = openpyxl.Workbook()
    ws_summary = wb.active
    ws_summary.title = "Disclaimer & Summary"

    sum_headers = ["Data Consolidated", "CMRT", "EMRT", "AMRT", "Revision", "Eligible", "Public"]
    sum_values = [
        today_str,
        original_source_counts["CMRT"],
        original_source_counts["EMRT"],
        original_source_counts["AMRT"],
        original_source_counts["Revision"],
        original_source_counts["Eligible"],
        original_source_counts["Public"]
    ]

    for col_idx, h_text in enumerate(sum_headers, start=2):
        ws_summary.cell(row=2, column=col_idx, value=h_text)
    for col_idx, val in enumerate(sum_values, start=2):
        cell = ws_summary.cell(row=3, column=col_idx, value=val)
        if isinstance(val, (int, float)):
            cell.number_format = "#,##0"

    font_summary_header = Font(name="Pretendard", size=11, bold=True, color="1E293B")
    fill_summary_header = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    font_summary_body = Font(name="Pretendard", size=11)
    align_center = Alignment(horizontal="center", vertical="center")

    thin_side = Side(style="thin", color="CBD5E1")
    box_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    ws_summary.row_dimensions[2].height = 24
    ws_summary.row_dimensions[3].height = 22

    for col in range(2, 9):
        c_head = ws_summary.cell(row=2, column=col)
        c_head.font = font_summary_header
        c_head.fill = fill_summary_header
        c_head.alignment = align_center
        c_head.border = box_border

        c_val = ws_summary.cell(row=3, column=col)
        c_val.font = font_summary_body
        c_val.alignment = align_center
        c_val.border = box_border

    font_bold = InlineFont(b=True, rFont="Pretendard", sz=11, color="1E293B")
    font_normal = InlineFont(b=False, rFont="Pretendard", sz=11, color="1E293B")

    rich_disclaimer = CellRichText(
        TextBlock(font_bold, "a2MDS Consulting\n"),
        TextBlock(font_normal, "IMDS | Responsible·Conflict Minerals | Product Environmental Compliance | Supply Chain Due Diligence\n"),
        TextBlock(font_normal, "실무자의 복잡성을 해소하고 비용 효율적 운영을 통해 공급망 신뢰 가치를 창출합니다.\n\n"),
        TextBlock(font_bold, "Disclaimer\n"),
        TextBlock(font_normal, "본 자료는 RMI(Responsible Minerals Initiative) 웹사이트에서 제공하는 시설 및 제련소 목록을 기반으로 작성되었습니다.\n"),
        TextBlock(font_normal, "본 자료의 정보는 자료 송부일 이전에 확인된 내용을 기준으로 합니다.\n"),
        TextBlock(font_normal, "RMI 목록은 지속적으로 업데이트되므로, 본 자료의 작성일 이후 변경된 최신 정보와 차이가 있을 수 있습니다.\n"),
        TextBlock(font_normal, "따라서 본 자료는 통합 목록 예시로 활용하여 주시고, 최신 정보가 필요한 경우 RMI 공식 웹사이트에서 최신 제련소 및 시설 정보를 직접 확인하시기 바랍니다.\n\n"),
        TextBlock(font_bold, "RMI 제련소 및 시설 정보\n"),
        TextBlock(font_normal, "• 링크: https://www.responsiblemineralsinitiative.org/\n"),
        TextBlock(font_normal, "• 사용된 목록 정보: Smelter Reference Lists (CMRT, EMRT, AMRT, Revision), RMI Eligible Facilities List, RMI Public Facilities List")
    )

    ws_summary.merge_cells("B5:H5")
    cell_disclaimer = ws_summary.cell(row=5, column=2, value=rich_disclaimer)
    cell_disclaimer.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    ws_summary.row_dimensions[5].height = 360

    summary_widths = {1: 4, 2: 24, 3: 14, 4: 14, 5: 14, 6: 14, 7: 14, 8: 14}
    for col_idx, width in summary_widths.items():
        ws_summary.column_dimensions[get_column_letter(col_idx)].width = width

    ws_log = wb.create_sheet(title="Facility Log")
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

    ws_log.freeze_panes = "E2"
    ws_log.auto_filter.ref = ws_log.dimensions

    custom_widths = [6, 10, 12, 13, 16, 14, 10, 28, 16, 22, 14, 16, 16, 34, 38]
    for i, w in enumerate(custom_widths, 1):
        ws_log.column_dimensions[get_column_letter(i)].width = w

    # 임시 작업 폴더에 마스터 엑셀 저장
    output_filepath = os.path.join(TEMP_EXPORTS_DIR, f"{output_filename}.xlsx")
    wb.save(output_filepath)
    wb.close()

    print(f"\n✨ Master Excel File Generated: {output_filepath}")
    return output_filepath, summary_stats, headers_out, all_table_data, original_source_counts, len(cid_to_status), unique_counts


def upload_file_to_drive(service, file_path, folder_id):
    """Google Drive API를 이용해 지정 폴더에 파일 업로드 (동일 파일명 존재 시 덮어쓰기)"""
    file_name = os.path.basename(file_path)
    
    # 1. 대상 폴더에 동일 이름의 파일이 이미 있는지 검색
    query = f"'{folder_id}' in parents and name = '{file_name}' and trashed = false"
    response = service.files().list(q=query, spaces='drive', fields='files(id, name)').execute()
    existing_files = response.get('files', [])

    media = MediaFileUpload(file_path, resumable=True)

    if existing_files:
        # 기존 파일 덮어쓰기 (Update)
        target_file_id = existing_files[0]['id']
        updated_file = service.files().update(
            fileId=target_file_id,
            media_body=media
        ).execute()
        print(f"      [Drive Update] '{file_name}' overwritten.")
    else:
        # 신규 파일 업로드 (Create)
        file_metadata = {
            'name': file_name,
            'parents': [folder_id]
        }
        created_file = service.files().create(
            body=file_metadata,
            media_body=media,
            fields='id'
        ).execute()
        print(f"      [Drive Create] '{file_name}' uploaded.")


def sync_files_to_drive_folder():
    """클라우드 환경(Drive API)을 통해 마스터 산출물(엑셀 및 XML)을 Google Drive 대상 폴더로 원격 업로드"""
    print("\n   -> 📦 Syncing Master Files to Google Drive via Drive API...")
    if not GDRIVE_FOLDER_ID:
        print("   ⚠️ GDRIVE_FOLDER_ID is not configured. Skipping Drive upload.")
        return

    try:
        creds = get_google_credentials()
        drive_service = build('drive', 'v3', credentials=creds)

        valid_exts = ('.xml', '.xlsx')
        uploaded_count = 0
        for fname in os.listdir(TEMP_EXPORTS_DIR):
            if fname.lower().endswith(valid_exts) and not UUID_PATTERN.match(fname):
                fpath = os.path.join(TEMP_EXPORTS_DIR, fname)
                try:
                    upload_file_to_drive(drive_service, fpath, GDRIVE_FOLDER_ID)
                    uploaded_count += 1
                except Exception as e:
                    print(f"   ⚠️ Could not upload {fname} to Drive: {e}")

        print(f"   -> ✅ Successfully uploaded {uploaded_count} file(s) into Drive folder.")
    except Exception as ex:
        print(f"   ❌ [Google Drive API Sync Failed]: {ex}")


def sync_to_google_services_direct(headers, rows_data):
    """gspread 및 Google Sheets API를 통해 Smelter Log 시트에 데이터 직접 적재"""
    print("\n=========================================================")
    print(" ☁️ Phase 3: Syncing Live Google Spreadsheet (Direct SA)")
    print("=========================================================")

    creds = get_google_credentials()

    # 1. Google Drive 클라우드 폴더로 마스터 산출물 업로드
    sync_files_to_drive_folder()

    # 2. Google Spreadsheet 시트 덮어쓰기
    print("\n   -> 📊 Updating Google Spreadsheet directly via Sheets API...")
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(TARGET_SPREADSHEET_ID)

    target_sheet_name = "Smelter Log"
    try:
        ws = sh.worksheet(target_sheet_name)
    except gspread.exceptions.WorksheetNotFound:
        try:
            ws = sh.worksheet("Facility Log")
        except gspread.exceptions.WorksheetNotFound:
            ws = sh.add_worksheet(title=target_sheet_name, rows=len(rows_data) + 10, cols=len(headers) + 2)

    full_table = [headers] + rows_data

    # 기존 데이터 초기화 후 1회 API 호출로 전체 일괄 업데이트
    ws.clear()
    ws.update(values=full_table, range_name="A1")

    print(f"   -> ✅ [Live Sheet Updated]: Successfully updated {len(rows_data):,} rows directly into '{ws.title}'!")
    print("\n✅ Live Sync Completed Successfully!")


if __name__ == "__main__":
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    today_str = now_kst.strftime("%Y-%m-%d")
    today_file_tag = now_kst.strftime("%Y%m%d")
    timestamp_full_str = now_kst.strftime("%Y-%m-%d %H:%M:%S") + " KST (UTC+9)"
    timestamp_log_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")

    base_name = f"{BASE_TITLE}_{today_file_tag}"

    print(f"\n=== RMI Facility & Smelter Sync Started at {timestamp_full_str} ===")

    try:
        # 0. Google Sheet(Summary History)에서 직전 실행 요약 데이터 직접 조회
        prev_summary = fetch_previous_summary_direct()
        prev_raw = prev_summary.get("raw_sources", {})
        prev_unique = prev_summary.get("unique_status", {})

        run_live_pipeline()
        excel_path, stats, headers, rows_data, raw_counts, unique_id_count, unique_counts = consolidate_and_export(
            base_name, timestamp_full_str, today_str
        )

        # Service Account 직접 연동 호출
        sync_to_google_services_direct(headers, rows_data)
        log_summary_to_sheets_direct(timestamp_log_str, raw_counts, len(rows_data), unique_id_count, unique_counts)

        # 1. Ratios and Diffs Calculation
        total_sources_sum = sum(raw_counts.values())
        prev_total_sources = prev_raw.get("total")
        raw_ratios = {
            k: (v / total_sources_sum * 100) if total_sources_sum > 0 else 0.0
            for k, v in raw_counts.items()
        }

        total_unique = unique_id_count
        prev_total_unique = prev_unique.get("total")
        unique_ratios = {
            k: (v / total_unique * 100) if total_unique > 0 else 0.0
            for k, v in unique_counts.items()
        }

        # Mobile KPI 카드용 차이값 계산
        diff_total = (total_unique - prev_total_unique) if prev_total_unique is not None else 0
        curr_conf = unique_counts["conformant"]
        prev_conf = prev_unique.get("conformant")
        diff_conf = (curr_conf - prev_conf) if prev_conf is not None else 0

        # =============================================================
        # 🔍 변동 여부(has_changes) 전수 판별 (11개 핵심 수치 비교)
        # =============================================================
        if not prev_raw or not prev_unique:
            has_changes = False
        else:
            raw_keys = ["CMRT", "EMRT", "AMRT", "Revision", "Eligible", "Public"]
            raw_changed = any(raw_counts.get(k) != prev_raw.get(k) for k in raw_keys)

            status_keys = ["conformant", "active", "identified", "removed", "others"]
            status_changed = any(unique_counts.get(k) != prev_unique.get(k) for k in status_keys)

            has_changes = raw_changed or status_changed

        print(f"📊 [Diff Analysis] Raw Changed: {raw_changed if (prev_raw and prev_unique) else 'N/A'}, Status Changed: {status_changed if (prev_raw and prev_unique) else 'N/A'} -> Has Changes: {has_changes}")

        def make_kpi_diff(diff_val, prev_val):
            if prev_val is None:
                return '<span style="color: #94a3b8; font-size: 13px; font-weight: 500;">-</span>'
            if diff_val > 0:
                return f'<span style="color: #16a34a; font-size: 13px; font-weight: 700;">▲ +{diff_val:,}</span>'
            elif diff_val < 0:
                return f'<span style="color: #dc2626; font-size: 13px; font-weight: 700;">▼ {diff_val:,}</span>'
            return '<span style="color: #94a3b8; font-size: 13px; font-weight: 500;">- (변동 없음)</span>'

        mob_badge_bg = "#f0fdf4" if not has_changes else "#eff6ff"
        mob_badge_border = "#bbf7d0" if not has_changes else "#bfdbfe"
        mob_badge_color = "#15803d" if not has_changes else "#1d4ed8"
        mob_status_text = "NO CHANGES" if not has_changes else "UPDATED"

        # 2. Build Hybrid Email HTML Report
        change_tag = "No Change" if not has_changes else "Updated"
        success_subject = f"[{change_tag}] RMI Smelter Intelligence Report ({today_file_tag})"
        success_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>RMI Facility Intelligence Report</title>
    <style>
        .mobile-only {{
            display: none;
            max-height: 0px;
            overflow: hidden;
            mso-hide: all;
        }}
        .desktop-only {{
            display: block;
        }}

        @media only screen and (max-width: 600px) {{
            .desktop-only {{
                display: none !important;
                max-height: 0px !important;
                overflow: hidden !important;
            }}
            .mobile-only {{
                display: block !important;
                max-height: none !important;
                overflow: visible !important;
            }}
            .btn-cta {{
                display: block !important;
                width: 100% !important;
                box-sizing: border-box !important;
                text-align: center !important;
                padding: 12px 0 !important;
            }}
        }}
    </style>
</head>
<body style="margin: 0; padding: 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1f2937; -webkit-text-size-adjust: 100%;">
    <div style="width: 100%; max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); box-sizing: border-box;">
        
        <!-- Header Section -->
        <div style="padding: 20px 18px 14px 18px; box-sizing: border-box;">
            <h1 style="margin: 0 0 14px 0; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px; line-height: 1.3;">
                RMI Facility Intelligence Report
            </h1>
            <div style="height: 3px; background-color: #16a34a; border-radius: 2px; margin-bottom: 14px;"></div>
            <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                <strong style="color: #334155;">Execution Time:</strong> {timestamp_full_str}
            </p>
        </div>

        <!-- Main Report Container -->
        <div style="padding: 0 18px 18px 18px; box-sizing: border-box;">

            <!-- [MOBILE-ONLY VIEW] -->
            <div class="mobile-only">
                <div style="margin-bottom: 14px; text-align: right;">
                    <span style="font-size: 11px; font-weight: 700; color: {mob_badge_color}; background-color: {mob_badge_bg}; padding: 4px 10px; border-radius: 9999px; border: 1px solid {mob_badge_border}; display: inline-block;">
                        {mob_status_text}
                    </span>
                </div>

                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 4px;">
                        Total Unique Smelters
                    </div>
                    <div style="display: flex; align-items: baseline; justify-content: space-between;">
                        <span style="font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">
                            {total_unique:,}
                        </span>
                        <span style="font-size: 12px; color: #64748b;">
                            전일 대비 {make_kpi_diff(diff_total, prev_total_unique)}
                        </span>
                    </div>
                </div>

                <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-bottom: 18px;">
                    <div style="font-size: 12px; color: #166534; font-weight: 600; margin-bottom: 4px;">
                        Conformant (적격 제련소)
                    </div>
                    <div style="display: flex; align-items: baseline; justify-content: space-between;">
                        <span style="font-size: 24px; font-weight: 800; color: #15803d; letter-spacing: -0.5px;">
                            {curr_conf:,}
                        </span>
                        <span style="font-size: 12px; color: #166534;">
                            전일 대비 {make_kpi_diff(diff_conf, prev_conf)}
                        </span>
                    </div>
                </div>
            </div>

            <!-- [DESKTOP-ONLY VIEW] -->
            <div class="desktop-only">
                <div style="margin-bottom: 22px;">
                    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                        1. Original Source Counts (Raw File)
                    </div>
                    <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 380px;">
                            <thead>
                                <tr style="background-color: #16a34a; color: #ffffff;">
                                    <th style="padding: 8px 10px; border: 1px solid #16a34a; font-weight: 600;">Source</th>
                                    <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: right; font-weight: 600; width: 70px; white-space: nowrap;">Count</th>
                                    <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: right; font-weight: 600; width: 60px; white-space: nowrap;">Ratio</th>
                                    <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: center; font-weight: 600; width: 80px; white-space: nowrap;">vs Prev Day</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">CMRT (3TG)</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['CMRT']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['CMRT']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['CMRT'], prev_raw.get('CMRT'))}</td>
                                </tr>
                                <tr style="background-color: #f8fafc;">
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">EMRT (Cobalt / Mica)</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['EMRT']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['EMRT']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['EMRT'], prev_raw.get('EMRT'))}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">AMRT (Aluminum)</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['AMRT']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['AMRT']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['AMRT'], prev_raw.get('AMRT'))}</td>
                                </tr>
                                <tr style="background-color: #f8fafc;">
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">Revision History</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Revision']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Revision']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Revision'], prev_raw.get('Revision'))}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">Eligible Facilities List</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Eligible']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Eligible']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Eligible'], prev_raw.get('Eligible'))}</td>
                                </tr>
                                <tr style="background-color: #f8fafc;">
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">RMI Public Facilities List</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Public']:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Public']:.1f}%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Public'], prev_raw.get('Public'))}</td>
                                </tr>
                                <tr style="background-color: #f0fdf4; font-weight: 700;">
                                    <td style="padding: 8px 10px; border: 1px solid #bbf7d0; color: #166534;">Total Sources Sum</td>
                                    <td style="padding: 8px 10px; border: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">{total_sources_sum:,}</td>
                                    <td style="padding: 8px 10px; border: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">100.0%</td>
                                    <td style="padding: 8px 10px; border: 1px solid #bbf7d0; text-align: center; color: #166534; white-space: nowrap;">{format_diff_badge(total_sources_sum, prev_total_sources)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style="margin-bottom: 22px;">
                    <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                        2. Consolidated Master Database (Unique CIDs)
                    </div>
                    <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #e2e8f0; border-radius: 4px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 520px;">
                            <thead>
                                <tr style="background-color: #16a34a; color: #ffffff;">
                                    <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; font-weight: 600; white-space: nowrap;">DD Status</th>
                                    <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; text-align: right; font-weight: 600; width: 75px; white-space: nowrap;">Facilities</th>
                                    <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; text-align: right; font-weight: 600; width: 60px; white-space: nowrap;">Ratio</th>
                                    <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; text-align: center; font-weight: 600; width: 80px; white-space: nowrap;">vs Prev Day</th>
                                    <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; font-weight: 600;">Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px 10px; font-weight: 600; color: #15803d; white-space: nowrap;">Conformant</td>
                                    <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['conformant']:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['conformant']:.1f}%</td>
                                    <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['conformant'], prev_unique.get('conformant'))}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Fully conformant with RMAP standards</td>
                                </tr>
                                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px 10px; font-weight: 600; color: #1d4ed8; white-space: nowrap;">Active</td>
                                    <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['active']:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['active']:.1f}%</td>
                                    <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['active'], prev_unique.get('active'))}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Participating in assessment program</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px 10px; font-weight: 600; color: #4b5563; white-space: nowrap;">Identified</td>
                                    <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['identified']:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['identified']:.1f}%</td>
                                    <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['identified'], prev_unique.get('identified'))}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Listed operational (Non-assessed)</td>
                                </tr>
                                <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px 10px; font-weight: 600; color: #b91c1c; white-space: nowrap;">Removed</td>
                                    <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['removed']:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['removed']:.1f}%</td>
                                    <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['removed'], prev_unique.get('removed'))}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">De-listed / Inactive facilities</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #e2e8f0;">
                                    <td style="padding: 8px 10px; font-weight: 600; color: #7c3aed; white-space: nowrap;">Others</td>
                                    <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['others']:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['others']:.1f}%</td>
                                    <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['others'], prev_unique.get('others'))}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Facility Standard Assessed, In Communication</td>
                                </tr>
                                <tr style="background-color: #f0fdf4; font-weight: 700;">
                                    <td style="padding: 8px 10px; color: #166534; white-space: nowrap;">Total Unique</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #166534; white-space: nowrap;">{total_unique:,}</td>
                                    <td style="padding: 8px 10px; text-align: right; color: #166534; white-space: nowrap;">100.0%</td>
                                    <td style="padding: 8px 10px; text-align: center; color: #166534; white-space: nowrap;">{format_diff_badge(total_unique, prev_total_unique)}</td>
                                    <td style="padding: 8px 10px; font-size: 11px; color: #166534;">Deduplicated Master CID Base</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- View Records Button Section -->
            <div style="margin-top: 24px; margin-bottom: 8px; text-align: center;">
                <a href="https://docs.google.com/spreadsheets/d/{TARGET_SPREADSHEET_ID}/edit" target="_blank" class="btn-cta" style="display: inline-block; padding: 10px 24px; background-color: #16a34a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; letter-spacing: -0.2px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">
                    View Records &rarr;
                </a>
            </div>

        </div>

        <!-- Footer -->
        <div style="padding: 12px 16px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
            This automated email was sent by RMI Smelter Sync Bot. Please do not reply directly to this mail.
        </div>
    </div>
</body>
</html>"""
        send_email_report(success_subject, success_body)

    except Exception as e:
        error_trace = sanitize_traceback(traceback.format_exc())
        print("\n" + "=" * 57)
        print(" ❌ PIPELINE ERROR OCCURRED")
        print("=" * 57)
        print(f"Error Type: {type(e).__name__}")
        print(f"Error Message: {str(e)}\n")
        print("Detailed Traceback (Sanitized):")
        print(error_trace)
        print("=" * 57 + "\n")

        fail_subject = f"RMI Facility Sync Error Alert ({today_file_tag})"
        fail_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Pipeline Failure Alert</title>
</head>
<body style="margin: 0; padding: 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; -webkit-text-size-adjust: 100%;">
    <div style="width: 100%; max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #fee2e2; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); box-sizing: border-box;">
        
        <div style="padding: 20px 18px 14px 18px; box-sizing: border-box;">
            <h1 style="margin: 0 0 14px 0; font-size: 20px; font-weight: 800; color: #991b1b; letter-spacing: -0.4px; line-height: 1.3;">
                RMI Facility Monitoring (Error Alert)
            </h1>
            <div style="height: 3px; background-color: #dc2626; border-radius: 2px; margin-bottom: 14px;"></div>
            <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                <strong style="color: #334155;">Failed Time:</strong> {timestamp_full_str}
            </p>
        </div>

        <div style="padding: 0 18px 18px 18px; box-sizing: border-box;">
            <p style="margin: 0 0 14px 0; font-size: 13px; line-height: 1.5; color: #334155;">
                Dear Mr. CEO,<br>
                An error occurred during the automated synchronization pipeline. The operation has been halted.
            </p>
            <div style="background-color: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px;">
                <div style="font-size: 12px; color: #9f1239; margin-bottom: 4px;"><strong>Error Type:</strong> {type(e).__name__}</div>
                <div style="font-size: 12px; color: #9f1239; word-break: break-all;"><strong>Error Message:</strong> {str(e)}</div>
            </div>
            <div style="font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
                Sanitized Traceback:
            </div>
            <pre style="background-color: #0f172a; color: #f8fafc; padding: 12px; border-radius: 6px; font-size: 11px; line-height: 1.4; overflow-x: auto; white-space: pre-wrap; word-break: break-all;">{error_trace}</pre>
            <p style="margin: 14px 0 0 0; font-size: 11px; color: #64748b;">
                ※ You can forward this entire error traceback directly to ReS for prompt analysis and troubleshooting.
            </p>
        </div>
    </div>
</body>
</html>
"""
        send_email_report(fail_subject, fail_body)
        sys.exit(1)
    finally:
        # 안전한 임시 작업 폴더(exports)만 완전히 정리
        if os.path.exists(TEMP_EXPORTS_DIR):
            try:
                shutil.rmtree(TEMP_EXPORTS_DIR)
                print(f"🔒 [Security Complete] Temporary exports folder cleaned.")
            except Exception:
                pass
