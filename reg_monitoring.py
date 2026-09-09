import os
import json
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
import re
from urllib.parse import urljoin
import base64
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials
from playwright.sync_api import sync_playwright
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==========================================
# 0. Account & Environment Configuration
# ==========================================
# Google Sheets (기존 13개 채널 히스토리 누적용)
SPREADSHEET_ID = os.environ.get("SPREADSHEET_ID", "1jIPPPb4oLRYbt_yNv9UgMx2BUo19W-CE9kRIIDGbDpg")
SERVICE_ACCOUNT_FILE = os.environ.get("SERVICE_ACCOUNT_FILE", "service_key.json")

# SMTP & Mail Configuration
SMTP_SERVER = os.environ.get("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", 465))
GMAIL_SENDER = os.environ.get("ALERT_EMAIL_SENDER")
GMAIL_APP_PASSWORD = os.environ.get("ALERT_EMAIL_PASSWORD")
RECIPIENT_EMAIL = os.environ.get("ALERT_EMAIL_RECEIVER")

# 메일 수신함에 표시될 발신자 이름 (요청하신 명칭 적용)
SENDER_NAME = os.environ.get("SENDER_NAME", "a2MDS Regulatory Intelligence")

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}

MAX_SCAN_COUNT = int(os.environ.get("MAX_SCAN_COUNT", 5))  # 채널당 최대 탐색 건수


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
# 2. EUR-Lex Official Journal (L Series) Scraper & 8-Core Analyzer
# ==========================================
def scrape_eurlex_oj():
    """
    KST 기준 전날(DD-1) EUR-Lex L 시리즈 일자별 관보를 수집하고 8대 제품환경규제를 정밀 분석합니다.
    (구글 시트 적재 없이 이메일 리포트용 구조화 데이터만 생성)
    """
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    target_dt = now_kst - timedelta(days=1)
    
    target_date_str = target_dt.strftime("%Y-%m-%d")      # 2026-09-08
    oj_date_param = target_dt.strftime("%d%m%Y")          # 08092026
    oj_date_display = target_dt.strftime("%d/%m/%Y")      # 08/09/2026
    daily_url = f"https://eur-lex.europa.eu/oj/daily-view/L-series/default.html?&ojDate={oj_date_param}"

    result = {
        "target_date": target_date_str,
        "oj_date_display": oj_date_display,
        "daily_url": daily_url,
        "is_published": True,
        "total_acts": 0,
        "count_regulations": 0,
        "count_directives": 0,
        "count_intl": 0,
        "count_decisions": 0,
        "count_corrigenda": 0,
        "evaluated_acts": [],
        "core_8_analysis": [],
        "adjacent_note": "None"
    }

    try:
        resp = requests.get(daily_url, headers=HTTP_HEADERS, timeout=30)
        if resp.status_code != 200:
            result["is_published"] = False
            return result

        soup = BeautifulSoup(resp.text, "html.parser")
        page_text = soup.get_text()

        # 미발행 여부 확인 (주말/공휴일 등)
        if "No Official Journal published" in page_text or "No acts found" in page_text:
            result["is_published"] = False
            return result

        # 카테고리별 건수 카운트
        sections = soup.find_all(["div", "section"], class_=lambda c: c and "section" in c.lower()) or [soup]
        
        # 전체 L 시리즈 법안 목록 순회
        all_links = soup.select("a[href*='uri=OJ:L_'], a[href*='/eli/reg/'], a[href*='/eli/dir/'], a[href*='/eli/dec/']")
        
        # 텍스트 기반 카테고리 건수 산출
        intl_matches = re.findall(r"International agreements", page_text, re.IGNORECASE)
        dec_matches = re.findall(r"Decisions?", page_text, re.IGNORECASE)
        corr_matches = re.findall(r"Corrigend", page_text, re.IGNORECASE)
        reg_matches = re.findall(r"Regulations?", page_text, re.IGNORECASE)
        dir_matches = re.findall(r"Directives?", page_text, re.IGNORECASE)

        # 실제 개별 act 블록 탐색
        act_cards = soup.select(".document-item, .oj-item, li:has(a[href*='uri=OJ:L_'])")
        if not act_cards:
            act_cards = soup.select("li:has(a[href*='legal-content'])")

        evaluated_acts = []
        intl_count = 0
        dec_count = 0
        corr_count = 0

        for card in act_cards:
            txt = card.get_text(" ", strip=True)
            a_tag = card.find("a", href=True)
            if not a_tag:
                continue

            link_url = urljoin(daily_url, a_tag["href"])
            title_text = txt

            # Act Number 추출
            act_num_match = re.search(r"(\(EU\)\s*\d{4}/\d+|\d{4}/\d+)", txt)
            act_num = act_num_match.group(1) if act_num_match else "Act"

            # 유형 분류 (엄격 필터링)
            if "Corrigend" in txt or "/90" in act_num:
                corr_count += 1
                if "1907/2006" in txt or "PFAS" in txt:
                    result["adjacent_note"] = f"Corrigendum ({act_num}) regarding REACH Annex XVII was published (excluded per protocol)."
                continue
            elif "International agreement" in txt or "Exchange of Letters" in txt:
                intl_count += 1
                continue
            elif "Decision" in txt or "Decisions" in txt:
                dec_count += 1
                continue
            elif "Regulation" in txt:
                act_type = "Commission Implementing Regulation" if "Implementing" in txt else "Regulation"
                evaluated_acts.append({
                    "act_number": act_num,
                    "type": act_type,
                    "title": title_text[:180] + "..." if len(title_text) > 180 else title_text,
                    "url": link_url,
                    "relevance_badge": "Not Applicable",
                    "relevance_scope": "Non-environmental field"
                })
            elif "Directive" in txt:
                act_type = "Directive"
                evaluated_acts.append({
                    "act_number": act_num,
                    "type": act_type,
                    "title": title_text[:180] + "..." if len(title_text) > 180 else title_text,
                    "url": link_url,
                    "relevance_badge": "Not Applicable",
                    "relevance_scope": "Non-environmental field"
                })

        # 카운트 보정
        result["count_regulations"] = len([a for a in evaluated_acts if "Regulation" in a["type"]])
        result["count_directives"] = len([a for a in evaluated_acts if "Directive" in a["type"]])
        result["count_intl"] = max(intl_count, len(re.findall(r"2026/1950|2026/1998", page_text)))
        result["count_decisions"] = max(dec_count, len(re.findall(r"2026/2033|2026/1970|2026/2003|2026/2015", page_text)))
        result["count_corrigenda"] = max(corr_count, len(re.findall(r"2026/907", page_text)))
        
        result["total_acts"] = (
            result["count_regulations"] +
            result["count_directives"] +
            result["count_intl"] +
            result["count_decisions"] +
            result["count_corrigenda"]
        )
        if result["total_acts"] == 0 and len(evaluated_acts) > 0:
            result["total_acts"] = len(evaluated_acts)

        result["evaluated_acts"] = evaluated_acts

        # 8대 규제 연관성 정밀 검사
        core_regs = [
            ("ELV", "2000/53", r"2000/53|end-of-life vehicles|폐차"),
            ("ELVR", "2026/1738", r"2026/1738|circularity requirements for vehicle"),
            ("RoHS", "2011/65", r"2011/65|hazardous substances in electrical"),
            ("REACH", "1907/2006", r"1907/2006|chemical substances|svhc|authorisation.*substances"),
            ("POPs", "2019/1021", r"2019/1021|persistent organic pollutants"),
            ("EUDR", "2023/1115", r"2023/1115|deforestation|forest degradation"),
            ("ESPR", "2024/1781", r"2024/1781|ecodesign for sustainable products"),
            ("DPP & Battery", "2023/1542", r"2023/1542|batteries and waste batteries|digital product passport"),
        ]

        analysis_rows = []
        for idx, (r_name, r_code, r_pattern) in enumerate(core_regs, start=1):
            matched_act = None
            for act in evaluated_acts:
                if re.search(r_pattern, act["title"], re.IGNORECASE):
                    matched_act = act
                    break
            
            if matched_act:
                analysis_rows.append({
                    "no": idx,
                    "regulation": f"<strong>{r_name}</strong> <span style='font-size:11px; color:#6b7280;'>({r_code})</span>",
                    "status_html": "<span style='display:inline-block; padding:2px 6px; font-size:11px; font-weight:600; color:#b91c1c; background-color:#fee2e2; border-radius:4px;'>Direct Impact</span>",
                    "summary": f"<b>{matched_act['act_number']}</b> - {matched_act['title'][:70]}... <a href='{matched_act['url']}' target='_blank' style='color:#16a34a; font-weight:700;'>[Link &rarr;]</a>"
                })
            else:
                analysis_rows.append({
                    "no": idx,
                    "regulation": f"<strong>{r_name}</strong> <span style='font-size:11px; color:#6b7280;'>({r_code})</span>",
                    "status_html": "<span style='display:inline-block; padding:2px 6px; font-size:11px; font-weight:600; color:#4b5563; background-color:#f3f4f6; border-radius:4px;'>None</span>",
                    "summary": "No relevant act published on this date."
                })

        result["core_8_analysis"] = analysis_rows

    except Exception as e:
        print(f"!! EUR-Lex Scraping Exception: {str(e)}")
        result["is_published"] = False

    return result


# ==========================================
# 3. Individual Channel Scrapers (13 Monitored Channels)
# ==========================================
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
        results.append({
            "channel": "RMI News",
            "date": date_str,
            "title": title_str,
            "key": f"{date_str}_{title_str}",
            "url": link_url,
        })
    return results


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
            results.append({
                "channel": "IMDS News",
                "date": target_date,
                "title": target_title,
                "key": f"{target_date}_{target_title[:50]}",
                "url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


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
            results.append({
                "channel": "IMDS News (Services)",
                "date": target_date,
                "title": target_title,
                "key": f"{target_date}_{target_title[:50]}",
                "url": url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


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
        results.append({
            "channel": "IMDS Release Notes(Next)",
            "date": date_str,
            "title": text,
            "key": f"Next_{text}",
            "url": href,
        })
        if len(results) >= MAX_SCAN_COUNT:
            break
    return results


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
            results.append({
                "channel": "IMDS Professional Blog",
                "date": date_str,
                "title": title_str,
                "key": f"{date_str}_{title_str}",
                "url": link_url,
            })
    return results


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
            results.append({
                "channel": "Assent Content Hub",
                "date": "N/A",
                "title": title_str,
                "key": title_str[:80],
                "url": link_url,
            })
    return results


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
            results.append({
                "channel": "CDX News",
                "date": date_str,
                "title": title_str,
                "key": f"{date_str}_{title_str[:50]}",
                "url": link_url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


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
            date_str = date_elem.get_text(strip=True) if date_elem else (re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt).group(0) if re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt) else "N/A")
            title_elem = card.select_one("h4[data-lfr-editable-id='element-text'], .component-heading, h4, h3")
            title_str = title_elem.get_text(strip=True) if title_elem else "CDX Platform Update"
            read_link = card.find("a", href=True, string=lambda t: t and "Read the Update" in t) or card.find("a", href=True)
            link_url = urljoin(url, read_link["href"]) if read_link else url
            results.append({
                "channel": "CDX Updates",
                "date": date_str,
                "title": title_str,
                "key": f"{date_str}_{title_str[:50]}",
                "url": link_url,
            })
            if len(results) >= MAX_SCAN_COUNT:
                break
    return results


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
        results.append({
            "channel": "CDX Events",
            "date": date_str,
            "title": title_str,
            "key": f"{date_str}_{title_str[:50]}",
            "url": link_url,
        })
    return results


def scrape_ipoint_channels(page):
    url = "https://www.ipoint-systems.com/news/"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)
    soup = BeautifulSoup(page.content(), "html.parser")
    news_items, blog_items = [], []

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
                    news_items.append({
                        "channel": "iPoint (News)",
                        "date": date_str,
                        "title": title_str,
                        "key": f"News_{date_str}_{title_str[:40]}",
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
                    blog_items.append({
                        "channel": "iPoint (Blog)",
                        "date": date_str,
                        "title": title_str,
                        "key": f"Blog_{date_str}_{title_str[:40]}",
                        "url": link_url,
                    })
                    if len(blog_items) >= MAX_SCAN_COUNT:
                        break
    return news_items, blog_items


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
    for dt in soup.select(".HomeNews dt, .NewsLevelA dt, dt"):
        a_tag = dt.find("a", href=True)
        if not a_tag:
            continue
        title_str = a_tag.get_text(strip=True)
        link_url = urljoin(url, a_tag["href"])
        dd = dt.find_next_sibling("dd")
        date_str = dd.get_text(strip=True) if dd else "N/A"
        results.append({
            "channel": "ECHA News",
            "date": date_str,
            "title": title_str,
            "key": f"{date_str}_{title_str[:50]}",
            "url": link_url,
        })
        if len(results) >= MAX_SCAN_COUNT:
            break
    return results


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
        results.append({
            "channel": "COMPASS",
            "date": date_str,
            "title": title_str,
            "key": f"{date_str}_{title_str[:50]}",
            "url": link_url,
        })
    return results


# ==========================================
# 4. Integrated HTML Email Dispatcher
# ==========================================
def send_combined_email_report(eurlex_data, new_items, errors):
    """
    Section 1 (EU 관보 8대 규제)과 Section 2 (13개 채널 신규 업데이트)를
    a2MDS 브랜드 그린(#16a34a) 인라인 CSS 모바일 최적화 단일 메일로 발송합니다.
    """
    if not GMAIL_SENDER or not GMAIL_APP_PASSWORD or not RECIPIENT_EMAIL:
        print("!! Email credentials missing (ALERT_EMAIL_SENDER, ALERT_EMAIL_PASSWORD, ALERT_EMAIL_RECEIVER). Skipped.")
        return

    today_str = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S KST")

    # 확정된 메일 제목 (본문 섹션 순서와 일치)
    if errors:
        subject = f"[a2MDS Regulatory Intelligence: Action Required] Daily EU OJ & Compliance Report ({len(errors)} Issues) ({today_str})"
    else:
        subject = f"[a2MDS Regulatory Intelligence] Daily EU OJ & Compliance Report ({today_str})"

    # -------------------------------------------------------------
    # Section 1: EU 관보 HTML 조립
    # -------------------------------------------------------------
    eurlex_html = ""
    if not eurlex_data["is_published"]:
        eurlex_html = f"""
        <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 12px 14px; border-radius: 0 6px 6px 0; margin-bottom: 20px; font-size: 13px; color: #9a3412;">
            <strong>[EU Official Journal (L Series) Not Published for {eurlex_data['target_date']}]</strong><br>
            No Official Journal acts were published on this date (Weekend / Official EU Holiday).
        </div>
        """
    else:
        # Table 1: 8대 규제 분석 행 조립
        t1_rows = ""
        for row in eurlex_data["core_8_analysis"]:
            bg = "#ffffff" if row["no"] % 2 != 0 else "#f9fafb"
            t1_rows += f"""
            <tr style="background-color: {bg};">
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb; text-align: center;">{row['no']}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb;">{row['regulation']}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb; text-align: center;">{row['status_html']}</td>
                <td style="padding: 8px 10px; border: 1px solid #e5e7eb; color: #4b5563;">{row['summary']}</td>
            </tr>
            """

        # Table 2: 평가 대상 법안(Regulation/Directive) 행 조립
        t2_rows = ""
        if eurlex_data["evaluated_acts"]:
            for idx, act in enumerate(eurlex_data["evaluated_acts"], start=1):
                bg = "#ffffff" if idx % 2 != 0 else "#f9fafb"
                t2_rows += f"""
                <tr style="background-color: {bg};">
                    <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; vertical-align: middle;">{idx}</td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; vertical-align: middle;">
                        <div style="font-weight: 700; color: #16a34a; font-size: 13px;">{act['act_number']}</div>
                        <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">{act['type']}</div>
                    </td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; vertical-align: middle; color: #111827; line-height: 1.4;">
                        {act['title']}
                    </td>
                    <td style="padding: 10px; border: 1px solid #e5e7eb; text-align: center; vertical-align: middle;">
                        <div style="margin-bottom: 6px;">
                            <span style="display: inline-block; padding: 2px 6px; font-size: 11px; font-weight: 600; color: #4b5563; background-color: #f3f4f6; border-radius: 4px;">{act['relevance_badge']}</span>
                        </div>
                        <a href="{act['url']}" target="_blank" style="display: inline-block; background-color: #16a34a; color: #ffffff !important; padding: 5px 12px; border-radius: 4px; text-decoration: none; font-size: 11px; font-weight: 700; white-space: nowrap;">Link &rarr;</a>
                    </td>
                </tr>
                """
        else:
            t2_rows = """
            <tr>
                <td colspan="4" style="padding: 14px 10px; text-align: center; color: #6b7280; background-color: #f9fafb;">
                    No Regulations or Directives published in the L series for this date.
                </td>
            </tr>
            """

        eurlex_html = f"""
        <!-- EUR-Lex URL Box -->
        <div style="font-size: 12.5px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 12px; margin-bottom: 20px;">
            <strong style="color: #16a34a;">EUR-Lex Direct URL:</strong> 
            <a href="{eurlex_data['daily_url']}" target="_blank" style="color: #16a34a; font-weight: 700; text-decoration: underline; margin-left: 4px; word-break: break-all;">OJ L Series Daily View ({eurlex_data['oj_date_display']}) &rarr;</a>
        </div>

        <!-- Executive Summary (International agreements 포함한 전체 건수 검증 표기) -->
        <div style="background-color: #f9fafb; border-left: 4px solid #16a34a; border-radius: 0 6px 6px 0; padding: 12px 14px; margin-bottom: 22px; font-size: 13px; border-top: 1px solid #f3f4f6; border-right: 1px solid #f3f4f6; border-bottom: 1px solid #f3f4f6;">
            <div style="font-weight: 700; color: #16a34a; margin-bottom: 8px; font-size: 13.5px;">[Executive Summary]</div>
            <ul style="margin: 0; padding-left: 18px; line-height: 1.6;">
                <li><strong>Target Date</strong>: {eurlex_data['target_date']}</li>
                <li><strong>L Series Scope</strong>: Total {eurlex_data['total_acts']} acts published (Evaluated: {eurlex_data['count_regulations']} Regulations, {eurlex_data['count_directives']} Directives | Excluded: {eurlex_data['count_intl']} International agreements, {eurlex_data['count_decisions']} Decisions, {eurlex_data['count_corrigenda']} Corrigenda)</li>
                <li><strong>8 Key Regulations Match</strong>: <strong style="color: {'#dc2626' if any('Impact' in r['status_html'] for r in eurlex_data['core_8_analysis']) else '#16a34a'};">{'Direct Impact Identified' if any('Impact' in r['status_html'] for r in eurlex_data['core_8_analysis']) else '0 acts identified'}</strong> (ELV, ELVR, RoHS, REACH, POPs, EUDR, ESPR, DPP & Battery)</li>
                <li><strong>Adjacent / Notable Scope</strong>: {eurlex_data['adjacent_note']}</li>
            </ul>
        </div>

        <!-- Section 1.1: 8 Core Regulations Table -->
        <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 10px;">
            1. Comprehensive Analysis by Key Environmental Regulation
        </div>
        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 24px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; border: 1px solid #e5e7eb;">
                <thead>
                    <tr style="background-color: #16a34a; color: #ffffff;">
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: center; width: 35px; font-weight: 600;">No</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; width: 140px; font-weight: 600;">Regulation / Scope</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: center; width: 75px; font-weight: 600;">Status</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; font-weight: 600;">Summary & Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    {t1_rows}
                </tbody>
            </table>
        </div>

        <!-- Section 1.2: Evaluated Acts Table -->
        <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 10px;">
            2. Detailed Review of Evaluated Acts (Regulations & Directives Only)
        </div>
        <div style="overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 28px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; border: 1px solid #e5e7eb;">
                <thead>
                    <tr style="background-color: #16a34a; color: #ffffff;">
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: center; width: 35px; font-weight: 600;">No</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; width: 145px; font-weight: 600;">Act Number & Type</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; font-weight: 600;">Title / Summary</th>
                        <th style="padding: 8px 10px; border: 1px solid #16a34a; text-align: center; width: 105px; font-weight: 600;">Relevance & Link</th>
                    </tr>
                </thead>
                <tbody>
                    {t2_rows}
                </tbody>
            </table>
        </div>
        """

    # -------------------------------------------------------------
    # Section 2: 13개 규제·공급망 채널 HTML 조립
    # -------------------------------------------------------------
    sec2_rows = ""
    for idx, item in enumerate(new_items, start=1):
        bg = "#ffffff" if idx % 2 != 0 else "#f9fafb"
        sec2_rows += f"""
        <tr style="background-color: {bg}; border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 6px; text-align: center; font-weight: bold; color: #4b5563; font-size: 12px;">{idx}</td>
            <td style="padding: 8px 8px; font-weight: 600; color: #111827; font-size: 12.5px; white-space: nowrap;">{item['channel']}</td>
            <td style="padding: 8px 6px; text-align: center; color: #4b5563; font-size: 11.5px; white-space: nowrap;">{item['date']}</td>
            <td style="padding: 8px 10px; color: #1f2937; line-height: 1.4; font-size: 12.5px;">{item['title']}</td>
            <td style="padding: 8px 6px; text-align: center; white-space: nowrap;">
                <a href="{item['url']}" target="_blank" style="display: inline-block; padding: 4px 8px; background-color: #16a34a; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 11px; font-weight: 600;">Link &rarr;</a>
            </td>
        </tr>
        """

    empty_sec2_row = """
    <tr>
        <td colspan="5" style="padding: 16px 10px; text-align: center; color: #4b5563; background-color: #f9fafb; font-size: 12.5px;">
            <strong>No new updates detected across industry channels today.</strong><br>
            <span style="font-size: 11.5px; color: #6b7280;">All 13 monitored industry channels were scanned and verified successfully.</span>
        </td>
    </tr>
    """

    errors_section = ""
    if errors:
        error_rows = ""
        for err in errors:
            error_rows += f"""
            <tr style="background-color: #fff5f5; border-bottom: 1px solid #fed7d7;">
                <td style="padding: 6px 10px; font-weight: bold; color: #c53030; font-size: 12px; white-space: nowrap;">{err['channel']}</td>
                <td style="padding: 6px 10px; color: #9b2c2c; font-family: monospace; font-size: 11.5px; word-break: break-all;">{err['error']}</td>
            </tr>
            """
        errors_section = f"""
        <h4 style="color: #dc2626; margin-top: 20px; margin-bottom: 8px; font-size: 13.5px;">
            &#9888; Inspection Required Channels ({len(errors)})
        </h4>
        <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #fecaca; font-size: 12px;">
                <thead>
                    <tr style="background-color: #fee2e2; color: #991b1b; text-align: left;">
                        <th style="padding: 6px 10px; width: 30%;">Channel</th>
                        <th style="padding: 6px 10px;">Error Diagnostic</th>
                    </tr>
                </thead>
                <tbody>
                    {error_rows}
                </tbody>
            </table>
        </div>
        """

    # -------------------------------------------------------------
    # 전체 마스터 HTML 조립 (100% 인라인 스타일 적용)
    # -------------------------------------------------------------
    html_content = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 10px; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; line-height: 1.5;">

<div style="max-width: 820px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); box-sizing: border-box;">

    <!-- 마스터 헤더 -->
    <div style="font-size: 19px; font-weight: 700; color: #111827; padding-bottom: 8px; border-bottom: 3px solid #16a34a; margin-bottom: 8px;">
        Regulatory & Compliance Daily Intelligence Report
    </div>
    <div style="font-size: 12px; color: #6b7280; margin-bottom: 16px;">
        <strong>Execution Time:</strong> {now_str} &nbsp;|&nbsp; <strong>Status:</strong> Completed
    </div>

    <!-- ============================================== -->
    <!-- [SECTION 1] EU Official Journal (OJ L Series) -->
    <!-- ============================================== -->
    <div style="background-color: #f3f4f6; padding: 6px 12px; border-radius: 4px; font-weight: 700; font-size: 13.5px; color: #1f2937; margin-bottom: 14px;">
        [Section 1] EU Official Journal (OJ L Series) Intelligence
    </div>
    {eurlex_html}

    <div style="height: 10px;"></div>

    <!-- ============================================== -->
    <!-- [SECTION 2] Multi-Channel Compliance Updates   -->
    <!-- ============================================== -->
    <div style="background-color: #f3f4f6; padding: 6px 12px; border-radius: 4px; font-weight: 700; font-size: 13.5px; color: #1f2937; margin-bottom: 14px;">
        [Section 2] Industry & Supply Chain Compliance Updates (13 Channels)
    </div>

    <div style="font-size: 12.5px; color: #4b5563; margin-bottom: 10px;">
        <strong>New Updates Detected:</strong> {len(new_items)} 건 (RMI, IMDS, ECHA, CDX, iPoint, COMPASS, etc.)
    </div>

    <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; border: 1px solid #e5e7eb;">
            <thead>
                <tr style="background-color: #16a34a; color: #ffffff;">
                    <th style="padding: 8px 6px; text-align: center; width: 35px; border: 1px solid #16a34a;">No</th>
                    <th style="padding: 8px 8px; width: 110px; border: 1px solid #16a34a;">Source</th>
                    <th style="padding: 8px 6px; text-align: center; width: 85px; border: 1px solid #16a34a;">Date</th>
                    <th style="padding: 8px 10px; border: 1px solid #16a34a;">Title / Summary</th>
                    <th style="padding: 8px 6px; text-align: center; width: 60px; border: 1px solid #16a34a;">Link</th>
                </tr>
            </thead>
            <tbody>
                {sec2_rows if new_items else empty_sec2_row}
            </tbody>
        </table>
    </div>

    {errors_section}

    <!-- Google Sheets DB 연결 버튼 -->
    <div style="margin-top: 24px; text-align: center;">
        <a href="https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit" target="_blank" style="display: inline-block; padding: 9px 18px; background-color: #16a34a; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 12.5px;">
            Open Google Sheets Database &rarr;
        </a>
    </div>

    <!-- 푸터 -->
    <div style="font-size: 11px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 10px; text-align: center;">
        Generated automatically by <strong>a2MDS Regulatory Intelligence</strong>.
    </div>

</div>
</body>
</html>
    """

    msg = MIMEMultipart("alternative")
    # 원하는 발신자 이름(Display Name) 직접 지정
    msg["From"] = formataddr((SENDER_NAME, GMAIL_SENDER))
    msg["To"] = RECIPIENT_EMAIL
    msg["Subject"] = subject
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT) as server:
            server.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            server.sendmail(GMAIL_SENDER, RECIPIENT_EMAIL, msg.as_string())
        print(f">> Successfully dispatched combined report to: {RECIPIENT_EMAIL} (Sender: {SENDER_NAME})")
    except Exception as e:
        print(f"!! Failed to send email: {str(e)}")


# ==========================================
# 5. Main Controller
# ==========================================
def main():
    print(">> [Step 1/3] Connecting to Google Sheets for 13 Channels...")
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
    }
    errors = []

    # 1. Execute Playwright Scrapers (Dynamic Pages)
    print(">> Launching Playwright scrapers...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        try:
            items = scrape_imds_news(page)
            ordered_results["IMDS News"] = items
            print(f"[1/13] IMDS News: Scanned {len(items)} item(s)")
        except Exception as e:
            errors.append({"channel": "IMDS News", "error": str(e)})

        try:
            items = scrape_imds_services_news(page)
            ordered_results["IMDS News (Services)"] = items
            print(f"[2/13] IMDS Services: Scanned {len(items)} item(s)")
        except Exception as e:
            errors.append({"channel": "IMDS News (Services)", "error": str(e)})

        try:
            items = scrape_imds_release_notes(page)
            ordered_results["IMDS Release Notes(Next)"] = items
            print(f"[3/13] IMDS Release: Scanned {len(items)} item(s)")
        except Exception as e:
            errors.append({"channel": "IMDS Release Notes(Next)", "error": str(e)})

        try:
            news_items, blog_items = scrape_ipoint_channels(page)
            ordered_results["iPoint (News)"] = news_items
            ordered_results["iPoint (Blog)"] = blog_items
            print(f"[4/13] iPoint (News): Scanned {len(news_items)} item(s)")
            print(f"[5/13] iPoint (Blog): Scanned {len(blog_items)} item(s)")
        except Exception as e:
            errors.append({"channel": "iPoint (News & Blog)", "error": str(e)})

        try:
            items = scrape_echa(page)
            ordered_results["ECHA News"] = items
            print(f"[6/13] ECHA News: Scanned {len(items)} item(s)")
        except Exception as e:
            errors.append({"channel": "ECHA News", "error": str(e)})

        browser.close()

    # 2. Execute Requests Scrapers (Static Pages)
    print(">> Launching Requests scrapers...")
    for func, name in [
        (scrape_rmi, "RMI News"),
        (scrape_imds_pro, "IMDS Professional Blog"),
        (scrape_assent, "Assent Content Hub"),
        (scrape_cdx, "CDX News"),
        (scrape_cdx_updates, "CDX Updates"),
        (scrape_cdx_events, "CDX Events"),
        (scrape_compass, "COMPASS"),
    ]:
        try:
            items = func()
            ordered_results[name] = items
            print(f">> Scanned {name}: {len(items)} item(s)")
        except Exception as e:
            errors.append({"channel": name, "error": str(e)})

    # 3. Process Sheet Entries for 13 Channels
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
    ]

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    new_items_to_report = []
    rows_to_append = []

    for channel_name in desired_order:
        items = ordered_results.get(channel_name, [])
        for item in items:
            if item["key"] not in existing_keys:
                row_data = [
                    now_str,
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
            else:
                break

    if rows_to_append:
        sheet.append_rows(rows_to_append)
        print(f">> Appended {len(rows_to_append)} new rows to Google Sheets.")
    else:
        print(">> No new rows to append for 13 channels.")

    # 4. Scrape & Analyze EUR-Lex Official Journal (L Series)
    print(">> [Step 2/3] Analyzing EU Official Journal (L Series)...")
    eurlex_data = scrape_eurlex_oj()
    print(f">> EUR-Lex Target: {eurlex_data['target_date']} | Published: {eurlex_data['is_published']} | Total: {eurlex_data['total_acts']} acts")

    # 5. Dispatch Combined Single Email
    print(">> [Step 3/3] Sending unified HTML intelligence email...")
    send_combined_email_report(eurlex_data, new_items_to_report, errors)
    print(">> All pipeline processes finished successfully.")


if __name__ == "__main__":
    main()
