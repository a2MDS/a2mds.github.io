import os
import sys
import time
import json
import base64
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
from openpyxl.cell.rich_text import TextBlock, CellRichText
from openpyxl.cell.text import InlineFont
from playwright.sync_api import sync_playwright

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
    "PUBLIC": "https://www.sbsolutionsllc.net/eicc/smelter-conformant-active/",
    "ELIGIBLE": "https://c0eku224.caspio.com/dp/0c4a30001fb4dc1742cd4c88bda8"
}

BASE_TITLE = "RMI Smelter Data Sync"
UUID_PATTERN = re.compile(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')


def sanitize_traceback(tb_str: str) -> str:
    sanitized = re.sub(r'([A-Za-z]:\\[^:\n\r]+|\/[a-zA-Z0-9_\.\-]+(?:\/[a-zA-Z0-9_\.\-]+)+)', '[INTERNAL_FILE_PATH]',
                       tb_str)
    sanitized = re.sub(r'(auth|password|key|token|secret)[\'"]?\s*[:=]\s*[\'"][^\'"]+[\'"]', r'\1: "***MASKED***"',
                       sanitized, flags=re.IGNORECASE)
    return sanitized


def send_daily_email_report(subject: str, body_html: str):
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("\n⚠️ [Email Notification Skipped]: Missing email credentials.")
        return

    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = f"Daily RMI Smelter Harvest <{EMAIL_SENDER}>"
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


def download_caspio_direct(page, target_name, url, max_retries=3):
    save_path = os.path.join(EXPORTS_DIR, f"{target_name}.xml")
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
        save_path = os.path.join(EXPORTS_DIR, f"PUBLIC{ext}")
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
            downloads_path=EXPORTS_DIR,
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


def send_gas_request_with_retry(payload: dict, context_name: str, max_retries: int = 3, initial_delay: int = 6) -> dict:
    last_error_text = ""
    last_status = 0

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(
                GAS_WEBAPP_URL,
                headers={"Content-Type": "text/plain;charset=utf-8"},
                data=json.dumps(payload),
                timeout=60,
                allow_redirects=True
            )
            last_status = resp.status_code
            last_error_text = resp.text

            if resp.status_code in [404, 429, 500, 502, 503, 504]:
                if attempt < max_retries:
                    wait_sec = initial_delay * attempt
                    print(
                        f"   ⚠️ [{context_name}] Status {resp.status_code} (Google Transient Error). Retrying in {wait_sec}s ({attempt}/{max_retries})...")
                    time.sleep(wait_sec)
                    continue
                else:
                    raise Exception(
                        f"[{context_name}] Failed after {max_retries} attempts. Status: {last_status}, Response: {last_error_text[:300]}")

            resp_json = {}
            try:
                resp_json = resp.json()
            except Exception:
                pass

            if resp.status_code == 200 and resp_json.get("status") == "success":
                return resp_json
            else:
                if attempt < max_retries:
                    wait_sec = initial_delay * attempt
                    print(
                        f"   ⚠️ [{context_name}] Non-success response: {resp.text[:120]}. Retrying in {wait_sec}s ({attempt}/{max_retries})...")
                    time.sleep(wait_sec)
                    continue
                else:
                    raise Exception(
                        f"[{context_name}] GAS returned error. Status: {resp.status_code}, Response: {resp.text}")

        except requests.exceptions.RequestException as e:
            if attempt < max_retries:
                wait_sec = initial_delay * attempt
                print(
                    f"   ⚠️ [{context_name}] Network/Timeout Exception: {e}. Retrying in {wait_sec}s ({attempt}/{max_retries})...")
                time.sleep(wait_sec)
            else:
                raise e

    raise Exception(f"[{context_name}] All {max_retries} attempts exhausted.")


def log_summary_to_gas_history(timestamp_log_str, original_source_counts, total_logged_count, unique_id_count):
    if not GAS_WEBAPP_URL:
        print("⚠️ GAS_WEBAPP_URL is missing. Cannot record summary history.")
        return

    total_sources_sum = sum(original_source_counts.values())

    payload = {
        "action": "record_summary_history",
        "auth": GAS_AUTH_KEY,
        "record": {
            "date": timestamp_log_str,
            "cmrt": original_source_counts["CMRT"],
            "emrt": original_source_counts["EMRT"],
            "amrt": original_source_counts["AMRT"],
            "revision": original_source_counts["Revision"],
            "eligible": original_source_counts["Eligible"],
            "public": original_source_counts["Public"],
            "total": total_sources_sum,
            "logged": total_logged_count,
            "unique_id": unique_id_count
        }
    }

    try:
        send_gas_request_with_retry(payload, context_name="Record Summary History", max_retries=3, initial_delay=4)
        print(f"   -> 📈 [Summary History Logged]: Successfully appended row to Google Sheet 'Summary History'.")
    except Exception as e:
        print(f"   ⚠️ Could not record summary history to GAS: {e}")


def consolidate_and_export(output_filename, timestamp_full_str, today_str):
    print("\n=========================================================")
    print(" 📊 Phase 2: Data Parsing, RMAP Mapping & Consolidation")
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
        os.path.join(EXPORTS_DIR, f) for f in os.listdir(EXPORTS_DIR)
        if f.startswith("PUBLIC.") or f.startswith("PUBLIC_LIST.")
    ]
    if not pub_candidates:
        raise ValueError("PUBLIC download file not found in exports directory.")

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
        os.path.join(EXPORTS_DIR, f) for f in os.listdir(EXPORTS_DIR)
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
    rev_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "REVISIONS.xml"))
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
        t_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, f"{t_name}.xml"))
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
        "State Province", "RMAP Status", "Audit / Cycle / Reaudit", "Revision History"
    ]

    all_table_data = []
    processed_ids = set()
    conformant_matched_count = 0
    active_matched_count = 0
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
                conformant_matched_count += 1
                audit_info = f"{pub_info['audit_date']} / {pub_info['cycle']} / {pub_info['reaudit']}"
            elif "active" in rmap_status.lower() or "participat" in rmap_status.lower():
                active_matched_count += 1

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
                    conformant_matched_count += 1
                    audit_info = f"{pub_info['audit_date']} / {pub_info['cycle']} / {pub_info['reaudit']}"
                elif "active" in rmap_status.lower() or "participat" in rmap_status.lower():
                    active_matched_count += 1

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
            processed_ids.add(elg_cid)
            row_counter += 1

    # 5-3. Public List 단독 시설 추가 머지
    for pub_cid, pub_val in public_facility_map.items():
        if pub_cid not in processed_ids:
            country = pub_val["country"]
            rmap_status = pub_val["rmap_status"]
            audit_info = ""

            if "conform" in rmap_status.lower():
                conformant_matched_count += 1
                audit_info = f"{pub_val['audit_date']} / {pub_val['cycle']} / {pub_val['reaudit']}"
            elif "active" in rmap_status.lower() or "participat" in rmap_status.lower():
                active_matched_count += 1

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
            processed_ids.add(pub_cid)
            row_counter += 1

    # 5-4. Revision History (삭제된 제련소) 머지
    removed_count = 0
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
            processed_ids.add(rev_id)
            removed_count += 1
            row_counter += 1

    total_facilities = len(all_table_data)
    standard_count = total_facilities - conformant_matched_count - active_matched_count - removed_count

    summary_stats = {
        "total": total_facilities,
        "cmrt": original_source_counts["CMRT"],
        "emrt": original_source_counts["EMRT"],
        "amrt": original_source_counts["AMRT"],
        "revision": original_source_counts["Revision"],
        "eligible": original_source_counts["Eligible"],
        "public": original_source_counts["Public"],
        "conformant": conformant_matched_count,
        "active": active_matched_count,
        "standard": standard_count,
        "removed": removed_count,
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
        TextBlock(font_normal, "글로벌 제품환경규제 대응 전문기업\n"),
        TextBlock(font_normal, "IMDS | Responsible·Conflict Minerals | Product Environmental Compliance | Supply Chain Due Diligence\n"),
        TextBlock(font_normal, "APA Engineering과의 전략적 파트너십을 기반으로, 교육부터 컨설팅, 아웃소싱, 자동화 솔루션까지 One-stop으로 지원합니다.\n\n"),
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

    output_filepath = os.path.join(EXPORTS_DIR, f"{output_filename}.xlsx")
    wb.save(output_filepath)
    wb.close()

    print(f"\n✨ Master Excel File Generated: {output_filepath}")
    return output_filepath, summary_stats, headers_out, all_table_data, original_source_counts, len(processed_ids)


def upload_file_via_gas(filepath, filename, mime_type):
    if not GAS_WEBAPP_URL:
        print("⚠️ GAS_WEBAPP_URL is missing. Cannot upload file.")
        return

    try:
        with open(filepath, "rb") as f:
            encoded_bytes = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "action": "upload_file",
            "auth": GAS_AUTH_KEY,
            "fileName": filename,
            "mimeType": mime_type,
            "fileData": encoded_bytes
        }

        send_gas_request_with_retry(payload, context_name=f"Upload {filename}", max_retries=3, initial_delay=6)
        print(f"   -> ⬆️ [GAS Uploaded]: {filename}")
    except Exception as e:
        print(f"   -> ❌ GAS File Upload Exception: {e}")


def sync_to_google_services(excel_filepath, headers, rows_data):
    print("\n=========================================================")
    print(" ☁️ Phase 3: Syncing Files & Live Google Spreadsheet")
    print("=========================================================")

    VALID_EXTENSIONS = ('.xml', '.xlsx')
    current_local_files = [
        f for f in os.listdir(EXPORTS_DIR)
        if os.path.isfile(os.path.join(EXPORTS_DIR, f))
           and f.lower().endswith(VALID_EXTENSIONS)
           and not UUID_PATTERN.match(f)
    ]

    print(f"📦 Total files to sync to Google Drive ({len(current_local_files)} files): {current_local_files}")
    for fname in current_local_files:
        fpath = os.path.join(EXPORTS_DIR, fname)
        if fname.endswith('.xlsx'):
            mtype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        else:
            mtype = 'application/xml'
        upload_file_via_gas(fpath, fname, mtype)

    if not GAS_WEBAPP_URL:
        raise ValueError("GAS_WEBAPP_URL environment variable is missing. Cannot sync to Google Spreadsheet.")

    print("\n   -> 📊 Updating Google Spreadsheet via Apps Script Live DB...")
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

            send_gas_request_with_retry(
                payload,
                context_name=f"Chunk {i + 1}/{total_chunks}",
                max_retries=3,
                initial_delay=6
            )

            print(f"   -> ⏳ Synced chunk ({i + 1}/{total_chunks}) to Live Sheet...")

        print("   -> ✅ [Live Sheet Updated]: Successfully synced master data and refreshed Latest Harvest time!")
    except Exception as e:
        print(f"\n❌ Live Sheet Update Failed: {e}")
        traceback.print_exc(file=sys.stdout)
        raise e

    print("\n✅ Google Drive & Live Sync Completed Successfully!")


if __name__ == "__main__":
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    today_str = now_kst.strftime("%Y-%m-%d")
    today_file_tag = now_kst.strftime("%Y%m%d")
    timestamp_full_str = now_kst.strftime("%Y-%m-%d %H:%M:%S") + " KST (UTC+9)"
    timestamp_log_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")

    base_name = f"{BASE_TITLE}_{today_file_tag}"

    print(f"\n=== RMI Facility & Smelter Daily Sync Started at {timestamp_full_str} ===")

    try:
        run_live_pipeline()
        excel_path, stats, headers, rows_data, raw_counts, unique_id_count = consolidate_and_export(
            base_name, timestamp_full_str, today_str
        )

        sync_to_google_services(excel_path, headers, rows_data)
        log_summary_to_gas_history(timestamp_log_str, raw_counts, len(rows_data), unique_id_count)

        # Calculate Statistics for HTML Tables
        total_sources_sum = sum(raw_counts.values())
        raw_ratios = {
            k: (v / total_sources_sum * 100) if total_sources_sum > 0 else 0.0
            for k, v in raw_counts.items()
        }

        total_master = stats["total"]
        db_ratios = {
            "conformant": (stats["conformant"] / total_master * 100) if total_master > 0 else 0.0,
            "active": (stats["active"] / total_master * 100) if total_master > 0 else 0.0,
            "standard": (stats["standard"] / total_master * 100) if total_master > 0 else 0.0,
            "removed": (stats["removed"] / total_master * 100) if total_master > 0 else 0.0,
        }

        success_subject = f"✅ [SUCCESS] RMI Smelter & Facility Daily Intelligence Report ({today_file_tag})"
        success_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>RMI Smelter & Facility Daily Intelligence Report</title>
</head>
<body style="margin: 0; padding: 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1f2937; -webkit-text-size-adjust: 100%;">
    <div style="width: 100%; max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); box-sizing: border-box;">
        
        <!-- Brand Header Bar (Mobile-safe Table Layout) -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse; border-bottom: 3px solid #16a34a; background-color: #ffffff;">
            <tr>
                <td style="padding: 16px 18px; text-align: left; vertical-align: middle;">
                    <div style="font-size: 18px; font-weight: 700; color: #111827; letter-spacing: -0.3px;">
                        <span style="background-color: #16a34a; color: #ffffff; border-radius: 4px; padding: 2px 6px; font-size: 14px; margin-right: 4px; display: inline-block;">a2</span>MDS <span style="color: #16a34a;">Consulting</span>
                    </div>
                </td>
                <td style="padding: 16px 18px; text-align: right; vertical-align: middle;">
                    <span style="font-size: 11px; font-weight: 600; color: #16a34a; background-color: #f0fdf4; padding: 4px 8px; border-radius: 9999px; border: 1px solid #bbf7d0; white-space: nowrap; display: inline-block;">
                        PIPELINE SUCCESS
                    </span>
                </td>
            </tr>
        </table>

        <!-- Main Report Container -->
        <div style="padding: 18px 16px; box-sizing: border-box;">
            <h1 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.4px; line-height: 1.3;">
                RMI Smelter &amp; Facility Daily Intelligence Report
            </h1>
            <p style="margin: 0 0 16px 0; font-size: 12px; color: #64748b;">
                Execution Time: <strong>{timestamp_full_str}</strong>
            </p>

            <p style="margin: 0 0 20px 0; font-size: 13px; line-height: 1.5; color: #334155;">
                Dear Mr. CEO,<br>
                The automated harvesting, multi-tier supply chain consolidation, and cloud database synchronization have been successfully completed.
            </p>

            <!-- Table 1: Raw Ingestion -->
            <div style="margin-bottom: 22px;">
                <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                    1. Original Source Counts (Raw File)
                </div>
                <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 320px;">
                        <thead>
                            <tr style="background-color: #16a34a; color: #ffffff;">
                                <th style="padding: 8px 10px; border: 1px solid #16a34a; font-weight: 600;">Source</th>
                                <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: right; font-weight: 600; width: 75px; white-space: nowrap;">Count</th>
                                <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: right; font-weight: 600; width: 65px; white-space: nowrap;">Ratio</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">CMRT (3TG)</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['cmrt']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['CMRT']:.1f}%</td>
                            </tr>
                            <tr style="background-color: #f8fafc;">
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">EMRT (Cobalt / Mica)</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['emrt']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['EMRT']:.1f}%</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">AMRT (Aluminum)</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['amrt']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['AMRT']:.1f}%</td>
                            </tr>
                            <tr style="background-color: #f8fafc;">
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">Revision History</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['revision']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Revision']:.1f}%</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">Eligible Facilities List</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['eligible']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Eligible']:.1f}%</td>
                            </tr>
                            <tr style="background-color: #f8fafc;">
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0;">RMI Public Facilities List</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['public']:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #e2e8f0; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Public']:.1f}%</td>
                            </tr>
                            <tr style="background-color: #f0fdf4; font-weight: 700;">
                                <td style="padding: 8px 10px; border: 1px solid #bbf7d0; color: #166534;">Total Sources Sum</td>
                                <td style="padding: 8px 10px; border: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">{total_sources_sum:,}</td>
                                <td style="padding: 8px 10px; border: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">100.0%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Table 2: Consolidated Master DB (Responsive Scroll Wrapper) -->
            <div style="margin-bottom: 22px;">
                <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                    2. Consolidated Master Database
                </div>
                <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #e2e8f0; border-radius: 4px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 480px;">
                        <thead>
                            <tr style="background-color: #16a34a; color: #ffffff;">
                                <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; font-weight: 600; white-space: nowrap;">RMAP Status</th>
                                <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; text-align: right; font-weight: 600; width: 90px; white-space: nowrap;">Facilities</th>
                                <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; text-align: right; font-weight: 600; width: 65px; white-space: nowrap;">Ratio</th>
                                <th style="padding: 8px 10px; border-bottom: 1px solid #16a34a; font-weight: 600;">Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 8px 10px; font-weight: 600; color: #15803d; white-space: nowrap;">Conformant</td>
                                <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['conformant']:,}</td>
                                <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{db_ratios['conformant']:.1f}%</td>
                                <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Fully conformant with RMAP standards</td>
                            </tr>
                            <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 8px 10px; font-weight: 600; color: #1d4ed8; white-space: nowrap;">Active</td>
                                <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['active']:,}</td>
                                <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{db_ratios['active']:.1f}%</td>
                                <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Participating in assessment program</td>
                            </tr>
                            <tr style="border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 8px 10px; font-weight: 600; color: #4b5563; white-space: nowrap;">Standard (-)</td>
                                <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['standard']:,}</td>
                                <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{db_ratios['standard']:.1f}%</td>
                                <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Listed operational (Non-assessed)</td>
                            </tr>
                            <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                <td style="padding: 8px 10px; font-weight: 600; color: #b91c1c; white-space: nowrap;">Removed</td>
                                <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{stats['removed']:,}</td>
                                <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{db_ratios['removed']:.1f}%</td>
                                <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">De-listed / Inactive facilities</td>
                            </tr>
                            <tr style="background-color: #f0fdf4; font-weight: 700;">
                                <td style="padding: 8px 10px; color: #166534; white-space: nowrap;">Total Master</td>
                                <td style="padding: 8px 10px; text-align: right; color: #166534; white-space: nowrap;">{stats['total']:,}</td>
                                <td style="padding: 8px 10px; text-align: right; color: #166534; white-space: nowrap;">100.0%</td>
                                <td style="padding: 8px 10px; font-size: 11px; color: #166534;">Unique CID: <strong>{unique_id_count:,}</strong></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Bullet Section: System & Cloud Synchronization -->
            <div style="background-color: #f8fafc; border-left: 4px solid #16a34a; padding: 12px 14px; border-radius: 0 6px 6px 0;">
                <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
                    • System &amp; Cloud Synchronization
                </div>
                <ul style="margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.5; color: #334155;">
                    <li style="margin-bottom: 6px;">
                        <strong>Master File Archive</strong>: <code style="word-break: break-all;">{base_name}.xlsx</code> (Google Drive sync complete)
                    </li>
                    <li>
                        <strong>Live Sheet Database</strong>: Synced via Apps Script chunks &amp; timestamp refreshed.
                        <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                            └ <em>Summary history logged to 'Summary History' tab ({timestamp_log_str})</em>
                        </div>
                    </li>
                </ul>
            </div>

        </div>

        <!-- Footer -->
        <div style="padding: 12px 16px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
            This automated email was sent by RMI Smelter Sync Bot. Please do not reply directly to this mail.
        </div>
    </div>
</body>
</html>"""
        send_daily_email_report(success_subject, success_body)

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

        fail_subject = f"🚨 [FAILURE] RMI Smelter & Facility Sync Error Alert ({today_file_tag})"
        fail_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>Pipeline Failure Alert</title>
</head>
<body style="margin: 0; padding: 12px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; -webkit-text-size-adjust: 100%;">
    <div style="width: 100%; max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; border: 1px solid #fee2e2; overflow: hidden; box-sizing: border-box;">
        <div style="padding: 14px 18px; border-bottom: 3px solid #dc2626; background-color: #fef2f2;">
            <div style="font-size: 15px; font-weight: 700; color: #991b1b;">
                🚨 Automated Pipeline Error Alert
            </div>
        </div>
        <div style="padding: 18px 16px; box-sizing: border-box;">
            <p style="margin: 0 0 14px 0; font-size: 13px; line-height: 1.5; color: #334155;">
                Dear Mr. CEO,<br>
                An error occurred during the daily automated synchronization pipeline. The operation has been halted.
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
</html>"""
        send_daily_email_report(fail_subject, fail_body)
        sys.exit(1)
    finally:
        purge_all_local_exports()
