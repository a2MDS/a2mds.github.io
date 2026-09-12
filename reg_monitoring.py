import base64
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
import time
import traceback
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET
import urllib3

from bs4 import BeautifulSoup
from google.oauth2.service_account import Credentials
import gspread
from playwright.sync_api import sync_playwright
import requests

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
LAW_OC_KEY = os.environ.get("LAW_OC_KEY")

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
    "RMI News": "https://www.responsiblemineralsinitiative.org/news/",
    "IMDS News": "https://public.mdsystem.com/en/web/imds-public-pages/imds-news",
    "IMDS News (Services)": "https://public.mdsystem.com/en/web/imds-public-pages/imds-extended-services-news",
    "IMDS Release Notes(Next)": "https://public.mdsystem.com/en/web/imds-public-pages/release-notes-mof-next",
    "IMDS Professional Blog": "https://www.imds-professional.com/en/ipblog/",
    "Assent Content Hub": "https://www.assent.com/resources/content-hub/?pager=1&filter=1&filter_order=newest",
    "CDX News": "https://public.cdxsystem.com/en/web/cdx/news",
    "CDX Updates": "https://public.cdxsystem.com/en/web/cdx/updates-releases",
    "CDX Events": "https://public.cdxsystem.com/en/web/cdx/events",
    "iPoint (News)": "https://www.ipoint-systems.com/news/",
    "iPoint (Blog)": "https://www.ipoint-systems.com/news/",
    "ECHA News": "https://echa.europa.eu/news",
    "COMPASS": "https://www.compass.or.kr/news/newsList",
    "EUR-Lex": "https://eur-lex.europa.eu/homepage.html",
    "ECHACHEM": "https://chem.echa.europa.eu/",
    "국가법령정보센터": "https://www.law.go.kr/",
    "기후에너지환경부 입법예고": "https://mcee.go.kr/home/web/index.do?menuId=68",
    "기후에너지환경부 행정예고": "https://mcee.go.kr/home/web/index.do?menuId=10557",
    "기후에너지환경부 고시/훈령/예규": "https://mcee.go.kr/home/web/index.do?menuId=71",
    "화학물질안전원 고시/예규/공고(공지)": "https://nics.mcee.go.kr/sub.do?menuId=36",
    "화학물질안전원 고시/예규/공고(일반)": "https://nics.mcee.go.kr/sub.do?menuId=36",
    "화학물질안전원 행정예고(공지)": "https://nics.mcee.go.kr/sub.do?menuId=111",
    "화학물질안전원 행정예고(일반)": "https://nics.mcee.go.kr/sub.do?menuId=111",
}

LAW_SEARCH_DIRECT_URLS = {
    "국가법령: K-ELV (자원순환법 시행령)": "https://www.law.go.kr/unSc.do?query=%EC%9C%A0%ED%95%B4%EB%AC%BC%EC%A7%88%EC%9D%98%20%ED%95%A8%EC%9C%A0%20%EA%B8%B0%EC%A4%80&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-POPs (잔류성오염물질)": "https://www.law.go.kr/unSc.do?query=%EC%9E%94%EB%A5%98%EC%84%B1%EC%98%A4%EC%97%BC%EB%AC%BC%EC%A7%88%EC%9D%98%20%EC%A2%85%EB%A5%98&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-BPR (승인유예물질)": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%8A%B9%EC%9D%B8%EC%9C%A0%EC%98%88%EB%8C%80%EC%83%81+%EA%B8%B0%EC%A1%B4%EC%82%B4%EC%83%9D%EB%AC%BC%EB%AC%BC%EC%A7%88%EC%9D%98+%EC%A7%80%EC%A0%95",
    "국가법령: K-REACH (제한·금지물질)": "https://www.law.go.kr/unSc.do?query=%EC%A0%9C%ED%95%9C%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-REACH (허가물질)": "https://www.law.go.kr/LSW/unSc.do?query=%ED%97%88%EA%B0%80%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-REACH (중점관리물질)": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%A4%91%EC%A0%90%EA%B4%80%EB%A6%AC%EB%AC%BC%EC%A7%88",
}

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
    current_url = page.url
    page_text = ""
    try:
        page_text = page.inner_text("body")[:3000]
    except Exception:
        pass

    orig_parsed = urlparse(original_url)
    curr_parsed = urlparse(current_url)

    if orig_parsed.netloc != curr_parsed.netloc:
        return True, "Redirected to external domain"

    if "eur-lex.europa.eu" in orig_parsed.netloc:
        if "/oj/direct-access.html" in curr_parsed.path and "/legal-content/" in orig_parsed.path:
            return True, "Redirected to OJ fallback page"

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


def get_existing_keys(sheet):
    keys = sheet.col_values(5)
    return set(k.strip() for k in keys[1:] if k and k.strip())


def update_compliance_daily_feed(client, display_rows, errors):
    try:
        ss = client.open_by_key(COMPLIANCE_SPREADSHEET_ID)
        
        try:
            feed_sheet = ss.worksheet("Daily Feed")
        except Exception:
            feed_sheet = ss.add_worksheet(title="Daily Feed", rows="100", cols="10")

        all_rows = []

        # G열: Source URL (원본 검색 주소) 명시적 추가
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
        print(f">> Successfully synced {len(display_rows)} rows & {len(errors)} error diagnostics to 'Compliance -> Daily Feed' sheet (7 columns with Source URL).", flush=True)
    except Exception as ex:
        print(f"!! Failed to update Compliance 'Daily Feed' sheet: {str(ex)}", flush=True)


# ==========================================
# 2. Individual Channel Scrapers
# ==========================================

# [1] RMI News
def scrape_rmi_pw(context):
    url = CHANNEL_BASE_URLS["RMI News"]
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(1000)

        is_maint, _ = check_site_maintenance_pw(page, url)
        if is_maint:
            channel_name = "RMI News"
            return [{
                "channel": channel_name,
                "target_name": channel_name,
                "date": "-",
                "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
                "key": generate_unique_key(channel_name, "-", "Maintenance"),
                "url": page.url,
                "source_url": url,
                "is_maintenance": True,
            }]

        soup = BeautifulSoup(page.content(), "html.parser")
        items = soup.select("div.newsItem, .newsList .row")
        results = []
        for item in items[:MAX_SCAN_COUNT]:
            a_tag = item.select_one("h3 a, a")
            if not a_tag:
                continue
            title_str = a_tag.get_text(strip=True)
            link_url = urljoin(url, a_tag.get("href", ""))

            date_elem = item.select_one("p.date, .date")
            date_str = date_elem.get_text(strip=True) if date_elem else "N/A"

            channel_name = "RMI News"
            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
                "source_url": url,
            })
        return results
    finally:
        page.close()


# [2] IMDS News
def scrape_imds_news(page):
    url = CHANNEL_BASE_URLS["IMDS News"]
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        channel_name = "IMDS News"
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(page.content(), "html.parser")
    results = []

    for h3 in soup.find_all("h3"):
        txt = h3.get_text(strip=True)
        if re.search(r"\d{2}-[A-Za-z]{3}-\d{4}", txt):
            target_date = txt
            p = h3.find_next_sibling("p")
            target_title = p.get_text(" ", strip=True) if p else "IMDS News Update"
            channel_name = "IMDS News"
            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": target_date,
                "title": target_title,
                "key": generate_unique_key(channel_name, target_date, target_title),
                "url": url,
                "source_url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break

    return results


# [3] IMDS News (Services)
def scrape_imds_services_news(page):
    url = CHANNEL_BASE_URLS["IMDS News (Services)"]
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        channel_name = "IMDS News (Services)"
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(page.content(), "html.parser")
    results = []

    for h3 in soup.find_all(["h3", "h2", "h4"]):
        txt = h3.get_text(strip=True)
        if re.search(r"\d{2}-[A-Za-z]{3}-\d{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt):
            target_date = txt
            p = h3.find_next_sibling("p")
            target_title = p.get_text(" ", strip=True) if p else "IMDS Services News"
            channel_name = "IMDS News (Services)"
            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": target_date,
                "title": target_title,
                "key": generate_unique_key(channel_name, target_date, target_title),
                "url": url,
                "source_url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break

    return results


# [4] IMDS Release Notes(Next)
def scrape_imds_release_notes(page):
    url = CHANNEL_BASE_URLS["IMDS Release Notes(Next)"]
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        channel_name = "IMDS Release Notes(Next)"
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }]

    results = []
    links = page.locator("a:has-text('Changes Release')").all()
    if not links:
        links = page.locator(".journal-content-article a, .portlet-body a").all()

    for link in links[:MAX_SCAN_COUNT]:
        text = link.inner_text().strip()
        if not text:
            continue
        href = urljoin(url, link.get_attribute("href") or url)
        date_match = re.search(r"\((\d{1,2}-[A-Za-z]{3}-\d{4})\)", text)
        date_str = date_match.group(1) if date_match else "N/A"

        channel_name = "IMDS Release Notes(Next)"
        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": text,
            "key": generate_unique_key(channel_name, date_str, text),
            "url": href,
            "source_url": url,
        })
        if len(results) >= MAX_SCAN_COUNT:
            break

    return results


# [5] IMDS Professional Blog
def scrape_imds_pro():
    url = CHANNEL_BASE_URLS["IMDS Professional Blog"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25)
    resp.raise_for_status()

    channel_name = "IMDS Professional Blog"
    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select(".card, article, .post-preview, .blog-post")
    results = []
    for card in cards[:MAX_SCAN_COUNT]:
        title_elem = card.select_one("h2, h3, h4")
        title_str = title_elem.get_text(strip=True) if title_elem else ""

        read_more = card.find("a", string=lambda t: t and "READ MORE" in t.upper())
        link_url = (
            urljoin(url, read_more.get("href"))
            if read_more
            else urljoin(url, card.find("a").get("href", ""))
        )

        if not title_str and link_url:
            slug = [s for s in link_url.strip("/").split("/") if s][-1]
            title_str = slug.replace("-", " ").title()

        card_text = card.get_text(" ", strip=True)
        date_match = re.search(r"\d{1,2}\.\s+[A-Za-z]+\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}", card_text)
        date_str = date_match.group(0) if date_match else "N/A"

        if title_str:
            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
                "source_url": url,
            })
    return results


# [6] Assent Content Hub
def scrape_assent():
    url = CHANNEL_BASE_URLS["Assent Content Hub"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25)
    resp.raise_for_status()

    channel_name = "Assent Content Hub"
    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select("div.post-card, div[data-post-id]")
    results = []
    for card in cards[:MAX_SCAN_COUNT]:
        h6 = card.select_one("h6.h6, h6, .desc-content h6")
        title_str = h6.get_text(strip=True) if h6 else (
            card.select_one("p").get_text(strip=True) if card.select_one("p") else "")
        a_elem = card.find("a", href=True)
        link_url = urljoin(url, a_elem["href"]) if a_elem else url

        if title_str:
            date_str = "N/A"
            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
                "source_url": url,
            })
    return results


# [7] CDX News
def scrape_cdx():
    url = CHANNEL_BASE_URLS["CDX News"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25)
    resp.raise_for_status()

    channel_name = "CDX News"
    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the News" in txt and len(txt) > 30:
            read_link = card.find("a", href=True, string=lambda t: t and "Read the News" in t) or card.find("a", href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            date_elem = card.select_one("div[data-lfr-editable-id='element-date'], .component-date")
            if date_elem:
                date_str = date_elem.get_text(strip=True)
            else:
                date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt)
                date_str = date_match.group(0) if date_match else "N/A"

            title_elem = card.select_one("h4.component-heading, h4[data-lfr-editable-id='element-text']")
            if not title_elem:
                for h in card.find_all(["h4", "h3"]):
                    h_txt = h.get_text(strip=True)
                    if "Latest Compliance" not in h_txt and len(h_txt) > 5:
                        title_elem = h
                        break

            title_str = title_elem.get_text(strip=True) if title_elem else ""
            if not title_str or "Latest Compliance" in title_str:
                parts = [
                    p.strip() for p in txt.split("  ")
                    if len(p.strip()) > 15 and not any(k in p for k in ["Read the News", "Latest Compliance", "Filter News", date_str])
                ]
                title_str = parts[0] if parts else "CDX Regulatory Update"

            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
                "source_url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


# [8] CDX Updates
def scrape_cdx_updates():
    url = CHANNEL_BASE_URLS["CDX Updates"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25)
    resp.raise_for_status()

    channel_name = "CDX Updates"
    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
    results = []
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the Update" in txt and len(txt) > 30:
            date_elem = card.select_one("div[data-lfr-editable-id='element-date']")
            if date_elem:
                date_str = date_elem.get_text(strip=True)
            else:
                m = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt)
                date_str = m.group(0) if m else "N/A"

            title_elem = card.select_one("h4[data-lfr-editable-id='element-text'], .component-heading, h4, h3")
            title_str = title_elem.get_text(strip=True) if title_elem else "CDX Platform Update"

            read_link = card.find("a", href=True, string=lambda t: t and "Read the Update" in t) or card.find("a", href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            results.append({
                "channel": channel_name,
                "target_name": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
                "source_url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


# [9] CDX Events
def scrape_cdx_events():
    url = CHANNEL_BASE_URLS["CDX Events"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25)
    resp.raise_for_status()

    channel_name = "CDX Events"
    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select("div.card.d-md-flex, div.card, div.component-card")
    results = []
    for card in cards[:MAX_SCAN_COUNT]:
        topline_elem = card.select_one("span.topline, div.topline-wrapper")
        topline_txt = topline_elem.get_text(" ", strip=True) if topline_elem else ""
        date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", topline_txt)
        date_str = date_match.group(0) if date_match else "N/A"

        title_elem = card.select_one("h2.h3, h2, h3")
        title_str = title_elem.get_text(strip=True) if title_elem else "CDX Compliance Event"

        link_elem = card.select_one("a.link-button, a.btn, a[href]")
        link_url = urljoin(url, link_elem["href"]) if link_elem else url

        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
            "source_url": url,
        })
    return results


# [10 & 11] iPoint (News & Blog)
def scrape_ipoint_channels(page):
    url = CHANNEL_BASE_URLS["iPoint (News)"]
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1500)

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        maint_item = {
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }
        return [
            dict(maint_item, channel="iPoint (News)", target_name="iPoint (News)", key=generate_unique_key("iPoint (News)", "-", "M")),
            dict(maint_item, channel="iPoint (Blog)", target_name="iPoint (Blog)", key=generate_unique_key("iPoint (Blog)", "-", "M")),
        ]

    soup = BeautifulSoup(page.content(), "html.parser")
    news_items = []
    blog_items = []

    news_heading = soup.find(lambda tag: tag.name in ["h2", "h3", "div"] and tag.get_text(strip=True) == "News")
    if news_heading:
        container = news_heading.find_parent(["div", "section"])
        if container:
            for card in container.find_all(["div", "article"]):
                txt = card.get_text(" ", strip=True)
                m = re.search(r"(\d{2}/\d{2}/\d{4})\s*\|\s*news", txt, re.IGNORECASE)
                if m:
                    date_str = m.group(1)
                    m_title = re.search(r"\d{2}/\d{2}/\d{4}\s*\|\s*news\s+([^.\n]+)", txt, re.IGNORECASE)
                    title_str = m_title.group(1).strip() if m_title else "California Proposition 65"
                    a_tag = card.find("a", href=True)
                    link_url = urljoin(url, a_tag["href"]) if a_tag else url
                    channel_name = "iPoint (News)"
                    news_items.append({
                        "channel": channel_name,
                        "target_name": channel_name,
                        "date": date_str,
                        "title": title_str,
                        "key": generate_unique_key(channel_name, date_str, title_str),
                        "url": link_url,
                        "source_url": url,
                    })
                    if len(news_items) >= MAX_SCAN_COUNT:
                        break

    blog_heading = soup.find(lambda tag: tag.name in ["h2", "h3", "div"] and tag.get_text(strip=True) == "Blog")
    if blog_heading:
        container = blog_heading.find_parent(["div", "section"])
        if container:
            for card in container.find_all(["div", "article"]):
                txt = card.get_text(" ", strip=True)
                m = re.search(r"(\d{2}/\d{2}/\d{4})", txt)
                if m and "events" not in txt.lower():
                    date_str = m.group(1)
                    m_title = re.search(r"\d{2}/\d{2}/\d{4}\s+([^.\n]+)", txt)
                    title_str = m_title.group(1).strip() if m_title else "Circular Economy Update"
                    a_tag = card.find("a", href=True)
                    link_url = urljoin(url, a_tag["href"]) if a_tag else url
                    channel_name = "iPoint (Blog)"
                    blog_items.append({
                        "channel": channel_name,
                        "target_name": channel_name,
                        "date": date_str,
                        "title": title_str,
                        "key": generate_unique_key(channel_name, date_str, title_str),
                        "url": link_url,
                        "source_url": url,
                    })
                    if len(blog_items) >= MAX_SCAN_COUNT:
                        break

    return news_items, blog_items


# [12] ECHA News
def scrape_echa(page):
    url = CHANNEL_BASE_URLS["ECHA News"]
    page.goto(url, wait_until="domcontentloaded", timeout=35000)

    try:
        cookie_btn = page.locator("button:has-text('Accept'), button:has-text('agree'), a:has-text('Accept')").first
        if cookie_btn.is_visible(timeout=2000):
            cookie_btn.click()
            page.wait_for_timeout(500)
    except Exception:
        pass

    is_maint, _ = check_site_maintenance_pw(page, url)
    if is_maint:
        channel_name = "ECHA News"
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": page.url,
            "source_url": url,
            "is_maintenance": True,
        }]

    page.wait_for_selector(".HomeNews, .NewsLevelA, dd.NewsDate", timeout=15000)
    soup = BeautifulSoup(page.content(), "html.parser")
    results = []

    dt_elements = soup.select(".HomeNews dt, .NewsLevelA dt, dt")
    for dt in dt_elements:
        a_tag = dt.find("a", href=True)
        if not a_tag:
            continue
        title_str = a_tag.get_text(strip=True)
        link_url = urljoin(url, a_tag["href"])

        dd = dt.find_next_sibling("dd")
        date_str = dd.get_text(strip=True) if dd else "N/A"

        channel_name = "ECHA News"
        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
            "source_url": url,
        })
        if len(results) >= MAX_SCAN_COUNT:
            break

    return results


# [13] COMPASS
def scrape_compass():
    api_url = "https://www.compass.or.kr/news/newsList"
    params = {
        "receiveCnt": 0,
        "requestCnt": MAX_SCAN_COUNT,
        "orderName": "SEQ",
        "orderDir": "DESC",
    }

    last_err = None
    for attempt in range(2):
        try:
            resp = requests.get(api_url, params=params, headers=HTTP_HEADERS, timeout=30)
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as e:
            last_err = e
            time.sleep(2)
    else:
        raise last_err

    item_list = data.get("list", [])
    results = []
    base_channel_url = CHANNEL_BASE_URLS["COMPASS"]
    for item in item_list[:MAX_SCAN_COUNT]:
        title_str = item.get("newTitle", "").strip()
        new_seq = str(item.get("newSeq", ""))
        date_str = str(item.get("newRegdt", "N/A")).strip()

        encoded_seq = base64.b64encode(new_seq.encode("utf-8")).decode("utf-8")
        link_url = f"https://www.compass.or.kr/news/view?newSeq={encoded_seq}"

        channel_name = "COMPASS"
        results.append({
            "channel": channel_name,
            "target_name": channel_name,
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
            "source_url": base_channel_url,
        })
    return results


# [14] EUR-Lex
def scrape_eurlex(page):
    channel_name = "EUR-Lex"
    target_configs = [
        {"name": "EUR-Lex: ELV", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32000L0053"},
        {"name": "EUR-Lex: ELVR", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=OJ:L_202601738"},
        {"name": "EUR-Lex: RoHS", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32011L0065"},
        {"name": "EUR-Lex: REACH", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32006R1907"},
        {"name": "EUR-Lex: POPs", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32019R1021"},
        {"name": "EUR-Lex: EUDR", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32023R1115"},
        {"name": "EUR-Lex: ESPR", "url": "https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:32024R1781"},
    ]

    results = []
    base_url = "https://eur-lex.europa.eu"

    for cfg in target_configs:
        target_url = cfg["url"]
        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=35000)
            page.wait_for_timeout(2000)

            is_maint, _ = check_site_maintenance_pw(page, target_url)
            if is_maint:
                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": "-",
                    "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
                    "key": generate_unique_key(channel_name, "-", f"{cfg['name']}_Maint"),
                    "url": page.url,
                    "source_url": target_url,
                    "is_maintenance": True,
                })
                continue

            soup = BeautifulSoup(page.content(), "html.parser")
            candidate_rows = []

            target_dt = soup.find(lambda tag: tag.name == "dt"
                                  and "tables" in tag.get("class", [])
                                  and "modified by" in tag.get_text(strip=True).lower())

            if target_dt:
                target_dd = target_dt.find_next_sibling("dd")
                if target_dd:
                    target_table = target_dd.select_one("table#relatedDocsTb, table.dataTable")
                    if target_table:
                        for r in target_table.select("tbody tr"):
                            a_tooltip = r.select_one("a.EurlexTooltip[data-celex], a[data-celex]")
                            if a_tooltip:
                                candidate_rows.append(r)

            if candidate_rows:
                target_tr = candidate_rows[-1]
                a_elem = target_tr.select_one("a.EurlexTooltip[data-celex], a[data-celex]")
                act_celex = a_elem.get("data-celex") or a_elem.get_text(strip=True)
                act_href = a_elem.get("href", "")
                link_url = urljoin(base_url, act_href) if act_href else target_url

                date_str = "N/A"
                td_sort = target_tr.select_one("td[data-sort]")
                if td_sort and td_sort.get("data-sort"):
                    s_val = td_sort["data-sort"].strip()
                    if re.match(r"^\d{8}$", s_val):
                        date_str = f"{s_val[:4]}-{s_val[4:6]}-{s_val[6:]}"

                if date_str == "N/A":
                    row_txt = target_tr.get_text(" ", strip=True)
                    m_date = re.search(r"(\d{4}-\d{2}-\d{2})|(\d{2}/\d{2}/\d{4})", row_txt)
                    if m_date:
                        date_str = m_date.group(0)

                row_cells = [td.get_text(strip=True) for td in target_tr.find_all("td") if td.get_text(strip=True)]
                relation_desc = row_cells[1] if len(row_cells) > 1 and row_cells[1] != act_celex else (
                    row_cells[0] if row_cells else "Amending Act")
                title_str = f"{act_celex} ({relation_desc})"

                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": date_str,
                    "title": title_str,
                    "key": generate_unique_key(channel_name, date_str, title_str),
                    "url": link_url,
                    "source_url": target_url,
                })

            else:
                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": "-",
                    "title": "-",
                    "key": generate_unique_key(channel_name, "-", cfg["name"]),
                    "url": target_url,
                    "source_url": target_url,
                    "is_placeholder": True,
                })

        except Exception as item_err:
            print(f"!! [EUR-Lex] Error scanning {cfg['name']}: {str(item_err)}", flush=True)
            results.append({
                "channel": channel_name,
                "target_name": cfg["name"],
                "date": "-",
                "title": "Scan Failed (See diagnostic below)",
                "key": generate_unique_key(channel_name, "-", cfg["name"]),
                "url": target_url,
                "source_url": target_url,
                "has_error": True,
            })

    return results


# [15~22] ECHACHEM
def scrape_echachem_api(errors_list):
    channel_name = "ECHACHEM"
    results = []

    configs = [
        {
            "name": "ECHACHEM: REACH SVHC (Proposed)",
            "api_url": "https://chem.echa.europa.eu/api-activity-list/v1/svhcIdentification",
            "web_url": "https://chem.echa.europa.eu/activity-lists/svhcIdentification",
            "type": "activity",
        },
        {
            "name": "ECHACHEM: REACH XIV (Proposed)",
            "api_url": "https://chem.echa.europa.eu/api-activity-list/v1/authorisationProcess",
            "web_url": "https://chem.echa.europa.eu/activity-lists/authorisationProcess",
            "type": "activity",
        },
        {
            "name": "ECHACHEM: REACH XVII (Proposed)",
            "api_url": "https://chem.echa.europa.eu/api-activity-list/v1/restrictionProcess",
            "web_url": "https://chem.echa.europa.eu/activity-lists/restrictionProcess",
            "type": "activity",
        },
        {
            "name": "ECHACHEM: POPs (Proposed)",
            "api_url": "https://chem.echa.europa.eu/api-activity-list/v1/popsProcess",
            "web_url": "https://chem.echa.europa.eu/activity-lists/popsProcess",
            "type": "activity",
        },
        {
            "name": "ECHACHEM: REACH SVHC",
            "api_url": "https://chem.echa.europa.eu/api-obligation-list/v1/candidateList",
            "web_url": "https://chem.echa.europa.eu/obligation-lists/candidateList",
            "type": "obligation",
            "date_key": "dateOfInclusion",
        },
        {
            "name": "ECHACHEM: REACH Annex XIV",
            "api_url": "https://chem.echa.europa.eu/api-obligation-list/v1/authorisationList",
            "web_url": "https://chem.echa.europa.eu/obligation-lists/authorisationList",
            "type": "obligation",
            "sort_by_entry_desc": True,
            "date_key": "latestApplicationDate",
        },
        {
            "name": "ECHACHEM: REACH Annex XVII",
            "api_url": "https://chem.echa.europa.eu/api-obligation-list/v1/restrictionList",
            "web_url": "https://chem.echa.europa.eu/obligation-lists/restrictionList",
            "type": "obligation",
            "sort_by_entry_desc": True,
            "date_key": "entryNumber",
        },
        {
            "name": "ECHACHEM: POPs",
            "api_url": "https://chem.echa.europa.eu/api-obligation-list/v1/popsList",
            "web_url": "https://chem.echa.europa.eu/obligation-lists/popsList",
            "type": "obligation",
            "date_key": "dateOfInclusion",
        },
    ]

    for cfg in configs:
        try:
            params = {"pageIndex": 1, "pageSize": 100, "showMembers": "false"}
            resp = requests.get(cfg["api_url"], params=params, headers=HTTP_HEADERS, timeout=20)
            
            if resp.status_code in [502, 503] or is_maintenance_content(resp.text):
                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": "-",
                    "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
                    "key": generate_unique_key(channel_name, "-", f"{cfg['name']}_Maint"),
                    "url": cfg["web_url"],
                    "source_url": cfg["web_url"],
                    "is_maintenance": True,
                })
                continue

            resp.raise_for_status()
            data = resp.json()

            items = []
            if isinstance(data, list):
                items = data
            elif isinstance(data, dict):
                for k in ["result", "results", "data", "items", "content"]:
                    if k in data and isinstance(data[k], list):
                        items = data[k]
                        break

            if not items:
                err_msg = f"{cfg['name']}: Returned empty list or unmapped structure"
                print(f"!! [ECHACHEM API] {err_msg}", flush=True)
                errors_list.append({"channel": cfg["name"], "error": err_msg})
                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": "-",
                    "title": "Scan Failed (See diagnostic below)",
                    "key": generate_unique_key(channel_name, "-", cfg["name"]),
                    "url": cfg["web_url"],
                    "source_url": cfg["web_url"],
                    "has_error": True,
                })
                continue

            if cfg.get("sort_by_entry_desc"):
                def parse_entry_num(x):
                    raw = str(x.get("entryNumber") or x.get("entry") or "0")
                    m = re.search(r"\d+", raw)
                    return int(m.group(0)) if m else 0

                items = sorted(items, key=parse_entry_num, reverse=True)

            for item in items[:MAX_SCAN_COUNT]:
                cas_str = item.get("casNumber") or item.get("cas") or "-"
                sub_name = item.get("substanceName") or item.get("name") or "Substance"

                if cfg["type"] == "activity":
                    stage_str = item.get("currentStage") or item.get("stage") or "Proposed"
                    date_str = item.get("currentStageDate") or item.get("stageDate") or "N/A"
                    title_str = f"CAS {cas_str} ({stage_str})"
                else:
                    entry_num = item.get("entryNumber") or item.get("entry") or ""
                    if cfg.get("sort_by_entry_desc") or cfg.get("date_key") == "entryNumber":
                        date_str = item.get("sunsetDate") or item.get("latestApplicationDate") or f"Entry {entry_num}"
                        title_str = f"Entry {entry_num}: {sub_name}"
                    else:
                        date_str = item.get(cfg.get("date_key", "dateOfInclusion")) or "N/A"
                        title_str = f"CAS {cas_str} ({sub_name})"

                act_id = item.get("id") or item.get("activityId") or ""
                link_url = f"{cfg['web_url']}/{act_id}" if act_id else cfg["web_url"]

                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": str(date_str),
                    "title": title_str,
                    "key": generate_unique_key(channel_name, str(date_str), title_str),
                    "url": link_url,
                    "source_url": cfg["web_url"],
                })

        except Exception as e:
            err_msg = f"{cfg['name']}: {str(e)}"
            print(f"!! [ECHACHEM API] Error: {err_msg}", flush=True)
            errors_list.append({"channel": cfg["name"], "error": err_msg})
            results.append({
                "channel": channel_name,
                "target_name": cfg["name"],
                "date": "-",
                "title": "Scan Failed (See diagnostic below)",
                "key": generate_unique_key(channel_name, "-", cfg["name"]),
                "url": cfg["web_url"],
                "source_url": cfg["web_url"],
                "has_error": True,
            })

    return results


# [23] 국가법령정보센터
def scrape_law_center_openapi(errors_list):
    channel_name = "국가법령정보센터"

    if not LAW_OC_KEY:
        err_msg = "LAW_OC_KEY environment variable is missing in GitHub Secrets."
        print(f"!! [국가법령 Open API] Error: {err_msg}", flush=True)
        errors_list.append({"channel": channel_name, "error": err_msg})
        return []

    target_configs = [
        {
            "name": "국가법령: K-ELV (자원순환법 시행령)",
            "target": "law",
            "query": "전기ㆍ전자제품 및 자동차의 자원순환에 관한 법률 시행령",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-ELV (자원순환법 시행령)"],
        },
        {
            "name": "국가법령: K-POPs (잔류성오염물질)",
            "target": "admrul",
            "query": "잔류성오염물질의 종류",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-POPs (잔류성오염물질)"],
        },
        {
            "name": "국가법령: K-BPR (승인유예물질)",
            "target": "admrul",
            "query": "승인유예대상 기존살생물물질의 지정",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-BPR (승인유예물질)"],
        },
        {
            "name": "국가법령: K-REACH (제한·금지물질)",
            "target": "admrul",
            "query": "제한물질·금지물질의 지정",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-REACH (제한·금지물질)"],
        },
        {
            "name": "국가법령: K-REACH (허가물질)",
            "target": "admrul",
            "query": "허가물질의 지정",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-REACH (허가물질)"],
        },
        {
            "name": "국가법령: K-REACH (중점관리물질)",
            "target": "admrul",
            "query": "중점관리물질",
            "direct_url": LAW_SEARCH_DIRECT_URLS["국가법령: K-REACH (중점관리물질)"],
        },
    ]

    results = []

    for cfg in target_configs:
        try:
            params = {
                "OC": LAW_OC_KEY,
                "target": cfg["target"],
                "type": "XML",
                "query": cfg["query"],
            }
            
            resp = None
            last_conn_err = None
            for attempt in range(2):
                try:
                    resp = requests.get("https://www.law.go.kr/DRF/lawSearch.do", params=params, headers=HTTP_HEADERS, timeout=15)
                    resp.raise_for_status()
                    break
                except Exception as ex1:
                    last_conn_err = ex1
                    try:
                        resp = requests.get("http://www.law.go.kr/DRF/lawSearch.do", params=params, headers=HTTP_HEADERS, timeout=15)
                        resp.raise_for_status()
                        break
                    except Exception as ex2:
                        last_conn_err = ex2
                        time.sleep(1)
            else:
                raise last_conn_err

            if is_maintenance_content(resp.text):
                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": "-",
                    "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
                    "key": generate_unique_key(channel_name, "-", f"{cfg['name']}_Maint"),
                    "url": cfg["direct_url"],
                    "source_url": cfg["direct_url"],
                    "is_maintenance": True,
                })
                continue

            root = ET.fromstring(resp.content)

            if cfg["target"] == "admrul":
                admrul_nodes = root.findall(".//admrul")
                if admrul_nodes:
                    node = admrul_nodes[0]
                    title_elem = node.find("행정규칙명")
                    date_elem = node.find("발령일자")

                    raw_title = title_elem.text.strip() if title_elem is not None and title_elem.text else cfg["name"]
                    date_raw = date_elem.text.strip() if date_elem is not None and date_elem.text else "N/A"
                    if len(date_raw) == 8:
                        date_str = f"{date_raw[:4]}.{date_raw[4:6]}.{date_raw[6:]}"
                    else:
                        date_str = date_raw

                    results.append({
                        "channel": channel_name,
                        "target_name": cfg["name"],
                        "date": date_str,
                        "title": raw_title,
                        "key": generate_unique_key(channel_name, date_str, raw_title),
                        "url": cfg["direct_url"],
                        "source_url": cfg["direct_url"],
                    })
                else:
                    results.append({
                        "channel": channel_name,
                        "target_name": cfg["name"],
                        "date": "-",
                        "title": "No records found",
                        "key": generate_unique_key(channel_name, "-", cfg["name"]),
                        "url": cfg["direct_url"],
                        "source_url": cfg["direct_url"],
                    })

            else:
                law_nodes = root.findall(".//law")
                target_node = None
                for n in law_nodes:
                    t_text = n.findtext("법령명한글", "")
                    if "자원순환" in t_text:
                        target_node = n
                        break
                if not target_node and law_nodes:
                    target_node = law_nodes[0]

                if target_node:
                    raw_title = target_node.findtext("법령명한글", "전기ㆍ전자제품 및 자동차의 자원순환에 관한 법률 시행령")
                    date_raw = target_node.findtext("시행일자", "N/A")
                    if len(date_raw) == 8:
                        date_str = f"{date_raw[:4]}.{date_raw[4:6]}.{date_raw[6:]}"
                    else:
                        date_str = date_raw

                    results.append({
                        "channel": channel_name,
                        "target_name": cfg["name"],
                        "date": date_str,
                        "title": raw_title,
                        "key": generate_unique_key(channel_name, date_str, raw_title),
                        "url": cfg["direct_url"],
                        "source_url": cfg["direct_url"],
                    })

        except Exception as e:
            err_msg = f"{cfg['name']}: {str(e)}"
            print(f"!! [국가법령 Open API] Error: {err_msg}", flush=True)
            errors_list.append({"channel": cfg["name"], "error": err_msg})
            results.append({
                "channel": channel_name,
                "target_name": cfg["name"],
                "date": "-",
                "title": "Scan Failed (See diagnostic below)",
                "key": generate_unique_key(channel_name, "-", cfg["name"]),
                "url": cfg["direct_url"],
                "source_url": cfg["direct_url"],
                "has_error": True,
            })

    return results


# [24] 기후에너지환경부 입법예고
def scrape_mcee_legislation():
    channel_name = "기후에너지환경부 입법예고"
    url = CHANNEL_BASE_URLS[channel_name]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=30, verify=False)
    resp.raise_for_status()

    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
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


# [25] 기후에너지환경부 행정예고
def scrape_mcee_admin_notice():
    channel_name = "기후에너지환경부 행정예고"
    url = CHANNEL_BASE_URLS[channel_name]
    base_domain = "https://mcee.go.kr"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=30, verify=False)
    resp.raise_for_status()

    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
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


# [26] 기후에너지환경부 고시/훈령/예규
def scrape_mcee_rules():
    channel_name = "기후에너지환경부 고시/훈령/예규"
    url = CHANNEL_BASE_URLS[channel_name]
    base_domain = "https://mcee.go.kr"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=30, verify=False)
    resp.raise_for_status()

    if is_maintenance_content(resp.text):
        return [{
            "channel": channel_name,
            "target_name": channel_name,
            "date": "-",
            "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
            "key": generate_unique_key(channel_name, "-", "Maintenance"),
            "url": url,
            "source_url": url,
            "is_maintenance": True,
        }]

    soup = BeautifulSoup(resp.text, "html.parser")
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


# [27 & 28] 화학물질안전원 고시/예규/공고
def scrape_nics_rules_pw(context):
    url = CHANNEL_BASE_URLS["화학물질안전원 고시/예규/공고(공지)"]
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=35000)
        page.wait_for_timeout(1000)

        is_maint, _ = check_site_maintenance_pw(page, url)
        if is_maint:
            maint_item = {
                "date": "-",
                "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
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
    finally:
        page.close()


# [29 & 30] 화학물질안전원 행정예고
def scrape_nics_admin_notice_pw(context):
    url = CHANNEL_BASE_URLS["화학물질안전원 행정예고(공지)"]
    page = context.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=35000)
        page.wait_for_timeout(1000)

        is_maint, _ = check_site_maintenance_pw(page, url)
        if is_maint:
            maint_item = {
                "date": "-",
                "title": "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)",
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
    finally:
        page.close()


# ==========================================
# 3. HTML Table Email Notification
# ==========================================
def send_email_report(display_rows, total_new_count, errors):
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

    if errors:
        subject = f"Regulatory News Monitoring: Action Required | {total_new_count} New | {len(errors)} Issue(s) ({today_str})"
    else:
        subject = f"Regulatory News Monitoring: {total_new_count} New Update(s) | Verified ({today_str})"

    rows_html = ""
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

        rows_html += f"""
        <tr style="background-color: {bg_color}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 8px; text-align: center; font-weight: normal; color: #4b5563; font-size: 13px;">{idx}</td>
            <td style="padding: 10px 8px; text-align: left; font-weight: normal; font-size: 13px; white-space: nowrap;">
                <a href="{row['source_url']}" target="_blank" style="color: #1d4ed8; text-decoration: none; font-weight: normal;">{row['display_name']}</a>
            </td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap; font-weight: normal;">{status_text}</td>
            <td style="padding: 10px 8px; text-align: center; color: #4b5563; font-size: 12px; white-space: nowrap;">{row['date']}</td>
            <td style="padding: 10px 10px; color: #1f2937; line-height: 1.4; font-size: 13px; max-width: 320px; overflow: hidden; text-overflow: ellipsis;">{row['title']}</td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap;">{link_btn}</td>
        </tr>
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

    html_content = f"""
    <!DOCTYPE html>
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
                font-size: 12px;
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
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Regulatory Daily Monitoring Dashboard</h2>
            <div class="meta">
                <strong>Execution Time:</strong> {execution_time_display} | <strong>New Updates:</strong> {total_new_count} item(s)<br>
                <span>&bull; Comprehensive Multi-Source Tracking (Individual Endpoints Expanded)</span>
            </div>

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
                        {rows_html}
                    </tbody>
                </table>
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
    msg["From"] = formataddr((SENDER_NAME, GMAIL_SENDER))
    msg["To"] = RECIPIENT_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, RECIPIENT_EMAIL, msg.as_string())
        print(f">> Notification HTML table email dispatched successfully to: {RECIPIENT_EMAIL}", flush=True)
    except Exception as e:
        print(f"!! Failed to send email: {str(e)}", flush=True)


# ==========================================
# 3-1. Critical Crash Email Notification
# ==========================================
def send_critical_crash_alert(error_detail):
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Critical alert: Email credentials missing. Cannot dispatch alert.", flush=True)
        return

    now_utc = datetime.now(timezone.utc)
    kst_tz = timezone(timedelta(hours=9))
    now_kst = now_utc.astimezone(kst_tz)

    utc_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    kst_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")
    today_str = now_kst.strftime("%Y-%m-%d")

    subject = f"[CRITICAL FAILURE: Pipeline Terminated] Regulatory Monitor Crash ({today_str})"

    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #fef2f2; margin: 0; padding: 15px; }}
            .container {{ max-width: 700px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 20px; border: 2px solid #ef4444; }}
            h2 {{ color: #b91c1c; margin-top: 0; border-bottom: 2px solid #f87171; padding-bottom: 8px; font-size: 18px; }}
            .meta {{ color: #374151; font-size: 13px; margin-bottom: 15px; line-height: 1.6; }}
            pre {{ background-color: #1f2937; color: #f87171; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }}
            .alert-box {{ background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 10px 14px; margin-bottom: 15px; font-size: 13px; color: #991b1b; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2>&#9888; Critical System Failure: Scraping Pipeline Aborted</h2>
            <div class="meta">
                <strong>Failure Time:</strong> {utc_str} ({kst_str})<br>
                <strong>Status:</strong> Execution Terminated Before Normal Completion
            </div>
            <div class="alert-box">
                Pipeline execution halted unexpectedly due to a critical system or authentication error. Refer to the stack trace below.
            </div>
            <h4 style="margin-bottom: 6px; color: #374151;">Error Stack Trace:</h4>
            <pre>{error_detail}</pre>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["From"] = formataddr((f"{SENDER_NAME} [CRITICAL ALERT]", GMAIL_SENDER))
    msg["To"] = RECIPIENT_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, RECIPIENT_EMAIL, msg.as_string())
        print(f">> Critical failure alert email dispatched successfully to: {RECIPIENT_EMAIL}", flush=True)
    except Exception as mail_err:
        print(f"!! Failed to send critical crash alert email: {str(mail_err)}", flush=True)


# ==========================================
# 4. Main Controller
# ==========================================
def main():
    print(">> Initializing Google Sheets Client...", flush=True)
    client = init_gspread_client()

    print(f">> Connecting to History Sheet ({HISTORY_SPREADSHEET_ID[:8]}...)...", flush=True)
    history_sheet = init_history_sheet(client)
    existing_keys = get_existing_keys(history_sheet)
    print(f">> Existing registered keys count in 'History' tab: {len(existing_keys)}", flush=True)

    channel_items = {
        "RMI News": [],
        "IMDS News": [],
        "IMDS News (Services)": [],
        "IMDS Release Notes(Next)": [],
        "IMDS Professional Blog": [],
        "Assent Content Hub": [],
        "CDX News": [],
        "CDX Updates": [],
        "CDX Events": [],
        "iPoint (News)": [],
        "iPoint (Blog)": [],
        "ECHA News": [],
        "COMPASS": [],
        "EUR-Lex": [],
        "ECHACHEM": [],
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

    # 1. Execute Playwright Scrapers
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        # [1] RMI News
        try:
            items = scrape_rmi_pw(context)
            channel_items["RMI News"] = items
            print(f"[1/23] RMI News (PW): Scanned {len(items)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "RMI News", "error": str(e)})

        # [2] IMDS News
        try:
            page = context.new_page()
            try:
                items = scrape_imds_news(page)
                channel_items["IMDS News"] = items
                print(f"[2/23] IMDS News: Scanned {len(items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "IMDS News", "error": str(e)})

        # [3] IMDS News (Services)
        try:
            page = context.new_page()
            try:
                items = scrape_imds_services_news(page)
                channel_items["IMDS News (Services)"] = items
                print(f"[3/23] IMDS Services: Scanned {len(items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "IMDS News (Services)", "error": str(e)})

        # [4] IMDS Release Notes(Next)
        try:
            page = context.new_page()
            try:
                items = scrape_imds_release_notes(page)
                channel_items["IMDS Release Notes(Next)"] = items
                print(f"[4/23] IMDS Release: Scanned {len(items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "IMDS Release Notes(Next)", "error": str(e)})

        # [10 & 11] iPoint (News & Blog)
        try:
            page = context.new_page()
            try:
                news_items, blog_items = scrape_ipoint_channels(page)
                channel_items["iPoint (News)"] = news_items
                channel_items["iPoint (Blog)"] = blog_items
                print(f"[5/23] iPoint (News): Scanned {len(news_items)} item(s)", flush=True)
                print(f"[6/23] iPoint (Blog): Scanned {len(blog_items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "iPoint (News & Blog)", "error": str(e)})

        # [12] ECHA News
        try:
            page = context.new_page()
            try:
                items = scrape_echa(page)
                channel_items["ECHA News"] = items
                print(f"[7/23] ECHA News: Scanned {len(items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "ECHA News", "error": str(e)})

        # [14] EUR-Lex
        try:
            page = context.new_page()
            try:
                items = scrape_eurlex(page)
                channel_items["EUR-Lex"] = items
                print(f"[8/23] EUR-Lex: Scanned {len(items)} item(s)", flush=True)
            finally:
                page.close()
        except Exception as e:
            errors.append({"channel": "EUR-Lex", "error": str(e)})

        # [20 & 21] 화학물질안전원 고시/예규/공고
        try:
            notice_items, normal_items = scrape_nics_rules_pw(context)
            channel_items["화학물질안전원 고시/예규/공고(공지)"] = notice_items
            channel_items["화학물질안전원 고시/예규/공고(일반)"] = normal_items
            print(f"[9/23] 안전원 고시/예규/공고(공지): Scanned {len(notice_items)} item(s)", flush=True)
            print(f"[10/23] 안전원 고시/예규/공고(일반): Scanned {len(normal_items)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "화학물질안전원 고시/예규/공고(공지)", "error": str(e)})
            errors.append({"channel": "화학물질안전원 고시/예규/공고(일반)", "error": str(e)})

        # [22 & 23] 화학물질안전원 행정예고
        try:
            notice_items, normal_items = scrape_nics_admin_notice_pw(context)
            channel_items["화학물질안전원 행정예고(공지)"] = notice_items
            channel_items["화학물질안전원 행정예고(일반)"] = normal_items
            print(f"[11/23] 안전원 행정예고(공지): Scanned {len(notice_items)} item(s)", flush=True)
            print(f"[12/23] 안전원 행정예고(일반): Scanned {len(normal_items)} item(s)", flush=True)
        except Exception as e:
            errors.append({"channel": "화학물질안전원 행정예고(공지)", "error": str(e)})
            errors.append({"channel": "화학물질안전원 행정예고(일반)", "error": str(e)})

        browser.close()

    # 2. Execute Requests & API Scrapers
    # [15] ECHACHEM
    items = scrape_echachem_api(errors)
    channel_items["ECHACHEM"] = items
    print(f"[13/23] ECHACHEM: Scanned {len(items)} item(s)", flush=True)

    # [5] IMDS Professional Blog
    try:
        items = scrape_imds_pro()
        channel_items["IMDS Professional Blog"] = items
        print(f"[14/23] IMDS Pro: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "IMDS Professional Blog", "error": str(e)})

    # [6] Assent Content Hub
    try:
        items = scrape_assent()
        channel_items["Assent Content Hub"] = items
        print(f"[15/23] Assent: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "Assent Content Hub", "error": str(e)})

    # [7] CDX News
    try:
        items = scrape_cdx()
        channel_items["CDX News"] = items
        print(f"[16/23] CDX News: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "CDX News", "error": str(e)})

    # [8] CDX Updates
    try:
        items = scrape_cdx_updates()
        channel_items["CDX Updates"] = items
        print(f"[17/23] CDX Updates: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "CDX Updates", "error": str(e)})

    # [9] CDX Events
    try:
        items = scrape_cdx_events()
        channel_items["CDX Events"] = items
        print(f"[18/23] CDX Events: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "CDX Events", "error": str(e)})

    # [13] COMPASS
    try:
        items = scrape_compass()
        channel_items["COMPASS"] = items
        print(f"[19/23] COMPASS: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "COMPASS", "error": str(e)})

    # [16] 국가법령정보센터
    items = scrape_law_center_openapi(errors)
    channel_items["국가법령정보센터"] = items
    print(f"[20/23] 국가법령정보센터 (Open API): Scanned {len(items)} item(s)", flush=True)

    # [17] 기후에너지환경부 입법예고
    try:
        items = scrape_mcee_legislation()
        channel_items["기후에너지환경부 입법예고"] = items
        print(f"[21/23] 기후에너지환경부 입법예고: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "기후에너지환경부 입법예고", "error": str(e)})

    # [18] 기후에너지환경부 행정예고
    try:
        items = scrape_mcee_admin_notice()
        channel_items["기후에너지환경부 행정예고"] = items
        print(f"[22/23] 기후에너지환경부 행정예고: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "기후에너지환경부 행정예고", "error": str(e)})

    # [19] 기후에너지환경부 고시/훈령/예규
    try:
        items = scrape_mcee_rules()
        channel_items["기후에너지환경부 고시/훈령/예규"] = items
        print(f"[23/23] 기후에너지환경부 고시/훈령/예규: Scanned {len(items)} item(s)", flush=True)
    except Exception as e:
        errors.append({"channel": "기후에너지환경부 고시/훈령/예규", "error": str(e)})

    # 3. Process Sheet Entries & Compile Expanded Dashboard Rows
    desired_order = [
        "RMI News",
        "IMDS News",
        "IMDS News (Services)",
        "IMDS Release Notes(Next)",
        "IMDS Professional Blog",
        "Assent Content Hub",
        "CDX News",
        "CDX Updates",
        "CDX Events",
        "iPoint (News)",
        "iPoint (Blog)",
        "ECHA News",
        "COMPASS",
        "EUR-Lex",
        "ECHACHEM",
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

    print("\n>> Processing sheet entries & compiling expanded dashboard rows...", flush=True)
    for channel_name in desired_order:
        items = channel_items.get(channel_name, [])

        if channel_name in ["EUR-Lex", "ECHACHEM", "국가법령정보센터"]:
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
                        "title": primary_item.get("title", "Scan Failed (See diagnostic below)"),
                        "link_url": primary_item.get("url", "#"),
                        "source_url": primary_item.get("source_url", "#"),
                    })
                elif primary_item.get("is_maintenance"):
                    display_rows.append({
                        "display_name": t_name,
                        "status": "MAINTENANCE",
                        "date": "-",
                        "title": primary_item.get("title", "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)"),
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
                    "title": "Scan Failed (See diagnostic below)",
                    "link_url": channel_source_url,
                    "source_url": channel_source_url,
                })
            elif items and items[0].get("is_maintenance"):
                display_rows.append({
                    "display_name": channel_name,
                    "status": "MAINTENANCE",
                    "date": "-",
                    "title": items[0].get("title", "Site Maintenance (Temporarily Unavailable - 점검 중 모니터링 불가)"),
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

    # 5. Compliance 시트 업데이트 (7개 열 반영)
    print(f">> Updating Compliance Sheet ({COMPLIANCE_SPREADSHEET_ID[:8]}...) -> 'Daily Feed' tab...", flush=True)
    update_compliance_daily_feed(client, display_rows, errors)

    # 6. HTML 테이블 메일 발송
    send_email_report(display_rows, total_new_items_count, errors)
    print(">> Monitoring process completed successfully.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as unhandled_error:
        error_trace = traceback.format_exc()
        print(f"\n!! [FATAL UNHANDLED EXCEPTION DETECTED]\n{error_trace}", flush=True)
        send_critical_crash_alert(error_trace)
        sys.exit(1)
