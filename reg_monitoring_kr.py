from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
import hashlib
import json
import os
import re
import smtplib
import sys
import traceback
from urllib.parse import urljoin
import urllib3

from bs4 import BeautifulSoup
from google.oauth2.service_account import Credentials
import gspread
from playwright.sync_api import sync_playwright

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================
# 0. Account & Environment Configuration
# ==========================================
HISTORY_SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "1jIPPPb4oLRYbt_yNv9UgMx2BUo19W-CE9kRIIDGbDpg")
COMPLIANCE_SPREADSHEET_ID = "1Gar_Nx_XZIgvkxU652fStC1wx9q2pRADnBEtqInG3Bk"
SERVICE_ACCOUNT_FILE = os.environ.get("SERVICE_ACCOUNT_FILE", "service_key.json")

SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 465))
GMAIL_SENDER = os.environ.get("ALERT_EMAIL_SENDER")
GMAIL_APP_PASSWORD = os.environ.get("ALERT_EMAIL_PASSWORD")
RECIPIENT_EMAIL = os.environ.get("ALERT_EMAIL_RECEIVER")

SENDER_NAME = os.environ.get("SENDER_NAME", "Daily Regulatory Monitoring")

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/xml, */*",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

MAX_SCAN_COUNT = int(os.environ.get("MAX_SCAN_COUNT", 5))

CHANNEL_BASE_URLS = {
    "국가법령정보센터": "https://www.law.go.kr/",
    "기후에너지환경부 입법예고": "https://mcee.go.kr/home/web/index.do?menuId=68",
    "기후에너지환경부 행정예고": "https://mcee.go.kr/home/web/index.do?menuId=10557",
    "기후에너지환경부 고시/훈령/예규": "https://mcee.go.kr/home/web/index.do?menuId=71",
    "화학물질안전원 고시/예규/공고(공지)": "https://nics.mcee.go.kr/sub.do?menuId=36",
    "화학물질안전원 고시/예규/공고(일반)": "https://nics.mcee.go.kr/sub.do?menuId=36",
    "화학물질안전원 행정예고(공지)": "https://nics.mcee.go.kr/sub.do?menuId=111",
    "화학물질안전원 행정예고(일반)": "https://nics.mcee.go.kr/sub.do?menuId=111",
}

LAW_SEARCH_TARGETS = [
    {
        "name": "국가법령: K-ELV (자원순환법 시행령)",
        "url": "https://www.law.go.kr/unSc.do?query=%EC%9C%A0%ED%95%B4%EB%AC%BC%EC%A7%88%EC%9D%98%20%ED%95%A8%EC%9C%A0%20%EA%B8%B0%EC%A4%80&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        "default_title": "[법령] 유해물질의 함유기준(제9조제1항 관련)",
        "is_table": True,
    },
    {
        "name": "국가법령: K-POPs (잔류성오염물질)",
        "url": "https://www.law.go.kr/unSc.do?query=%EC%9E%94%EB%A5%98%EC%84%B1%EC%98%A4%EC%97%BC%EB%AC%BC%EC%A7%88%EC%9D%98%20%EC%A2%85%EB%A5%98&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        "default_title": "잔류성오염물질의 종류 및 특정면제에 관한 규정",
        "is_table": False,
    },
    {
        "name": "국가법령: K-BPR (승인유예물질)",
        "url": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%8A%B9%EC%9D%B8%EC%9C%A0%EC%98%88%EB%8C%80%EC%83%81+%EA%B8%B0%EC%A1%B4%EC%82%B4%EC%83%9D%EB%AC%BC%EB%AC%BC%EC%A7%88%EC%9D%98+%EC%A7%80%EC%A0%95",
        "default_title": "승인유예대상 기존살생물물질의 지정",
        "is_table": False,
    },
    {
        "name": "국가법령: K-REACH (제한·금지물질)",
        "url": "https://www.law.go.kr/unSc.do?query=%EC%A0%9C%ED%95%9C%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        "default_title": "제한물질ㆍ금지물질의 지정",
        "is_table": False,
    },
    {
        "name": "국가법령: K-REACH (허가물질)",
        "url": "https://www.law.go.kr/LSW/unSc.do?query=%ED%97%88%EA%B0%80%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        "default_title": "허가물질 지정 등에 관한 규정",
        "is_table": False,
    },
    {
        "name": "국가법령: K-REACH (중점관리물질)",
        "url": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%A4%91%EC%A0%90%EA%B4%80%EB%A6%AC%EB%AC%BC%EC%A7%88",
        "default_title": "중점관리물질의 지정",
        "is_table": False,
    },
]

MAINTENANCE_KEYWORDS = [
    "temporarily not fully available",
    "temporarily unavailable",
    "under maintenance",
    "site maintenance",
    "scheduled maintenance",
    "service unavailable",
    "점검 중",
    "시스템 점검",
    "서비스 점검",
    "작업 중입니다",
]


# ==========================================
# 0-1. Common Utility Functions
# ==========================================
def generate_unique_key(channel: str, date: str, title: str) -> str:
    clean_channel = channel.strip().replace(" ", "")
    clean_date = date.strip().replace(" ", "")
    title_hash = hashlib.sha256(title.strip().encode("utf-8")).hexdigest()[:10]
    return f"{clean_channel}_{clean_date}_{title_hash}"


def is_maintenance_content(text_content: str) -> bool:
    if not text_content:
        return False
    lower_txt = text_content.lower()
    return any(kw in lower_txt for kw in MAINTENANCE_KEYWORDS)


def check_site_maintenance_pw(page, original_url: str):
    page_text = ""
    try:
        page_text = page.inner_text("body")[:3000]
    except Exception:
        pass

    if is_maintenance_content(page_text):
        return True, "Maintenance keyword detected in content"

    return False, ""


# ==========================================
# 1. Google Sheets Integration
# ==========================================
def init_gspread_client():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
    ]

    sa_key_env = os.environ.get("REG_SA_KEY")
    if sa_key_env:
        key_dict = json.loads(sa_key_env)
        creds = Credentials.from_service_account_info(key_dict, scopes=scopes)
    else:
        creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=scopes)

    return gspread.authorize(creds)


def init_history_sheet(client):
    spreadsheet = client.open_by_key(HISTORY_SPREADSHEET_ID)
    try:
        history_sheet = spreadsheet.worksheet("History")
    except Exception:
        history_sheet = spreadsheet.get_worksheet(0)
    return history_sheet


def get_existing_keys(sheet, scan_limit=500):
    total_rows = len(sheet.col_values(5))
    if total_rows <= 1:
        return set()

    start_row = max(2, total_rows - scan_limit + 1)
    range_name = f"E{start_row}:E{total_rows}"
    cell_values = sheet.get(range_name)
    return set(row[0].strip() for row in cell_values if row and row[0].strip())


def update_compliance_korea_feed(client, display_rows, errors):
    try:
        ss = client.open_by_key(COMPLIANCE_SPREADSHEET_ID)

        try:
            feed_sheet = ss.worksheet("Daily Feed(Korea)")
        except Exception:
            feed_sheet = ss.add_worksheet(title="Daily Feed(Korea)", rows="100", cols="10")

        all_rows = []
        all_rows.append(["No", "Source / Endpoint", "Status", "Date", "Latest Record / Title", "Link", "Source URL"])
        for idx, r in enumerate(display_rows, start=1):
            all_rows.append([
                idx,
                r.get("display_name", ""),
                r.get("status", ""),
                r.get("date", ""),
                r.get("title", ""),
                r.get("link_url", ""),
                r.get("source_url", "")
            ])

        if errors:
            all_rows.append([])
            all_rows.append([f"[Inspection Required Targets] (Total: {len(errors)})"])
            all_rows.append(["Target", "Diagnostic Detail"])
            for err in errors:
                all_rows.append([err.get("channel", ""), err.get("error", "")])

        feed_sheet.clear()
        feed_sheet.update(range_name="A1", values=all_rows)
        print(f">> Successfully synced {len(display_rows)} rows & {len(errors)} errors to 'Compliance -> Daily Feed(Korea)' tab.", flush=True)
    except Exception as ex:
        print(f"!! Failed to update Compliance 'Daily Feed(Korea)' sheet: {str(ex)}", flush=True)


# ==========================================
# 2. Korea Individual Channel Scrapers
# ==========================================

# [1] 국가법령정보센터 (K-ELV 시행일 / 행정규칙 5종 개정일 추출)
def scrape_law_search_pw(page, cfg):
    channel_name = "국가법령정보센터"
    search_url = cfg["url"]

    page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

    is_maint, _ = check_site_maintenance_pw(page, search_url)
    if is_maint:
        return {
            "channel": channel_name,
            "target_name": cfg["name"],
            "date": "-",
            "title": "Site Maintenance (점검 중)",
            "key": generate_unique_key(channel_name, "-", f"{cfg['name']}_Maint"),
            "url": search_url,
            "source_url": search_url,
            "is_maintenance": True,
        }

    soup = BeautifulSoup(page.content(), "html.parser")
    title_str = cfg["default_title"]
    date_str = "N/A"
    detail_url = search_url

    # 1) 별표·서식 테이블 형태 (K-ELV 자원순환법 시행령): '시행일자' 및 첫 번째 열 별표명 추출
    if cfg.get("is_table"):
        tbl = soup.select_one("table.tbl_type2 tbody tr")
        if tbl:
            tds = tbl.find_all("td")
            if len(tds) >= 3:
                # 첫 번째 열(tds[0])의 별표명(a.tit_in) 추출
                a_tit = tds[0].select_one("a.tit_in")
                if a_tit:
                    clean_tbl_title = re.sub(r"\s+", " ", a_tit.get_text(strip=True))
                    if clean_tbl_title:
                        title_str = clean_tbl_title

                    # onclick 내 상세 페이지 URL 파싱
                    onclick_val = a_tit.get("onclick", "")
                    m_url = re.search(r"'(lsBylInfoP\.do\?[^']+)'", onclick_val)
                    if m_url:
                        detail_url = f"https://www.law.go.kr/LSW/{m_url.group(1)}"

                # 시행일자 추출 (세 번째 열)
                raw_date_td = tds[2].get_text(strip=True)
                m_date = re.search(r"(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", raw_date_td)
                if m_date:
                    date_str = m_date.group(1).replace(" ", "")

    # 2) 행정규칙(고시) ul.list_type 형태: '개정/제정일자' 추출
    if date_str == "N/A":
        first_li = soup.select_one("ul.list_type li a.s_tit")
        if first_li:
            span_tx2 = first_li.select_one("span.tx2")
            if span_tx2:
                raw_date_txt = span_tx2.get_text(strip=True)
                m_amend = re.search(r",\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.\s*,\s*(일부개정|전부개정|개정|제정)", raw_date_txt)
                if m_amend:
                    date_str = m_amend.group(1).replace(" ", "")
                else:
                    m_fallback = re.search(r"호,\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", raw_date_txt)
                    if m_fallback:
                        date_str = m_fallback.group(1).replace(" ", "")
                    else:
                        m_general = re.search(r"(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", raw_date_txt)
                        if m_general:
                            date_str = m_general.group(1).replace(" ", "")
                span_tx2.decompose()

            # strong 태그 사이 공백 분리 방지 (separator 없이 추출 후 연속 공백 정리)
            clean_title = re.sub(r"\s+", " ", first_li.get_text(strip=True))
            if clean_title:
                title_str = clean_title

            onclick_val = first_li.get("onclick", "")
            m_seq = re.search(r"admRulSeq=(\d+)", onclick_val)
            if m_seq:
                detail_url = f"https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq={m_seq.group(1)}"

    return {
        "channel": channel_name,
        "target_name": cfg["name"],
        "date": date_str,
        "title": title_str,
        "key": generate_unique_key(channel_name, date_str, title_str),
        "url": detail_url,
        "source_url": search_url,
    }


# [2] 기후에너지환경부 입법예고 (Playwright 브라우저 로딩)
def scrape_mcee_legislation_pw(page):
    channel_name = "기후에너지환경부 입법예고"
    url = CHANNEL_BASE_URLS[channel_name]
    page.goto(url, wait_until="domcontentloaded", timeout=35000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(page.content(), "html.parser")
    results = []
    table = soup.select_one("table.table_case01")
    if not table:
        return results

    rows = table.select("tbody tr")
    for tr in rows[:MAX_SCAN_COUNT]:
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue

        a_tag = tds[1].find("a", href=True)
        if not a_tag:
            continue

        title_str = a_tag.get_text(strip=True)
        link_url = a_tag.get("href", "").strip()

        date_str = tds[2].get_text(strip=True)
        notice_no = tds[3].get_text(strip=True)

        clean_channel = channel_name.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        clean_no = notice_no.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{clean_no}_{title_hash}"

        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": f"[{notice_no}] {title_str}",
            "key": unique_key,
            "url": link_url,
            "source_url": url,
        })

    return results


# [3] 기후에너지환경부 행정예고 (Playwright 브라우저 로딩)
def scrape_mcee_admin_notice_pw(page):
    channel_name = "기후에너지환경부 행정예고"
    url = CHANNEL_BASE_URLS[channel_name]
    base_domain = "https://mcee.go.kr"
    page.goto(url, wait_until="domcontentloaded", timeout=35000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(page.content(), "html.parser")
    results = []
    table = soup.select_one("table.table_case01")
    if not table:
        return results

    rows = table.select("tbody tr")
    for tr in rows[:MAX_SCAN_COUNT]:
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        a_tag = tds[1].find("a", href=True)
        if not a_tag:
            continue

        title_str = a_tag.get_text(strip=True)
        raw_href = a_tag.get("href", "").strip()
        link_url = urljoin(base_domain, raw_href) if raw_href else url

        notice_no_raw = tds[2].get_text(" ", strip=True)
        date_str = tds[3].get_text(strip=True)

        clean_channel = channel_name.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        clean_no = notice_no_raw.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{clean_no}_{title_hash}"

        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": f"[{clean_no}] {title_str}",
            "key": unique_key,
            "url": link_url,
            "source_url": url,
        })

    return results


# [4] 기후에너지환경부 고시/훈령/예규 (Playwright 브라우저 로딩)
def scrape_mcee_rules_pw(page):
    channel_name = "기후에너지환경부 고시/훈령/예규"
    url = CHANNEL_BASE_URLS[channel_name]
    base_domain = "https://mcee.go.kr"
    page.goto(url, wait_until="domcontentloaded", timeout=35000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(page.content(), "html.parser")
    results = []
    table = soup.select_one("table.table_case01")
    if not table:
        return results

    rows = table.select("tbody tr")
    for tr in rows[:MAX_SCAN_COUNT]:
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        a_tag = tds[1].find("a", href=True)
        if not a_tag:
            continue

        title_str = a_tag.get_text(strip=True)
        raw_href = a_tag.get("href", "").strip()
        link_url = urljoin(base_domain, raw_href) if raw_href else url

        date_str = tds[2].get_text(strip=True)
        rule_no = tds[3].get_text(strip=True)

        clean_channel = channel_name.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        clean_no = rule_no.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{clean_no}_{title_hash}"

        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": f"[{rule_no}] {title_str}",
            "key": unique_key,
            "url": link_url,
            "source_url": url,
        })

    return results


# [5 & 6] 화학물질안전원 고시/예규/공고
def scrape_nics_rules_pw(page):
    url = CHANNEL_BASE_URLS["화학물질안전원 고시/예규/공고(공지)"]
    page.goto(url, wait_until="domcontentloaded", timeout=35000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        maint_item = {
            "date": "-",
            "title": "Site Maintenance (점검 중 모니터링 불가)",
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }
        ch_notice = "화학물질안전원 고시/예규/공고(공지)"
        ch_normal = "화학물질안전원 고시/예규/공고(일반)"
        return [
            dict(maint_item, channel=ch_notice, target_name=ch_notice, key=generate_unique_key(ch_notice, "-", "M")),
        ], [
            dict(maint_item, channel=ch_normal, target_name=ch_normal, key=generate_unique_key(ch_normal, "-", "M")),
        ]

    soup = BeautifulSoup(page.content(), "html.parser")
    table = soup.select_one("table.board_list")
    notice_items = []
    normal_items = []
    if not table:
        return notice_items, normal_items

    ch_notice = "화학물질안전원 고시/예규/공고(공지)"
    for tr in table.select("tbody tr.notice")[:MAX_SCAN_COUNT]:
        td_subject = tr.select_one("td.subject")
        td_date = tr.select_one("td.date")
        if not td_subject or not td_date:
            continue

        a_tag = td_subject.select_one("a.ico_file, a")
        title_str = a_tag.get_text(strip=True) if a_tag else td_subject.get_text(strip=True)
        date_str = td_date.get_text(strip=True)

        clean_channel = ch_notice.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{title_hash}"

        notice_items.append({
            "channel": ch_notice,
            "target_name": ch_notice,
            "date": date_str,
            "title": title_str,
            "key": unique_key,
            "url": url,
            "source_url": url,
        })

    ch_normal = "화학물질안전원 고시/예규/공고(일반)"
    for tr in table.select("tbody tr:not(.notice)")[:MAX_SCAN_COUNT]:
        td_num = tr.select_one("td.num")
        td_subject = tr.select_one("td.subject")
        td_date = tr.select_one("td.date")
        if not td_num or not td_subject or not td_date:
            continue

        post_no = td_num.get_text(strip=True)
        if not post_no or not post_no.isdigit():
            continue

        a_tag = td_subject.select_one("a.ico_file, a")
        title_str = a_tag.get_text(strip=True) if a_tag else td_subject.get_text(strip=True)
        date_str = td_date.get_text(strip=True)

        clean_channel = ch_normal.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{post_no}_{title_hash}"

        normal_items.append({
            "channel": ch_normal,
            "target_name": ch_normal,
            "date": date_str,
            "title": f"[{post_no}] {title_str}",
            "key": unique_key,
            "url": url,
            "source_url": url,
        })

    return notice_items, normal_items


# [7 & 8] 화학물질안전원 행정예고
def scrape_nics_admin_notice_pw(page):
    url = CHANNEL_BASE_URLS["화학물질안전원 행정예고(공지)"]
    page.goto(url, wait_until="domcontentloaded", timeout=35000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        maint_item = {
            "date": "-",
            "title": "Site Maintenance (점검 중 모니터링 불가)",
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }
        ch_notice = "화학물질안전원 행정예고(공지)"
        ch_normal = "화학물질안전원 행정예고(일반)"
        return [
            dict(maint_item, channel=ch_notice, target_name=ch_notice, key=generate_unique_key(ch_notice, "-", "M")),
        ], [
            dict(maint_item, channel=ch_normal, target_name=ch_normal, key=generate_unique_key(ch_normal, "-", "M")),
        ]

    soup = BeautifulSoup(page.content(), "html.parser")
    table = soup.select_one("table.board_list")
    notice_items = []
    normal_items = []
    if not table:
        return notice_items, normal_items

    ch_notice = "화학물질안전원 행정예고(공지)"
    for tr in table.select("tbody tr.notice")[:MAX_SCAN_COUNT]:
        td_subject = tr.select_one("td.subject")
        td_date = tr.select_one("td.date")
        if not td_subject or not td_date:
            continue

        a_tag = td_subject.select_one("a.ico_file, a")
        title_str = a_tag.get_text(strip=True) if a_tag else td_subject.get_text(strip=True)
        date_str = td_date.get_text(strip=True)

        clean_channel = ch_notice.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{title_hash}"

        notice_items.append({
            "channel": ch_notice,
            "target_name": ch_notice,
            "date": date_str,
            "title": title_str,
            "key": unique_key,
            "url": url,
            "source_url": url,
        })

    ch_normal = "화학물질안전원 행정예고(일반)"
    for tr in table.select("tbody tr:not(.notice)")[:MAX_SCAN_COUNT]:
        td_num = tr.select_one("td.num")
        td_subject = tr.select_one("td.subject")
        td_date = tr.select_one("td.date")
        if not td_num or not td_subject or not td_date:
            continue

        post_no = td_num.get_text(strip=True)
        if not post_no or not post_no.isdigit():
            continue

        a_tag = td_subject.select_one("a.ico_file, a")
        title_str = a_tag.get_text(strip=True) if a_tag else td_subject.get_text(strip=True)
        date_str = td_date.get_text(strip=True)

        clean_channel = ch_normal.strip().replace(" ", "")
        clean_date = date_str.strip().replace(" ", "")
        title_hash = hashlib.sha256(title_str.strip().encode("utf-8")).hexdigest()[:10]
        unique_key = f"{clean_channel}_{clean_date}_{post_no}_{title_hash}"

        normal_items.append({
            "channel": ch_normal,
            "target_name": ch_normal,
            "date": date_str,
            "title": f"[{post_no}] {title_str}",
            "key": unique_key,
            "url": url,
            "source_url": url,
        })

    return notice_items, normal_items


# ==========================================
# 3. HTML Hybrid (Korea) Email Notification
# ==========================================
def send_email_report_korea(display_rows, total_new_count, errors):
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Email credentials missing. Skipped email dispatch.", flush=True)
        return

    now_utc = datetime.now(timezone.utc)
    kst_tz = timezone(timedelta(hours=9))
    now_kst = now_utc.astimezone(kst_tz)

    today_str = now_kst.strftime("%Y-%m-%d")
    utc_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    kst_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")
    execution_time_display = f"{utc_str} ({kst_str})"

    maint_count = sum(1 for r in display_rows if r.get("status") == "MAINTENANCE")
    error_count = len(errors) + sum(1 for r in display_rows if r.get("status") == "ERROR")

    if errors:
        subject = f"Regulatory News Monitoring (Korea): Action Required | {total_new_count} New | {len(errors)} Issue(s) ({today_str})"
    else:
        subject = f"Regulatory News Monitoring (Korea): {total_new_count} New Update(s) | Verified ({today_str})"

    desktop_rows_html = ""
    for idx, row in enumerate(display_rows, start=1):
        bg_color = "#ffffff" if idx % 2 != 0 else "#f9fafb"

        if row["status"] == "NEW":
            status_text = '<span style="color: #16a34a; font-size: 13px; font-weight: normal;">NEW</span>'
        elif row["status"] == "ERROR":
            status_text = '<span style="color: #dc2626; font-size: 13px; font-weight: normal;">ERROR</span>'
        elif row["status"] == "MAINTENANCE":
            status_text = '<span style="color: #d97706; font-size: 12px; font-weight: normal;">MAINTENANCE</span>'
        else:
            status_text = '<span style="color: #6b7280; font-size: 12px; font-weight: normal;">NO UPDATE</span>'

        if row["link_url"] and row["link_url"] != "#":
            link_btn = f'<a href="{row["link_url"]}" target="_blank" style="display: inline-block; padding: 4px 10px; background-color: #dcfce7; color: #166534; border: 1px solid #86efac; text-decoration: none; border-radius: 4px; font-size: 11px; font-weight: 600;">Link &rarr;</a>'
        else:
            link_btn = '<span style="color: #9ca3af; font-size: 12px;">-</span>'

        desktop_rows_html += f"""
        <tr style="background-color: {bg_color}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 8px; text-align: center; font-weight: normal; color: #4b5563; font-size: 13px;">{idx}</td>
            <td style="padding: 10px 8px; text-align: left; font-weight: normal; font-size: 13px; white-space: nowrap;">
                <a href="{row['source_url']}" target="_blank" style="color: #1d4ed8; text-decoration: none; font-weight: normal;">{row['display_name']}</a>
            </td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap; font-weight: normal;">{status_text}</td>
            <td style="padding: 10px 8px; text-align: center; color: #4b5563; font-size: 12px; white-space: nowrap;">{row['date']}</td>
            <td style="padding: 10px 10px; color: #1f2937; line-line: 1.4; font-size: 13px; max-width: 320px; overflow: hidden; text-overflow: ellipsis;">{row['title']}</td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap;">{link_btn}</td>
        </tr>
        """

    important_items = [r for r in display_rows if r.get("status") in ["NEW", "MAINTENANCE", "ERROR"]]
    mobile_cards_html = ""
    if not important_items and not errors:
        mobile_cards_html = """
        <div style="padding: 20px 14px; text-align: center; background-color: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1; margin-bottom: 16px;">
            <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 3px;">
                ✓ 금일 신규 업데이트 없음
            </div>
            <div style="font-size: 11px; color: #94a3b8;">
                모든 국내 규제 채널이 정상 모니터링 중입니다.
            </div>
        </div>
        """
    else:
        for item in important_items:
            st = item.get("status")
            if st == "NEW":
                badge = '<span style="display: inline-block; background-color: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 700;">NEW</span>'
                card_border = "#16a34a"
            elif st == "MAINTENANCE":
                badge = '<span style="display: inline-block; background-color: #fefce8; color: #854d0e; border: 1px solid #fef08a; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 700;">점검</span>'
                card_border = "#eab308"
            else:
                badge = '<span style="display: inline-block; background-color: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 700;">ERROR</span>'
                card_border = "#dc2626"

            target_link = item.get("link_url") or item.get("source_url")
            link_html = ""
            if target_link and target_link != "#":
                link_html = f"""
                <div style="margin-top: 8px; text-align: right;">
                    <a href="{target_link}" target="_blank" style="display: inline-block; padding: 5px 12px; background-color: #f1f5f9; color: #0f172a; text-decoration: none; border-radius: 6px; font-size: 11px; font-weight: 600; border: 1px solid #cbd5e1;">
                        원문 확인 &rarr;
                    </a>
                </div>
                """

            mobile_cards_html += f"""
            <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid {card_border}; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div>
                        {badge}
                        <strong style="font-size: 12px; color: #1e293b; margin-left: 5px;">{item.get('display_name')}</strong>
                    </div>
                    <span style="font-size: 11px; color: #94a3b8;">{item.get('date', '-')}</span>
                </div>
                <div style="font-size: 13px; font-weight: 600; color: #0f172a; line-height: 1.4; word-break: break-word;">
                    {item.get('title')}
                </div>
                {link_html}
            </div>
            """

    errors_section = ""
    if errors:
        error_rows = ""
        for err in errors:
            error_rows += f"""
            <tr style="background-color: #fff5f5; border-bottom: 1px solid #fed7d7;">
                <td style="padding: 8px 10px; font-weight: normal; color: #c53030; font-size: 13px; white-space: nowrap; vertical-align: top;">{err['channel']}</td>
                <td style="padding: 8px 10px; color: #9b2c2c; font-family: monospace; font-size: 11px; word-break: break-all; line-height: 1.4;">{err['error']}</td>
            </tr>
            """
        errors_section = f"""
        <h3 style="color: #dc2626; margin-top: 25px; margin-bottom: 10px; font-size: 15px;">
            &#9888; Inspection Required Targets ({len(errors)})
        </h3>
        <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #fecaca; font-size: 13px; min-width: 320px;">
                <thead>
                    <tr style="background-color: #fee2e2; color: #991b1b; text-align: left;">
                        <th style="padding: 8px 10px; width: 35%; font-weight: normal;">Target</th>
                        <th style="padding: 8px 10px; font-weight: normal;">Diagnostic Detail</th>
                    </tr>
                </thead>
                <tbody>
                    {error_rows}
                </tbody>
            </table>
        </div>
        """

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 10px;
            background-color: #f8fafc;
            -webkit-text-size-adjust: 100%;
        }}
        .container {{
            width: 100%;
            max-width: 900px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 8px;
            padding: 16px;
            border: 1px solid #e5e7eb;
            box-sizing: border-box;
        }}
        h2 {{
            color: #111827;
            margin-top: 0;
            font-size: 18px;
            line-height: 1.3;
            border-bottom: 3px solid #16a34a;
            padding-bottom: 10px;
        }}
        .meta {{
            color: #4b5563;
            font-size: 13px;
            margin-bottom: 15px;
            line-height: 1.6;
        }}
        .table-wrapper {{
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin-top: 10px;
            border: 1px solid #16a34a;
            border-radius: 4px;
        }}
        .data-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            min-width: 640px;
        }}
        .btn-db {{
            display: inline-block;
            padding: 10px 20px;
            background-color: #16a34a;
            color: #ffffff;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 13px;
        }}

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
            body {{
                padding: 6px !important;
            }}
            .container {{
                padding: 12px !important;
                border-radius: 8px !important;
            }}
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
            .btn-db {{
                display: block !important;
                width: 100% !important;
                box-sizing: border-box !important;
                text-align: center !important;
                padding: 12px 0 !important;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <h2>Regulatory Daily Monitoring Dashboard (Korea)</h2>
        <div class="meta">
            <strong>Execution Time:</strong> {execution_time_display} | <strong>New Updates:</strong> {total_new_count} item(s)<br>
            <span>&bull; Comprehensive Multi-Source Tracking (Korea Endpoints Expanded)</span>
        </div>

        <div class="mobile-only">
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 14px; display: flex; justify-content: space-around; text-align: center;">
                <div>
                    <div style="font-size: 10px; color: #64748b; font-weight: 600;">NEW</div>
                    <div style="font-size: 16px; font-weight: 800; color: {'#16a34a' if total_new_count > 0 else '#64748b'};">{total_new_count}</div>
                </div>
                <div style="border-left: 1px solid #e2e8f0; height: 26px;"></div>
                <div>
                    <div style="font-size: 10px; color: #64748b; font-weight: 600;">MAINT</div>
                    <div style="font-size: 16px; font-weight: 800; color: {'#d97706' if maint_count > 0 else '#64748b'};">{maint_count}</div>
                </div>
                <div style="border-left: 1px solid #e2e8f0; height: 26px;"></div>
                <div>
                    <div style="font-size: 10px; color: #64748b; font-weight: 600;">ERROR</div>
                    <div style="font-size: 16px; font-weight: 800; color: {'#dc2626' if error_count > 0 else '#64748b'};">{error_count}</div>
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">
                    주요 변경 사항 리포트
                </div>
                {mobile_cards_html}
            </div>
        </div>

        <div class="desktop-only">
            <h3 style="color: #111827; margin-bottom: 8px; font-size: 15px;">
                Regulatory Channels &amp; Endpoints Verification
            </h3>

            <div class="table-wrapper">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #16a34a;">
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 35px; border-bottom: 1px solid #16a34a;">No</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 220px; border-bottom: 1px solid #16a34a;">Source / Endpoint</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 90px; border-bottom: 1px solid #16a34a;">Status</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 90px; border-bottom: 1px solid #16a34a;">Date</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; border-bottom: 1px solid #16a34a;">Latest Record / Title</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 65px; border-bottom: 1px solid #16a34a;">Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        {desktop_rows_html}
                    </tbody>
                </table>
            </div>
        </div>

        {errors_section}

        <div style="margin-top: 25px; text-align: center;">
            <a href="https://docs.google.com/spreadsheets/d/{COMPLIANCE_SPREADSHEET_ID}/edit" target="_blank" class="btn-db">
                View Monitoring Records &rarr;
            </a>
        </div>
    </div>
</body>
</html>
"""

    msg = MIMEMultipart("alternative")
    msg["From"] = formataddr((f"{SENDER_NAME} (Korea)", GMAIL_SENDER))
    msg["To"] = RECIPIENT_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, RECIPIENT_EMAIL, msg.as_string())
        print(f">> Korea Notification HTML table email dispatched successfully to: {RECIPIENT_EMAIL}", flush=True)
    except Exception as e:
        print(f"!! Failed to send Korea email: {str(e)}", flush=True)


# ==========================================
# 4. Main Controller
# ==========================================
def main():
    print(">> Initializing Google Sheets Client...", flush=True)
    client = init_gspread_client()

    print(f">> Connecting to History Sheet ({HISTORY_SPREADSHEET_ID[:8]}...)...", flush=True)
    history_sheet = init_history_sheet(client)
    existing_keys = get_existing_keys(history_sheet, scan_limit=500)
    print(f">> Loaded recent registered keys count in 'History' tab (Max 500 limit): {len(existing_keys)}", flush=True)

    channel_items = {
        "국가법령정보센터": [],
        "기후에너지환경부 입법예고": [],
        "기후에너지환경부 행정예고": [],
        "기후에너지환경부 고시/훈령/예규": [],
        "화학물질안전원 고시/예규/공고(공지)": [],
        "화학물질안전원 고시/예규/공고(일반)": [],
        "화학물질안전원 행정예고(공지)": [],
        "화학물질안전원 행정예고(일반)": [],
    }
    errors = []

    # 단일 브라우저 컨텍스트에서 전체 채널(법령 6종 + 안전원 4종 + 환경부 3종) 안정적 순차 스캔
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=HTTP_HEADERS["User-Agent"])

        # [1] 국가법령정보센터 6종 검색
        print(">> Scanning 국가법령정보센터 (Playwright Keyword Search)...", flush=True)
        law_items = []
        page_law = context.new_page()
        try:
            for cfg in LAW_SEARCH_TARGETS:
                try:
                    item = scrape_law_search_pw(page_law, cfg)
                    law_items.append(item)
                    print(f"   ✓ {cfg['name']}: {item.get('date')} | {item.get('title')[:30]}", flush=True)
                except Exception as e:
                    err_msg = f"{cfg['name']}: {str(e)}"
                    print(f"!! [국가법령 PW] Error: {err_msg}", flush=True)
                    errors.append({"channel": cfg["name"], "error": err_msg})
                    law_items.append({
                        "channel": "국가법령정보센터",
                        "target_name": cfg["name"],
                        "date": "-",
                        "title": "Scan Failed (진단 로그 확인)",
                        "key": generate_unique_key("국가법령정보센터", "-", cfg["name"]),
                        "url": cfg["url"],
                        "source_url": cfg["url"],
                        "has_error": True,
                    })
        finally:
            page_law.close()
        channel_items["국가법령정보센터"] = law_items

        # [2] 화학물질안전원 고시/예규/공고
        page_nics1 = context.new_page()
        try:
            notice_items, normal_items = scrape_nics_rules_pw(page_nics1)
            channel_items["화학물질안전원 고시/예규/공고(공지)"] = notice_items
            channel_items["화학물질안전원 고시/예규/공고(일반)"] = normal_items
            print(f">> [2/4] 안전원 고시/예규/공고: Scanned 공지 {len(notice_items)}개 / 일반 {len(normal_items)}개", flush=True)
        except Exception as e:
            errors.append({"channel": "화학물질안전원 고시/예규/공고(공지)", "error": str(e)})
            errors.append({"channel": "화학물질안전원 고시/예규/공고(일반)", "error": str(e)})
        finally:
            page_nics1.close()

        # [3] 화학물질안전원 행정예고
        page_nics2 = context.new_page()
        try:
            notice_items, normal_items = scrape_nics_admin_notice_pw(page_nics2)
            channel_items["화학물질안전원 행정예고(공지)"] = notice_items
            channel_items["화학물질안전원 행정예고(일반)"] = normal_items
            print(f">> [3/4] 안전원 행정예고: Scanned 공지 {len(notice_items)}개 / 일반 {len(normal_items)}개", flush=True)
        except Exception as e:
            errors.append({"channel": "화학물질안전원 행정예고(공지)", "error": str(e)})
            errors.append({"channel": "화학물질안전원 행정예고(일반)", "error": str(e)})
        finally:
            page_nics2.close()

        # [4] 기후에너지환경부 3개 채널 (Playwright 브라우저 컨텍스트 통합)
        page_mcee = context.new_page()
        try:
            items_leg = scrape_mcee_legislation_pw(page_mcee)
            channel_items["기후에너지환경부 입법예고"] = items_leg
            print(f">> [4/4] 기후에너지환경부 입법예고: Scanned {len(items_leg)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "기후에너지환경부 입법예고", "error": str(e)})

        try:
            items_adm = scrape_mcee_admin_notice_pw(page_mcee)
            channel_items["기후에너지환경부 행정예고"] = items_adm
            print(f"       기후에너지환경부 행정예고: Scanned {len(items_adm)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "기후에너지환경부 행정예고", "error": str(e)})

        try:
            items_rul = scrape_mcee_rules_pw(page_mcee)
            channel_items["기후에너지환경부 고시/훈령/예규"] = items_rul
            print(f"       기후에너지환경부 고시/훈령/예규: Scanned {len(items_rul)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "기후에너지환경부 고시/훈령/예규", "error": str(e)})
        finally:
            page_mcee.close()

        browser.close()

    # 3. Process Sheet Entries & Compile Expanded Dashboard Rows
    desired_order = [
        "국가법령정보센터",
        "기후에너지환경부 입법예고",
        "기후에너지환경부 행정예고",
        "기후에너지환경부 고시/훈령/예규",
        "화학물질안전원 고시/예규/공고(공지)",
        "화학물질안전원 고시/예규/공고(일반)",
        "화학물질안전원 행정예고(공지)",
        "화학물질안전원 행정예고(일반)",
    ]

    now_kst_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")
    rows_to_append = []
    display_rows = []
    total_new_items_count = 0

    print("\n>> Processing sheet entries & compiling Korea dashboard rows...", flush=True)
    for channel_name in desired_order:
        items = channel_items.get(channel_name, [])

        if channel_name == "국가법령정보센터":
            grouped_by_target = {}
            for item in items:
                t_name = item.get("target_name", channel_name)
                grouped_by_target.setdefault(t_name, []).append(item)

            for t_name, sub_items in grouped_by_target.items():
                new_sub_items = []
                for sub_item in sub_items:
                    if sub_item.get("is_placeholder") or sub_item.get("has_error") or sub_item.get("is_maintenance"):
                        continue
                    if sub_item["key"] not in existing_keys:
                        row_data = [
                            now_kst_str,
                            sub_item["channel"],
                            sub_item["date"],
                            sub_item["title"],
                            sub_item["key"],
                            sub_item["url"],
                            "",
                        ]
                        rows_to_append.append(row_data)
                        existing_keys.add(sub_item["key"])
                        new_sub_items.append(sub_item)
                        total_new_items_count += 1
                        print(f">> [NEW APPENDED] {t_name}: {sub_item['title'][:35]}...", flush=True)

                primary_item = sub_items[0] if sub_items else {}

                if primary_item.get("has_error"):
                    display_rows.append({
                        "display_name": t_name,
                        "status": "ERROR",
                        "date": "-",
                        "title": primary_item.get("title", "Scan Failed (진단 로그 확인)"),
                        "link_url": primary_item.get("url", "#"),
                        "source_url": primary_item.get("source_url", "#"),
                    })
                elif primary_item.get("is_maintenance"):
                    display_rows.append({
                        "display_name": t_name,
                        "status": "MAINTENANCE",
                        "date": "-",
                        "title": primary_item.get("title", "Site Maintenance (점검 중 모니터링 불가)"),
                        "link_url": primary_item.get("url", "#"),
                        "source_url": primary_item.get("source_url", "#"),
                    })
                elif new_sub_items:
                    for new_item in new_sub_items:
                        display_rows.append({
                            "display_name": t_name,
                            "status": "NEW",
                            "date": new_item["date"],
                            "title": new_item["title"],
                            "link_url": new_item["url"],
                            "source_url": new_item["source_url"],
                        })
                else:
                    display_rows.append({
                        "display_name": t_name,
                        "status": "NO UPDATE",
                        "date": primary_item.get("date", "-"),
                        "title": primary_item.get("title", "No active updates found"),
                        "link_url": primary_item.get("url", "#"),
                        "source_url": primary_item.get("source_url", "#"),
                    })

        else:
            new_items_for_channel = []
            for item in items:
                if item.get("is_maintenance") or item.get("has_error"):
                    continue
                if item["key"] not in existing_keys:
                    row_data = [
                        now_kst_str,
                        item["channel"],
                        item["date"],
                        item["title"],
                        item["key"],
                        item["url"],
                        "",
                    ]
                    rows_to_append.append(row_data)
                    existing_keys.add(item["key"])
                    new_items_for_channel.append(item)
                    total_new_items_count += 1
                    print(f">> [NEW APPENDED] {item['channel']}: {item['title'][:35]}...", flush=True)

            channel_source_url = CHANNEL_BASE_URLS.get(channel_name, "#")
            err_matched = [e for e in errors if e["channel"] == channel_name]

            if err_matched and not items:
                display_rows.append({
                    "display_name": channel_name,
                    "status": "ERROR",
                    "date": "-",
                    "title": "Scan Failed (진단 로그 확인)",
                    "link_url": channel_source_url,
                    "source_url": channel_source_url,
                })
            elif items and items[0].get("is_maintenance"):
                display_rows.append({
                    "display_name": channel_name,
                    "status": "MAINTENANCE",
                    "date": "-",
                    "title": items[0].get("title", "Site Maintenance (점검 중 모니터링 불가)"),
                    "link_url": items[0].get("url", channel_source_url),
                    "source_url": channel_source_url,
                })
            elif new_items_for_channel:
                for new_item in new_items_for_channel:
                    display_rows.append({
                        "display_name": channel_name,
                        "status": "NEW",
                        "date": new_item["date"],
                        "title": new_item["title"],
                        "link_url": new_item["url"],
                        "source_url": channel_source_url,
                    })
            elif items:
                latest_item = items[0]
                display_rows.append({
                    "display_name": channel_name,
                    "status": "NO UPDATE",
                    "date": latest_item["date"],
                    "title": latest_item["title"],
                    "link_url": latest_item["url"],
                    "source_url": channel_source_url,
                })
            else:
                display_rows.append({
                    "display_name": channel_name,
                    "status": "NO UPDATE",
                    "date": "-",
                    "title": "No active updates found",
                    "link_url": channel_source_url,
                    "source_url": channel_source_url,
                })

    # 4. History 시트 기록
    if rows_to_append:
        history_sheet.append_rows(rows_to_append)
        print(f">> Successfully appended {len(rows_to_append)} rows to 'History' sheet.", flush=True)
    else:
        print(">> No new rows to append to 'History' sheet.", flush=True)

    # 5. Compliance Daily Feed(Korea) 시트 갱신
    print(f">> Updating Compliance Sheet ({COMPLIANCE_SPREADSHEET_ID[:8]}...) -> 'Daily Feed(Korea)' tab...", flush=True)
    update_compliance_korea_feed(client, display_rows, errors)

    # 6. HTML 하이브리드 테이블 메일 발송
    send_email_report_korea(display_rows, total_new_items_count, errors)
    print(">> Korea Monitoring process completed successfully.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as unhandled_error:
        error_trace = traceback.format_exc()
        print(f"\n!! [FATAL UNHANDLED EXCEPTION DETECTED]\n{error_trace}", flush=True)
        sys.exit(1)
