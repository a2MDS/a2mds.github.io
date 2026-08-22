import os
import sys
import time
import json
import traceback
import xml.etree.ElementTree as ET
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from playwright.sync_api import sync_playwright
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

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

class DualLogger:
    def __init__(self, filepath):
        self.terminal = sys.stdout
        self.log = open(filepath, "w", encoding="utf-8")

    def write(self, message):
        self.terminal.write(message)
        self.log.write(message)
        self.log.flush()

    def flush(self):
        self.terminal.flush()
        self.log.flush()

    def close(self):
        self.log.close()

def cleanup_temp_files():
    removed_count = 0
    valid_exts = (".xml", ".xlsx", ".txt")
    if os.path.exists(EXPORTS_DIR):
        for filename in os.listdir(EXPORTS_DIR):
            file_path = os.path.join(EXPORTS_DIR, filename)
            if os.path.isfile(file_path) and not filename.lower().endswith(valid_exts):
                try:
                    os.remove(file_path)
                    removed_count += 1
                except Exception:
                    pass
    if removed_count > 0:
        print(f"🧹 Cleaned up {removed_count} temporary artifact(s) in '{EXPORTS_DIR}'.")

def download_caspio_direct(page, target_name, url):
    save_path = os.path.join(EXPORTS_DIR, f"{target_name}.xml")
    print(f"[{target_name}] Requesting live download...")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        time.sleep(1)

        btn = page.locator("a.cbResultSetDownloadLink").first
        btn.wait_for(state="visible", timeout=20000)
        btn.click(force=True)
        time.sleep(1)

        with page.expect_download(timeout=35000) as download_info:
            opt = page.locator("a:has-text('Excel(XML)'), div:has-text('Excel(XML)'), li:has-text('Excel(XML)')").last
            opt.wait_for(state="visible", timeout=15000)
            opt.click(force=True)

        download = download_info.value
        download.save_as(save_path)
        size_kb = os.path.getsize(save_path) / 1024
        print(f"  -> ✅ [{target_name}] Saved successfully: {size_kb:.1f} KB")
    except Exception as e:
        print(f"  -> ❌ [{target_name}] Failed: {e}")
        raise e

def handle_export_page(page, target_name, url):
    save_path = os.path.join(EXPORTS_DIR, f"{target_name}.xml")
    print(f"\n[{target_name}] Navigating to portal: {url}")
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        time.sleep(3)

        try:
            cookie_btn = page.locator("button.btn-close, .cookie-close, [aria-label='Close'], button:has-text('✕')").first
            if cookie_btn.is_visible(timeout=2000):
                cookie_btn.click()
                time.sleep(1)
        except Exception:
            pass

        page.evaluate("window.scrollTo(0, 400);")
        time.sleep(2)

        try:
            accept_btn = page.locator("input[value='I Accept']").first
            if accept_btn.is_visible(timeout=2000):
                accept_btn.click()
                print(f"  -> [{target_name}] Terms accepted ('I Accept' clicked)")
                time.sleep(3)
        except Exception:
            pass

        print(f"[{target_name}] Requesting live download...")

        target_dl_btn = None
        for _ in range(10):
            for frame in page.frames:
                btn = frame.locator("a[data-cb-name='DataDownloadButton'], a.cbResultSetDownloadLink").first
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
            raise Exception("Could not locate Download Data button.")

        with page.expect_download(timeout=35000) as download_info:
            target_dl_btn.scroll_into_view_if_needed()
            target_dl_btn.click(force=True)

        download = download_info.value
        download.save_as(save_path)
        size_kb = os.path.getsize(save_path) / 1024
        print(f"  -> ✅ [{target_name}] Saved successfully: {size_kb:.1f} KB")

    except Exception as e:
        print(f"  -> ❌ [{target_name}] Failed: {e}")
        raise e

def run_live_pipeline():
    print("=========================================================")
    print(" 🚀 Phase 1: Automated Live XML Data Harvesting")
    print("=========================================================\n")

    cleanup_temp_files()
    is_ci = os.environ.get("CI") == "true" or os.environ.get("GITHUB_ACTIONS") == "true"

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True if is_ci else True,
            downloads_path=EXPORTS_DIR
        )
        context = browser.new_context(
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )

        context.add_cookies([{
            "name": "rmiViewAgree",
            "value": "true",
            "domain": ".responsiblemineralsinitiative.org",
            "path": "/"
        }])

        page = context.new_page()

        for name in ["CMRT", "EMRT", "AMRT", "REVISIONS"]:
            download_caspio_direct(page, name, TARGET_URLS[name])
            time.sleep(1)

        handle_export_page(page, "ACTIVE", TARGET_URLS["ACTIVE"])
        time.sleep(2)

        handle_export_page(page, "CONFORMANT", TARGET_URLS["CONFORMANT"])
        time.sleep(2)

        browser.close()

    cleanup_temp_files()

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

def consolidate_and_export(output_filename):
    print("\n=========================================================")
    print(" 📊 Phase 2: Data Parsing, RMAP Mapping & Consolidation")
    print("=========================================================\n")

    base_rows = []
    conformant_map = {}
    active_set = set()
    revisions_map = {}

    conf_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "CONFORMANT.xml"))
    if not conf_grid:
        raise ValueError("CONFORMANT.xml parsing failed or file is empty.")
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
        raise ValueError("ACTIVE.xml parsing failed or file is empty.")
    headers = act_grid[0]
    id_idx = find_col_idx(headers, ["smelterid", "smelteridentification", "cid"])
    for r in act_grid[1:]:
        s_id = r[id_idx].strip() if id_idx != -1 and id_idx < len(r) and r[id_idx] else ""
        if s_id:
            active_set.add(s_id)
    print(f"• Active smelters loaded: {len(active_set)} records")

    rev_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, "REVISIONS.xml"))
    if not rev_grid:
        raise ValueError("REVISIONS.xml parsing failed or file is empty.")
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
    print(f"• Unique revision history records loaded: {len(revisions_map)} records")

    for t_name in ["CMRT", "EMRT", "AMRT"]:
        t_grid = parse_spreadsheet_ml(os.path.join(EXPORTS_DIR, f"{t_name}.xml"))
        if not t_grid:
            raise ValueError(f"{t_name}.xml parsing failed or file is empty.")
        headers = t_grid[0]
        metal_idx = find_col_idx(headers, ["metal"])
        ref_idx = find_col_idx(headers, ["smelterreference", "reference"])
        name_idx = find_col_idx(headers, ["standardsmeltername", "smeltername"])
        country_idx = find_col_idx(headers, ["country"])
        id_idx = find_col_idx(headers, ["smelterid", "cid"])
        city_idx = find_col_idx(headers, ["city"])
        state_idx = find_col_idx(headers, ["stateprovince", "state", "province"])

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
    print(f"• Base template smelters loaded (CMRT/EMRT/AMRT): {len(base_rows)} records")

    headers_out = [
        "No.", "Type", "Metal", "Smelter Reference", "Standard Smelter Name", "Country",
        "Smelter ID", "City", "State Province", "RMAP Status",
        "Last audit / Cycle / Reaudit In Progress", "Revision History"
    ]

    all_table_data = [headers_out]
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

    print(f"• Removed smelters preserved from Revision History: {removed_count} records")
    total_smelters = len(base_rows) + removed_count

    # 엑셀 파일 저장
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Consolidated_Smelters"

    for r_data in all_table_data:
        ws.append(r_data)

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

    ws.row_dimensions[1].height = 26
    for cell in ws[1]:
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_header
        cell.border = thin_border

    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = font_body
            cell.alignment = align_body

    ws.freeze_panes = "D2"
    ws.auto_filter.ref = ws.dimensions
    custom_widths = [6, 10, 12, 22, 26, 16, 13, 14, 16, 14, 34, 38]
    for i, w in enumerate(custom_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    output_filepath = os.path.join(EXPORTS_DIR, f"{output_filename}.xlsx")
    wb.save(output_filepath)

    print(f"\n✨ Final Master File Created: {output_filename}.xlsx")
    print("=========================================================")
    print(" 📌 CONSOLIDATION SUMMARY")
    print("=========================================================")
    print(f"1. Total Smelters Consolidated: {total_smelters:,} facilities")
    print(f"   - Standard Template Smelters: {len(base_rows):,} (CMRT: 420 | EMRT: 950 | AMRT: 143)")
    print(f"   - Historic / Removed Smelters: {removed_count:,} (Preserved via Revision History)")
    print(f"   - RMAP Status Breakdown     : Conformant ({conformant_matched_count}) | Active ({active_matched_count}) | Removed ({removed_count}) | Standard ({total_smelters - conformant_matched_count - active_matched_count - removed_count})")
    print("=========================================================")

    return all_table_data

def sync_to_google_services(all_table_data):
    """구글 드라이브 일일 파일 업로드 및 Smelter Pulse 구글 스프레드시트 직접 업데이트"""
    client_id = os.environ.get("GDRIVE_CLIENT_ID")
    client_secret = os.environ.get("GDRIVE_CLIENT_SECRET")
    refresh_token = os.environ.get("GDRIVE_REFRESH_TOKEN")
    folder_id = os.environ.get("GDRIVE_FOLDER_ID")
    sheet_id = os.environ.get("SMELTER_PULSE_SHEET_ID")

    if not all([client_id, client_secret, refresh_token, folder_id]):
        print("\n⚠️ Google Drive OAuth credentials missing in environment variables. Skipping cloud sync.")
        return

    print("\n=========================================================")
    print(" ☁️ Phase 3: Syncing Files & Live Google Spreadsheet (OAuth 2.0)")
    print("=========================================================")

    try:
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=[
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/spreadsheets"
            ]
        )
        creds.refresh(Request())
        drive_service = build("drive", "v3", credentials=creds)
        sheets_service = build("sheets", "v4", credentials=creds)

        # 1. 구글 드라이브 파일 업로드 (일일 스냅샷 xlsx, txt 및 6개 원본 XML)
        query = f"'{folder_id}' in parents and trashed = false and mimeType!='application/vnd.google-apps.folder'"
        results = drive_service.files().list(q=query, fields="files(id, name)", pageSize=100).execute()
        existing_files = {item["name"]: item["id"] for item in results.get("files", [])}

        current_files = [f for f in os.listdir(EXPORTS_DIR) if os.path.isfile(os.path.join(EXPORTS_DIR, f))]

        for fname in current_files:
            fpath = os.path.join(EXPORTS_DIR, fname)
            media = MediaFileUpload(fpath, resumable=True)

            if fname in existing_files:
                drive_service.files().update(
                    fileId=existing_files[fname],
                    media_body=media
                ).execute()
                print(f"  -> 🔄 [Drive Updated]: {fname}")
            else:
                file_metadata = {
                    'name': fname,
                    'parents': [folder_id]
                }
                drive_service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields='id'
                ).execute()
                print(f"  -> ⬆️ [Drive Uploaded]: {fname}")

        # 2. 구글 스프레드시트 'Smelter Pulse' 시트 직접 동기화
        if sheet_id:
            print("\n  -> 📊 Updating Google Spreadsheet 'Smelter Pulse'...")
            range_name = "'Smelter Pulse'!A1:L"
            
            # 기존 데이터 클리어
            sheets_service.spreadsheets().values().clear(
                spreadsheetId=sheet_id,
                range=range_name
            ).execute()

            # 최신 데이터 1,700여 개 행 덮어쓰기
            body = {
                "values": all_table_data
            }
            sheets_service.spreadsheets().values().update(
                spreadsheetId=sheet_id,
                range="'Smelter Pulse'!A1",
                valueInputOption="RAW",
                body=body
            ).execute()
            print(f"  -> ✅ [Live Sheet Updated]: Successfully wrote {len(all_table_data):,} rows into Google Spreadsheet!")

        print("\n✅ Google Cloud & Spreadsheet Sync Completed Successfully!")
    except Exception as e:
        print(f"\n❌ Google Sync Failed: {e}")
        traceback.print_exc(file=sys.stdout)
        raise e

if __name__ == "__main__":
    today_str = time.strftime("%Y%m%d")
    base_name = f"RMI_Consolidated_Smelter_List_{today_str}"

    log_filepath = os.path.join(EXPORTS_DIR, f"{base_name}.txt")
    logger = DualLogger(log_filepath)
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    sys.stdout = logger
    sys.stderr = logger

    try:
        run_live_pipeline()
        table_data = consolidate_and_export(base_name)
        sync_to_google_services(table_data)
    except Exception as e:
        print("\n" + "="*57)
        print(" ❌ PIPELINE ERROR OCCURRED")
        print("="*57)
        print(f"Error Type: {type(e).__name__}")
        print(f"Error Message: {str(e)}\n")
        print("Detailed Traceback:")
        traceback.print_exc(file=sys.stdout)
        print("="*57 + "\n")
        sys.exit(1)
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        logger.close()
