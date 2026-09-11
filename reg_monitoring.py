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
import traceback
from urllib.parse import urljoin
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
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "1jIPPPb4oLRYbt_yNv9UgMx2BUo19W-CE9kRIIDGbDpg")
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
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

MAX_SCAN_COUNT = int(os.environ.get("MAX_SCAN_COUNT", 5))


# ==========================================
# 0-1. Key Generator Utility
# ==========================================
def generate_unique_key(channel: str, date: str, title: str) -> str:
    """[채널명]_[날짜]_[제목Hash] 형식으로 표준화된 고유 키를 생성합니다."""
    clean_channel = channel.strip().replace(" ", "")
    clean_date = date.strip().replace(" ", "")
    title_hash = hashlib.sha256(title.strip().encode("utf-8")).hexdigest()[:10]
    return f"{clean_channel}_{clean_date}_{title_hash}"


# ==========================================
# 1. Google Sheets Integration
# ==========================================
def init_google_sheet():
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

    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(SPREADSHEET_ID)
    sheet = spreadsheet.get_worksheet(0)

    first_row = sheet.row_values(1)
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
        sheet.append_row(expected_headers)

    return sheet


def get_existing_keys(sheet):
    keys = sheet.col_values(5)
    return set(keys[1:]) if len(keys) > 1 else set()


# ==========================================
# 2. Individual Channel Scrapers
# ==========================================

# [1] RMI News
def scrape_rmi():
    url = "https://www.responsiblemineralsinitiative.org/news/"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20, verify=False)
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
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
        })
    return results


# [2] IMDS News
def scrape_imds_news(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/imds-news"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

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
                "date": target_date,
                "title": target_title,
                "key": generate_unique_key(channel_name, target_date, target_title),
                "url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break

    return results


# [3] IMDS News (Services)
def scrape_imds_services_news(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/imds-extended-services-news"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

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
                "date": target_date,
                "title": target_title,
                "key": generate_unique_key(channel_name, target_date, target_title),
                "url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break

    return results


# [4] IMDS Release Notes(Next)
def scrape_imds_release_notes(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/release-notes-mof-next"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

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
            "date": date_str,
            "title": text,
            "key": generate_unique_key(channel_name, date_str, text),
            "url": href,
        })
        if len(results) >= MAX_SCAN_COUNT:
            break

    return results


# [5] IMDS Professional Blog
def scrape_imds_pro():
    url = "https://www.imds-professional.com/en/ipblog/"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=35)
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
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
            })
    return results


# [6] Assent Content Hub
def scrape_assent():
    url = "https://www.assent.com/resources/content-hub/?pager=1&filter=1&filter_order=newest"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    cards = soup.select("div.post-card, div[data-post-id]")
    results = []
    for card in cards[:MAX_SCAN_COUNT]:
        h6 = card.select_one("h6.h6, h6, .desc-content h6")
        title_str = h6.get_text(strip=True) if h6 else (card.select_one("p").get_text(strip=True) if card.select_one("p") else "")
        a_elem = card.find("a", href=True)
        link_url = urljoin(url, a_elem["href"]) if a_elem else url

        if title_str:
            channel_name = "Assent Content Hub"
            date_str = "N/A"
            results.append({
                "channel": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
            })
    return results


# [7] CDX News
def scrape_cdx():
    url = "https://public.cdxsystem.com/en/web/cdx/news"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    results = []
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the News" in txt and len(txt) > 30:
            read_link = card.find("a", href=True, string=lambda t: t and "Read the News" in t) or card.find("a", href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt)
            date_str = date_match.group(0) if date_match else "N/A"

            title_elem = card.find(["h2", "h3", "h4"])
            if title_elem and "Latest Compliance" not in title_elem.get_text() and len(title_elem.get_text(strip=True)) > 10:
                title_str = title_elem.get_text(strip=True)
            else:
                parts = [
                    p.strip() for p in txt.split("  ")
                    if len(p.strip()) > 15 and not any(k in p for k in ["Read the News", "Latest Compliance", "Filter News", date_str])
                ]
                title_str = parts[0] if parts else "CDX Regulatory Update"

            channel_name = "CDX News"
            results.append({
                "channel": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


# [8] CDX Updates
def scrape_cdx_updates():
    url = "https://public.cdxsystem.com/en/web/cdx/updates-releases"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
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

            read_link = card.find("a", href=True, string=lambda t: t and "Read the Update" in t) or card.find("a", href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url

            channel_name = "CDX Updates"
            results.append({
                "channel": channel_name,
                "date": date_str,
                "title": title_str,
                "key": generate_unique_key(channel_name, date_str, title_str),
                "url": link_url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


# [9] CDX Events
def scrape_cdx_events():
    url = "https://public.cdxsystem.com/en/web/cdx/events"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
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
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
        })
    return results


# [10 & 11] iPoint (News & Blog)
def scrape_ipoint_channels(page):
    url = "https://www.ipoint-systems.com/news/"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)

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
                        "date": date_str,
                        "title": title_str,
                        "key": generate_unique_key(channel_name, date_str, title_str),
                        "url": link_url,
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
                        "date": date_str,
                        "title": title_str,
                        "key": generate_unique_key(channel_name, date_str, title_str),
                        "url": link_url,
                    })
                    if len(blog_items) >= MAX_SCAN_COUNT:
                        break

    return news_items, blog_items


# [12] ECHA News
def scrape_echa(page):
    url = "https://echa.europa.eu/news"
    page.goto(url, wait_until="domcontentloaded", timeout=35000)

    try:
        cookie_btn = page.locator("button:has-text('Accept'), button:has-text('agree'), a:has-text('Accept')").first
        if cookie_btn.is_visible(timeout=3000):
            cookie_btn.click()
            page.wait_for_timeout(1000)
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
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
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
    resp = requests.get(api_url, params=params, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    item_list = data.get("list", [])
    results = []
    for item in item_list[:MAX_SCAN_COUNT]:
        title_str = item.get("newTitle", "").strip()
        new_seq = str(item.get("newSeq", ""))
        date_str = str(item.get("newRegdt", "N/A")).strip()

        encoded_seq = base64.b64encode(new_seq.encode("utf-8")).decode("utf-8")
        link_url = f"https://www.compass.or.kr/news/view?newSeq={encoded_seq}"

        channel_name = "COMPASS"
        results.append({
            "channel": channel_name,
            "date": date_str,
            "title": title_str,
            "key": generate_unique_key(channel_name, date_str, title_str),
            "url": link_url,
        })
    return results


# [14] 국가법령정보센터 (6개 법령/행정규칙 추적)
def scrape_law_center(page):
    channel_name = "국가법령정보센터"
    target_configs = [
        {
            "type": "table",  # 1. K-ELV (별표·서식)
            "name": "K-ELV",
            "url": "https://www.law.go.kr/unSc.do?query=%EC%9C%A0%ED%95%B4%EB%AC%BC%EC%A7%88%EC%9D%98%20%ED%95%A8%EC%9C%A0%20%EA%B8%B0%EC%A4%80&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        },
        {
            "type": "list",   # 2. K-POPs (행정규칙)
            "name": "K-POPs",
            "url": "https://www.law.go.kr/unSc.do?query=%EC%9E%94%EB%A5%98%EC%84%B1%EC%98%A4%EC%97%BC%EB%AC%BC%EC%A7%88%EC%9D%98%20%EC%A2%85%EB%A5%98&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        },
        {
            "type": "list",   # 3. K-BPR (행정규칙)
            "name": "K-BPR",
            "url": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%8A%B9%EC%9D%B8%EC%9C%A0%EC%98%88%EB%8C%80%EC%83%81+%EA%B8%B0%EC%A1%B4%EC%82%B4%EC%83%9D%EB%AC%BC%EB%AC%BC%EC%A7%88%EC%9D%98+%EC%A7%80%EC%A0%95",
        },
        {
            "type": "list",   # 4. K-REACH (제한·금지물질)
            "name": "K-REACH (제한·금지물질)",
            "url": "https://www.law.go.kr/unSc.do?query=%EC%A0%9C%ED%95%9C%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        },
        {
            "type": "list",   # 5. K-REACH (허가물질)
            "name": "K-REACH (허가물질)",
            "url": "https://www.law.go.kr/LSW/unSc.do?query=%ED%97%88%EA%B0%80%EB%AC%BC%EC%A7%88%20%EC%A7%80%EC%A0%95&menuId=391&subMenuId=395&tabMenuId=409&pageIndex=1&section=&dicClsCd=",
        },
        {
            "type": "list",   # 6. K-REACH (중점관리물질)
            "name": "K-REACH (중점관리물질)",
            "url": "https://www.law.go.kr/LSW/unSc.do?section=&menuId=391&subMenuId=395&tabMenuId=409&eventGubun=060101&query=%EC%A4%91%EC%A0%90%EA%B4%80%EB%A6%AC%EB%AC%BC%EC%A7%88",
        },
    ]

    results = []

    for cfg in target_configs:
        target_url = cfg["url"]
        page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)

        soup = BeautifulSoup(page.content(), "html.parser")

        if cfg["type"] == "table":
            # 유형 A: 별표·서식 테이블 구조 (tbl_type2)
            tr = soup.select_one("table.tbl_type2 tbody tr")
            if not tr:
                continue
            tds = tr.find_all("td")
            if len(tds) < 3:
                continue

            tit_elem = tds[0].select_one(".s_tit")
            raw_title = tit_elem.get_text(" ", strip=True) if tit_elem else "유해물질의 함유기준"

            # 상세 링크 URL 파출
            a_desc = tds[1].select_one("a.s_desc")
            if a_desc and a_desc.get("href"):
                link_url = urljoin("https://www.law.go.kr/", a_desc["href"])
            else:
                link_url = target_url

            date_raw = tds[2].get_text(" ", strip=True)
            date_match = re.search(r"(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", date_raw)
            date_str = date_match.group(1).replace(" ", "") if date_match else date_raw

            results.append({
                "channel": channel_name,
                "date": date_str,
                "title": raw_title,
                "key": generate_unique_key(channel_name, date_str, raw_title),
                "url": link_url,
            })

        else:
            # 유형 B: 행정규칙 리스트 구조 (ul.list_type li)
            li_list = soup.select("ul.list_type li")
            target_a = None
            for li in li_list:
                a_tag = li.select_one("a.s_tit")
                if a_tag and "onclick" in a_tag.attrs:
                    target_a = a_tag
                    break

            if not target_a:
                continue

            tx2_elem = target_a.select_one("span.tx2")
            tx2_text = tx2_elem.get_text(" ", strip=True) if tx2_elem else ""

            # 날짜 추출: 고시 개정일 우선 매칭, 없을 시 시행일 매칭
            date_match = re.search(r",\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})\.?,", tx2_text)
            if not date_match:
                date_match = re.search(r"(\d{4}\.\s*\d{1,2}\.\s*\d{1,2})", tx2_text)
            date_str = date_match.group(1).replace(" ", "") if date_match else "N/A"

            # 제목 추출: span.tx2 태그를 제외한 텍스트
            if tx2_elem:
                tx2_elem.extract()
            raw_title = target_a.get_text(" ", strip=True)

            # 상세 뷰어 URL 매핑 (onclick="javascript:showUnScDetail('admRulLsInfoP.do?admRulSeq=...')")
            onclick_val = target_a.get("onclick", "")
            seq_match = re.search(r"admRulSeq=(\d+)", onclick_val)
            if seq_match:
                link_url = f"https://www.law.go.kr/admRulLsInfoP.do?admRulSeq={seq_match.group(1)}"
            else:
                link_url = target_url

            results.append({
                "channel": channel_name,
                "date": date_str,
                "title": raw_title,
                "key": generate_unique_key(channel_name, date_str, raw_title),
                "url": link_url,
            })

    return results


# ==========================================
# 3. HTML Table Email Notification
# ==========================================
def send_email_report(new_items, errors):
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Email credentials missing (ALERT_EMAIL_SENDER, ALERT_EMAIL_PASSWORD, ALERT_EMAIL_RECEIVER). Skipped.")
        return

    now_utc = datetime.now(timezone.utc)
    kst_tz = timezone(timedelta(hours=9))
    now_kst = now_utc.astimezone(kst_tz)

    today_str = now_kst.strftime("%Y-%m-%d")
    utc_str = now_utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    kst_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")
    execution_time_display = f"{utc_str} ({kst_str})"

    if errors:
        subject = f"Regulatory News Monitoring: Action Required {len(new_items)} New | {len(errors)} Scraping Issue(s) ({today_str})"
    else:
        subject = f"Regulatory News Monitoring: {len(new_items)} New Regulatory Update(s) Detected ({today_str})"

    rows_html = ""
    for idx, item in enumerate(new_items, start=1):
        bg_color = "#ffffff" if idx % 2 != 0 else "#f9fafb"
        rows_html += f"""
        <tr style="background-color: {bg_color}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 8px; text-align: center; font-weight: bold; color: #4b5563; font-size: 13px;">{idx}</td>
            <td style="padding: 10px 8px; text-align: center; font-weight: 600; color: #111827; font-size: 13px; white-space: nowrap;">{item['channel']}</td>
            <td style="padding: 10px 8px; text-align: center; color: #4b5563; font-size: 12px; white-space: nowrap;">{item['date']}</td>
            <td style="padding: 10px 10px; color: #1f2937; line-height: 1.4; font-size: 13px; min-width: 200px;">{item['title']}</td>
            <td style="padding: 10px 8px; text-align: center; white-space: nowrap;">
                <a href="{item['url']}" target="_blank" style="display: inline-block; padding: 5px 12px; background-color: #dcfce7; color: #166534; border: 1px solid #86efac; text-decoration: none; border-radius: 4px; font-size: 11px; font-weight: 600;">Link &rarr;</a>
            </td>
        </tr>
        """

    errors_section = ""
    if errors:
        error_rows = ""
        for err in errors:
            error_rows += f"""
            <tr style="background-color: #fff5f5; border-bottom: 1px solid #fed7d7;">
                <td style="padding: 8px 10px; font-weight: bold; color: #c53030; font-size: 13px; white-space: nowrap;">{err['channel']}</td>
                <td style="padding: 8px 10px; color: #9b2c2c; font-family: monospace; font-size: 12px; word-break: break-all;">{err['error']}</td>
            </tr>
            """
        errors_section = f"""
        <h3 style="color: #dc2626; margin-top: 25px; margin-bottom: 10px; font-size: 15px;">
            &#9888; Inspection Required Channels ({len(errors)})
        </h3>
        <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #fecaca; font-size: 13px; min-width: 320px;">
                <thead>
                    <tr style="background-color: #fee2e2; color: #991b1b; text-align: left;">
                        <th style="padding: 8px 10px; width: 30%;">Channel</th>
                        <th style="padding: 8px 10px;">Error Diagnostic</th>
                    </tr>
                </thead>
                <tbody>
                    {error_rows}
                </tbody>
            </table>
        </div>
        """

    empty_row = """
    <tr>
        <td colspan="5" style="padding: 25px 10px; text-align: center; color: #4b5563; background-color: #f9fafb;">
            <strong style="font-size: 14px;">No new regulatory updates detected today.</strong><br>
            <span style="font-size: 12px; color: #6b7280; display: inline-block; margin-top: 4px;">All 14 monitored channels were scanned and verified successfully.</span>
        </td>
    </tr>
    """

    html_content = f"""
    <!DOCTYPE html>
    <html lang="ko">
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
                max-width: 800px;
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
            .notice-badge {{
                display: inline-block;
                background-color: rgba(22, 163, 74, 0.08);
                color: #16a34a;
                padding: 3px 8px;
                border-radius: 4px;
                font-weight: 600;
                font-size: 11px;
                border: 1px solid #bbf7d0;
                margin-top: 4px;
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
                min-width: 520px;
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
            <h2>Regulatory Daily Intelligence Report</h2>
            <div class="meta">
                <strong>Execution Time:</strong> {execution_time_display} | <strong>New Updates:</strong> {len(new_items)} 건<br>
                <span class="notice-badge">&bull; Scan Scope: Up to top recent entries scanned per channel</span>
            </div>

            <h3 style="color: #111827; margin-bottom: 8px; font-size: 15px;">
                Newly Registered Regulatory Updates
            </h3>

            <div class="table-wrapper">
                <table class="data-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background-color: #16a34a;">
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 35px; border-bottom: 1px solid #16a34a;">No</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 125px; border-bottom: 1px solid #16a34a;">Source</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 85px; border-bottom: 1px solid #16a34a;">Date</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; border-bottom: 1px solid #16a34a;">Title / Summary</th>
                            <th style="padding: 10px 8px; color: #ffffff; text-align: center; font-size: 13px; font-weight: 600; width: 60px; border-bottom: 1px solid #16a34a;">Link</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows_html if new_items else empty_row}
                    </tbody>
                </table>
            </div>

            {errors_section}

            <div style="margin-top: 25px; text-align: center;">
                <a href="https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit" target="_blank" class="btn-db">
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
    <html lang="ko">
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
                파이프라인 실행 중 예기치 않은 치명적 오류(인증 실패, Google API 장애, 시스템 프로세스 오류 등)로 스크립트가 중단되었습니다. 하단 Stack Trace 로그를 확인하십시오.
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
    print(">> Connecting to Google Sheets...")
    sheet = init_google_sheet()
    existing_keys = get_existing_keys(sheet)
    print(f">> Existing registered keys count: {len(existing_keys)}")

    ordered_results = {
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
                ordered_results["IMDS News"] = items
                print(f"[1/14] IMDS News: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS News", "error": str(e)})

            # [3] IMDS News (Services)
            try:
                items = scrape_imds_services_news(page)
                ordered_results["IMDS News (Services)"] = items
                print(f"[2/14] IMDS Services: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS News (Services)", "error": str(e)})

            # [4] IMDS Release Notes(Next)
            try:
                items = scrape_imds_release_notes(page)
                ordered_results["IMDS Release Notes(Next)"] = items
                print(f"[3/14] IMDS Release: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "IMDS Release Notes(Next)", "error": str(e)})

            # [10 & 11] iPoint (News & Blog)
            try:
                news_items, blog_items = scrape_ipoint_channels(page)
                ordered_results["iPoint (News)"] = news_items
                ordered_results["iPoint (Blog)"] = blog_items
                print(f"[4/14] iPoint (News): Scanned {len(news_items)} item(s)")
                print(f"[5/14] iPoint (Blog): Scanned {len(blog_items)} item(s)")
            except Exception as e:
                errors.append({"channel": "iPoint (News & Blog)", "error": str(e)})

            # [12] ECHA News
            try:
                items = scrape_echa(page)
                ordered_results["ECHA News"] = items
                print(f"[6/14] ECHA News: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "ECHA News", "error": str(e)})

            # [14] 국가법령정보센터
            try:
                items = scrape_law_center(page)
                ordered_results["국가법령정보센터"] = items
                print(f"[7/14] 국가법령정보센터: Scanned {len(items)} item(s)")
            except Exception as e:
                errors.append({"channel": "국가법령정보센터", "error": str(e)})

        finally:
            page.close()
            browser.close()

    # 2. Execute Requests Scrapers
    # [1] RMI News
    try:
        items = scrape_rmi()
        ordered_results["RMI News"] = items
        print(f"[8/14] RMI News: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "RMI News", "error": str(e)})

    # [5] IMDS Professional Blog
    try:
        items = scrape_imds_pro()
        ordered_results["IMDS Professional Blog"] = items
        print(f"[9/14] IMDS Pro: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "IMDS Professional Blog", "error": str(e)})

    # [6] Assent Content Hub
    try:
        items = scrape_assent()
        ordered_results["Assent Content Hub"] = items
        print(f"[10/14] Assent: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "Assent Content Hub", "error": str(e)})

    # [7] CDX News
    try:
        items = scrape_cdx()
        ordered_results["CDX News"] = items
        print(f"[11/14] CDX News: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX News", "error": str(e)})

    # [8] CDX Updates
    try:
        items = scrape_cdx_updates()
        ordered_results["CDX Updates"] = items
        print(f"[12/14] CDX Updates: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX Updates", "error": str(e)})

    # [9] CDX Events
    try:
        items = scrape_cdx_events()
        ordered_results["CDX Events"] = items
        print(f"[13/14] CDX Events: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "CDX Events", "error": str(e)})

    # [13] COMPASS
    try:
        items = scrape_compass()
        ordered_results["COMPASS"] = items
        print(f"[14/14] COMPASS: Scanned {len(items)} item(s)")
    except Exception as e:
        errors.append({"channel": "COMPASS", "error": str(e)})

    # 3. Process Sheet Entries in User-Specified Order
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
        "국가법령정보센터",
    ]

    now_kst_str = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M:%S")
    new_items_to_report = []
    rows_to_append = []

    print("\n>> Processing sheet entries in defined order...")
    for channel_name in desired_order:
        items = ordered_results.get(channel_name, [])
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
                new_items_to_report.append(item)
                print(f">> [NEW APPENDED] {item['channel']}: {item['title'][:35]}...")
            else:
                continue

    # 신규 항목 일괄 추가 (Batch Insert)
    if rows_to_append:
        sheet.append_rows(rows_to_append)
        print(f">> Successfully appended {len(rows_to_append)} rows to Google Sheets.")
    else:
        print(">> No new rows to append.")

    # 4. Send HTML Table Email
    send_email_report(new_items_to_report, errors)
    print(">> Monitoring process completed successfully.")


if __name__ == "__main__":
    try:
        main()
    except Exception as unhandled_error:
        error_trace = traceback.format_exc()
        print(f"\n!! [FATAL UNHANDLED EXCEPTION DETECTED]\n{error_trace}")
        send_critical_crash_alert(error_trace)
        sys.exit(1)
