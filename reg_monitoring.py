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
from urllib.parse import urljoin
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
# 1) 신규 소식 이력 추적 및 키 비교 전용 시트 (History DB)
HISTORY_SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "1jIPPPb4oLRYbt_yNv9UgMx2BUo19W-CE9kRIIDGbDpg")

# 2) 최종 모니터링 결과 및 데일리 피드 적재 대상 시트 (Compliance Master DB)
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
}

# 국가법령정보센터 6개 통합검색 직결 URL 매핑
LAW_SEARCH_DIRECT_URLS = {
    "국가법령: K-ELV (자원순환법 시행령)": "https://www.law.go.kr/unSc.do?query=%EC%9C%A0%ED%95%B4%EB%AC%BC%EC%A7%88%EC%9D%98%20%ED%95%A8%EC%9C%A0%20%EA%B8%B0%EC%A4%80&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-POPs (잔류성오염물질)": "https://www.law.go.kr/unSc.do?query=%EC%9E%94%EB%A5%98%EC%84%B1%EC%98%A4%EC%97%BC%EB%AC%BC%EC%A7%88%EC%9D%98%20%EC%A2%85%EB%A5%98&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-BPR (승인유예물질)": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%8A%B9%EC%9D%B8%EC%9C%A0%EC%98%88%EB%8C%80%EC%83%81+%EA%B8%B0%EC%A1%B4%EC%82%B4%EC%83%9D%EB%AC%BC%EB%AC%BC%EC%A7%88%EC%9D%98+%EC%A7%80%EC%A0%95",
    "국가법령: K-REACH (제한·금지물질)": "https://www.law.go.kr/unSc.do?query=%EC%A0%9C%ED%95%9C%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-REACH (허가물질)": "https://www.law.go.kr/LSW/unSc.do?query=%ED%97%88%EA%B0%80%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
    "국가법령: K-REACH (중점관리물질)": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%A4%91%EC%A0%90%EA%B4%80%EB%A6%AC%EB%AC%BC%EC%A7%88",
}


# ==========================================
# 0-1. Key Generator Utility
# ==========================================
def generate_unique_key(channel: str, date: str, title: str) -> str:
    clean_channel = channel.strip().replace(" ", "")
    clean_date = date.strip().replace(" ", "")
    title_hash = hashlib.sha256(title.strip().encode("utf-8")).hexdigest()[:10]
    return f"{clean_channel}_{clean_date}_{title_hash}"


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
        log_sheet = spreadsheet.worksheet("Log")
    except Exception:
        log_sheet = spreadsheet.get_worksheet(0)

    first_row = log_sheet.row_values(1)
    expected_headers = [
        "Timestamp",
        "Source",
        "Publication Date",
        "Title / Summary",
        "Unique Key",
        "Source URL",
        "Remarks",
    ]
    if not first_row:
        log_sheet.append_row(expected_headers)

    return log_sheet


def get_existing_keys(sheet):
    keys = sheet.col_values(5)
    return set(keys[1:]) if len(keys) > 1 else set()


def update_compliance_daily_feed(client, display_rows, errors):
    try:
        # 1Gar_... Compliance 시트 열기
        ss = client.open_by_key(COMPLIANCE_SPREADSHEET_ID)
        
        try:
            feed_sheet = ss.worksheet("Daily Feed")
        except Exception:
            feed_sheet = ss.add_worksheet(title="Daily Feed", rows="100", cols="10")

        all_rows = []

        # 1. 메인 검증 테이블 헤더 및 데이터
        all_rows.append(["No", "Source / Endpoint", "Status", "Date", "Latest Record / Title", "Link"])
        for idx, r in enumerate(display_rows, start=1):
            all_rows.append([
                idx,
                r.get("display_name", ""),
                r.get("status", ""),
                r.get("date", ""),
                r.get("title", ""),
                r.get("link_url", "")
            ])

        # 2. 하단 에러 진단 텍스트 영역 (Inspection Required Targets)
        if errors:
            all_rows.append([])  # 빈 행 구분
            all_rows.append([f"[Inspection Required Targets] (Total: {len(errors)})"])
            all_rows.append(["Target", "Diagnostic Detail"])
            for err in errors:
                all_rows.append([err.get("channel", ""), err.get("error", "")])

        feed_sheet.clear()
        feed_sheet.update("A1", all_rows)
        print(f">> Successfully synced {len(display_rows)} items & {len(errors)} error diagnostics to 'Compliance -> Daily Feed' sheet.")
    except Exception as ex:
        print(f"!! Failed to update Compliance 'Daily Feed' sheet: {str(ex)}")


# ==========================================
# 2. Individual Channel Scrapers
# ==========================================

# [1] RMI News
def scrape_rmi():
    url = CHANNEL_BASE_URLS["RMI News"]
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=25, verify=False)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

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


# [2] IMDS News
def scrape_imds_news(page):
    url = CHANNEL_BASE_URLS["IMDS News"]
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(1000)

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
            channel_name = "IMDS Professional Blog"
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
            channel_name = "Assent Content Hub"
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
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the News" in txt and len(txt) > 30:
            read_link = card.find("a", href=True, string=lambda t: t and "Read the News" in t) or card.find("a",
                                                                                                            href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt)
            date_str = date_match.group(0) if date_match else "N/A"

            title_elem = card.find(["h2", "h3", "h4"])
            if title_elem and "Latest Compliance" not in title_elem.get_text() and len(
                    title_elem.get_text(strip=True)) > 10:
                title_str = title_elem.get_text(strip=True)
            else:
                parts = [
                    p.strip() for p in txt.split("  ")
                    if len(p.strip()) > 15 and not any(
                        k in p for k in ["Read the News", "Latest Compliance", "Filter News", date_str])
                ]
                title_str = parts[0] if parts else "CDX Regulatory Update"

            channel_name = "CDX News"
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

            read_link = card.find("a", href=True, string=lambda t: t and "Read the Update" in t) or card.find("a",
                                                                                                              href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            channel_name = "CDX Updates"
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

        channel_name = "CDX Events"
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


# [13] COMPASS (재시도 로직 포함 및 30초 타임아웃)
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


# [14] EUR-Lex (실제 DOM 태그 table.dataTable 및 a.EurlexTooltip 타깃팅)
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

            soup = BeautifulSoup(page.content(), "html.parser")

            candidate_rows = []
            tables = soup.select("table.dataTable, table#relatedDocsTb, table[id*='Docs']")
            for tbl in tables:
                rows = tbl.select("tbody tr[role='row'], tbody tr")
                for r in rows:
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
                date_match = re.search(r"(\d{2}/\d{2}/\d{4})|(\d{4}-\d{2}-\d{2})", soup.get_text())
                pub_date = date_match.group(0) if date_match else "In Force"
                celex_id = [s for s in target_url.split(":") if s][-1]

                results.append({
                    "channel": channel_name,
                    "target_name": cfg["name"],
                    "date": pub_date,
                    "title": f"{celex_id} (Initial act - No subsequent amendments yet)",
                    "key": generate_unique_key(channel_name, pub_date, cfg["name"]),
                    "url": target_url,
                    "source_url": target_url,
                })

        except Exception as item_err:
            print(f"!! [EUR-Lex] Error scanning {cfg['name']}: {str(item_err)}")
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


# [15~22] ECHACHEM (Annex XIV 및 Annex XVII 내림차순 정렬 적용)
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
                print(f"!! [ECHACHEM API] {err_msg}")
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
            print(f"!! [ECHACHEM API] Error: {err_msg}")
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


# [23] 국가법령정보센터 (HTTPS 연결 타임아웃 시 HTTP 포트 폴백)
def scrape_law_center_openapi(errors_list):
    channel_name = "국가법령정보센터"

    if not LAW_OC_KEY:
        err_msg = "LAW_OC_KEY environment variable is missing in GitHub Secrets."
        print(f"!! [국가법령 Open API] Error: {err_msg}")
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
            try:
                resp = requests.get("https://www.law.go.kr/DRF/lawSearch.do", params=params, headers=HTTP_HEADERS, timeout=12)
                resp.raise_for_status()
            except Exception:
                resp = requests.get("http://www.law.go.kr/DRF/lawSearch.do", params=params, headers=HTTP_HEADERS, timeout=15)
                resp.raise_for_status()

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
            print(f"!! [국가법령 Open API] Error: {err_msg}")
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


# ==========================================
# 3. HTML Table Email Notification
# ==========================================
def send_email_report(display_rows, total_new_count, errors):
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Email credentials missing. Skipped email dispatch.")
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
            status_text = '<strong style="color: #16a34a; font-size: 13px;">NEW</strong>'
        elif row["status"] == "ERROR":
            status_text = '<strong style="color: #dc2626; font-size: 13px;">ERROR</strong>'
        else:
            status_text = '<span style="color: #6b7280; font-size: 12px; font-weight: 500;">NO UPDATE</span>'

        if row["link_url"] and row["link_url"] != "#":
            link_btn = f'<a href="{row["link_url"]}" target="_blank" style="display: inline-block; padding: 4px 10px; background-color: #dcfce7; color: #166534; border: 1px solid #86efac; text-decoration: none; border-radius: 4px; font-size: 11px; font-weight: 600;">Link &rarr;</a>'
        else:
            link_btn = '<span style="color: #9ca3af; font-size: 12px;">-</span>'

        rows_html += f"""
        <tr style="background-color: {bg_color}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 8px; text-align: center; font-weight: bold; color: #4b5563; font-size: 13px;">{idx}</td>
            <td style="padding: 10px 8px; text-align: left; font-weight: 600; font-size: 13px; white-space: nowrap;">
                <a href="{row['source_url']}" target="_blank" style="color: #1d4ed8; text-decoration: none;">{row['display_name']}</a>
            </td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap;">{status_text}</td>
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
                <td style="padding: 8px 10px; font-weight: bold; color: #c53030; font-size: 13px; white-space: nowrap; vertical-align: top;">{err['channel']}</td>
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
                        <th style="padding: 8px 10px; width: 35%;">Target</th>
                        <th style="padding: 8px 10px;">Diagnostic Detail</th>
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
                            <th style="padding: 10px 8px; color: #ffffff; text-align: left; font-size: 13px; font-weight: 600; width: 220px; border-bottom: 1px solid #16a34a;">Source / Endpoint</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 90px; border-bottom: 1px solid #16a34a;">Status</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 90px; border-bottom: 1px solid #16a34a;">Date</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: left; font-size: 13px; font-weight: 600; border-bottom: 1px solid #16a34a;">Latest Record / Title</th>
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
        print(f">> Notification HTML table email dispatched successfully to: {RECIPIENT_EMAIL}")
    except Exception as e:
        print(f"!! Failed to send email: {str(e)}")


# ==========================================
# 3-1. Critical Crash Email Notification
# ==========================================
def send_critical_crash_alert(error_detail):
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Critical alert: Email credentials missing. Cannot dispatch alert.")
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
        print(f">> Critical failure alert email dispatched successfully to: {RECIPIENT_EMAIL}")
    except Exception as mail_err:
        print(f"!! Failed to send critical crash alert email: {str(mail_err)}")


# ==========================================
# 4. Main Controller
# ==========================================
def main():
    print(">> Initializing Google Sheets Client...")
    client = init_gspread_client()

    # 1. 신규 소식 비교를 위해 원래 History 시트 연결
    print(f">> Connecting to History Sheet ({HISTORY_SPREADSHEET_ID[:8]}...)...")
    history_log_sheet = init_history_sheet(client)
    existing_keys = get_existing_keys(history_log_sheet)
    print(f">> Existing registered keys count: {len(existing_keys)}")

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
    }
    errors = []

    # 1. Execute Playwright Scrapers
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            # [2] IMDS News
            try:
                items = scrape_imds_news(page)
                channel_items["IMDS News"] = items
                print(f"[1/16] IMDS News: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS News", "error": str(e)})

            # [3] IMDS News (Services)
            try:
                items = scrape_imds_services_news(page)
                channel_items["IMDS News (Services)"] = items
                print(f"[2/16] IMDS Services: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS News (Services)", "error": str(e)})

            # [4] IMDS Release Notes(Next)
            try:
                items = scrape_imds_release_notes(page)
                channel_items["IMDS Release Notes(Next)"] = items
                print(f"[3/16] IMDS Release: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS Release Notes(Next)", "error": str(e)})

            # [10 & 11] iPoint (News & Blog)
            try:
                news_items, blog_items = scrape_ipoint_channels(page)
                channel_items["iPoint (News)"] = news_items
                channel_items["iPoint (Blog)"] = blog_items
                print(f"[4/16] iPoint (News): Scanned {len(news_items)} item(s)")
                print(f"[5/16] iPoint (Blog): Scanned {len(blog_items)} item(s)")
            except Exception as e:
                errors.append({"channel": "iPoint (News & Blog)", "error": str(e)})

            # [12] ECHA News
            try:
                items = scrape_echa(page)
                channel_items["ECHA News"] = items
                print(f"[6/16] ECHA News: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "ECHA News", "error": str(e)})

            # [14] EUR-Lex
            try:
                items = scrape_eurlex(page)
                channel_items["EUR-Lex"] = items
                print(f"[7/16] EUR-Lex: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "EUR-Lex", "error": str(e)})

        finally:
            page.close()
            browser.close()

    # 2. Execute Requests & API Scrapers
    # [15] ECHACHEM
    items = scrape_echachem_api(errors)
    channel_items["ECHACHEM"] = items
    print(f"[8/16] ECHACHEM: Scanned {len(items)} item(s)")

    # [1] RMI News
    try:
        items = scrape_rmi()
        channel_items["RMI News"] = items
        print(f"[9/16] RMI News: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "RMI News", "error": str(e)})

    # [5] IMDS Professional Blog
    try:
        items = scrape_imds_pro()
        channel_items["IMDS Professional Blog"] = items
        print(f"[10/16] IMDS Pro: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "IMDS Professional Blog", "error": str(e)})

    # [6] Assent Content Hub
    try:
        items = scrape_assent()
        channel_items["Assent Content Hub"] = items
        print(f"[11/16] Assent: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "Assent Content Hub", "error": str(e)})

    # [7] CDX News
    try:
        items = scrape_cdx()
        channel_items["CDX News"] = items
        print(f"[12/16] CDX News: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX News", "error": str(e)})

    # [8] CDX Updates
    try:
        items = scrape_cdx_updates()
        channel_items["CDX Updates"] = items
        print(f"[13/16] CDX Updates: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX Updates", "error": str(e)})

    # [9] CDX Events
    try:
        items = scrape_cdx_events()
        channel_items["CDX Events"] = items
        print(f"[14/16] CDX Events: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX Events", "error": str(e)})

    # [13] COMPASS
    try:
        items = scrape_compass()
        channel_items["COMPASS"] = items
        print(f"[15/16] COMPASS: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "COMPASS", "error": str(e)})

    # [16] 국가법령정보센터 (항상 최하단 순서 유지)
    items = scrape_law_center_openapi(errors)
    channel_items["국가법령정보센터"] = items
    print(f"[16/16] 국가법령정보센터 (Open API): Scanned {len(items)} item(s)")

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
    ]

    now_kst_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")
    rows_to_append = []
    display_rows = []
    total_new_items_count = 0

    print("\n>> Processing sheet entries & compiling expanded dashboard rows...")
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
                    if sub_item.get("is_placeholder") or sub_item.get("has_error"):
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
                        print(f">> [NEW APPENDED] {t_name}: {sub_item['title'][:35]}...")

                primary_item = sub_items[0]
                if primary_item.get("has_error"):
                    status = "ERROR"
                    date_val = "-"
                    title_val = primary_item["title"]
                    link_val = primary_item["url"]
                elif new_sub_items:
                    status = "NEW"
                    first_new = new_sub_items[0]
                    date_val = first_new["date"]
                    title_val = first_new["title"]
                    link_val = first_new["url"]
                else:
                    status = "NO UPDATE"
                    date_val = primary_item["date"]
                    title_val = primary_item["title"]
                    link_val = primary_item["url"]

                display_rows.append({
                    "display_name": t_name,
                    "status": status,
                    "date": date_val,
                    "title": title_val,
                    "link_url": link_val,
                    "source_url": primary_item["source_url"],
                })

        else:
            new_items_for_channel = []
            for item in items:
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
                    print(f">> [NEW APPENDED] {item['channel']}: {item['title'][:35]}...")

            channel_source_url = CHANNEL_BASE_URLS.get(channel_name, "#")
            err_matched = [e for e in errors if e["channel"] == channel_name]

            if err_matched and not items:
                status = "ERROR"
                date_val = "-"
                title_val = "Scan Failed (See diagnostic below)"
                link_val = channel_source_url
            elif new_items_for_channel:
                status = "NEW"
                latest_item = new_items_for_channel[0]
                date_val = latest_item["date"]
                title_val = latest_item["title"]
                link_val = latest_item["url"]
            elif items:
                status = "NO UPDATE"
                latest_item = items[0]
                date_val = latest_item["date"]
                title_val = latest_item["title"]
                link_val = latest_item["url"]
            else:
                status = "NO UPDATE"
                date_val = "-"
                title_val = "No active updates found"
                link_val = channel_source_url

            display_rows.append({
                "display_name": channel_name,
                "status": status,
                "date": date_val,
                "title": title_val,
                "link_url": link_val,
                "source_url": channel_source_url,
            })

    # 4. History 시트 - Log 탭에 신규 업데이트 누적 기록
    if rows_to_append:
        history_log_sheet.append_rows(rows_to_append)
        print(f">> Successfully appended {len(rows_to_append)} rows to 'History -> Log' sheet.")
    else:
        print(">> No new rows to append to 'History -> Log' sheet.")

    # 5. Compliance 시트 - Daily Feed 탭에 최신 모니터링 테이블 및 에러 진단 덮어쓰기
    print(f">> Updating Compliance Sheet ({COMPLIANCE_SPREADSHEET_ID[:8]}...) -> 'Daily Feed' tab...")
    update_compliance_daily_feed(client, display_rows, errors)

    # 6. HTML 테이블 메일 발송
    send_email_report(display_rows, total_new_items_count, errors)
    print(">> Monitoring process completed successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as unhandled_error:
        error_trace = traceback.format_exc()
        print(f"\n!! [FATAL UNHANDLED EXCEPTION DETECTED]\n{error_trace}")
        send_critical_crash_alert(error_trace)
        sys.exit(1)
