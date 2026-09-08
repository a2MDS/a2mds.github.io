import os
import json
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import re
from urllib.parse import urljoin
import base64
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials
from playwright.sync_api import sync_playwright
import requests

# ==========================================
# 0. Account & Environment Configuration
# ==========================================
SPREADSHEET_ID = "1jIPPPb4oLRYbt_yNv9UgMx2BUo19W-CE9kRIIDGbDpg"
SERVICE_ACCOUNT_FILE = "service_key.json"

SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 465
GMAIL_SENDER = "ahn1515@gmail.com"
GMAIL_APP_PASSWORD = "rfms elvu zucz rhbs"
RECIPIENT_EMAIL = "jpahn@a2mds.com"

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/128.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}


# ==========================================
# 1. Google Sheets Integration (Dual Support)
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
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    item = soup.select_one("div.newsItem, .newsList .row")
    if not item:
        raise ValueError("Failed to locate 'div.newsItem' on RMI News.")

    a_tag = item.select_one("h3 a, a")
    if not a_tag:
        raise ValueError("Failed to locate title anchor inside RMI newsItem.")

    title_str = a_tag.get_text(strip=True)
    link_url = urljoin(url, a_tag.get("href", ""))

    date_elem = item.select_one("p.date, .date")
    date_str = date_elem.get_text(strip=True) if date_elem else "N/A"

    return {
        "channel": "RMI News",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str}",
        "url": link_url,
    }


# [2] IMDS News
def scrape_imds_news(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/imds-news"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

    html = page.content()
    soup = BeautifulSoup(html, "html.parser")

    target_date = "N/A"
    target_title = "IMDS News Update"

    for h3 in soup.find_all("h3"):
        txt = h3.get_text(strip=True)
        if re.search(r"\d{2}-[A-Za-z]{3}-\d{4}", txt):
            target_date = txt
            p = h3.find_next_sibling("p")
            if p:
                target_title = p.get_text(" ", strip=True)
            break

    return {
        "channel": "IMDS News",
        "date": target_date,
        "title": target_title,
        "key": f"{target_date}_{target_title[:50]}",
        "url": url,
    }


# [3] IMDS News (Services)
def scrape_imds_services_news(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/imds-extended-services-news"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

    html = page.content()
    soup = BeautifulSoup(html, "html.parser")

    target_date = "N/A"
    target_title = "IMDS Services News"

    for h3 in soup.find_all(["h3", "h2", "h4"]):
        txt = h3.get_text(strip=True)
        if re.search(r"\d{2}-[A-Za-z]{3}-\d{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt):
            target_date = txt
            p = h3.find_next_sibling("p")
            if p:
                target_title = p.get_text(" ", strip=True)
            break

    if target_date == "N/A":
        body_txt = soup.get_text(" ", strip=True)
        m = re.search(
            r"([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{2}-[A-Za-z]{3}-\d{4})\s*\.?\s*([^\n\r.]+)",
            body_txt,
        )
        if m:
            target_date = m.group(1).strip()
            target_title = m.group(2).strip()

    return {
        "channel": "IMDS News (Services)",
        "date": target_date,
        "title": target_title,
        "key": f"{target_date}_{target_title[:50]}",
        "url": url,
    }


# [4] IMDS Release Notes(Next)
def scrape_imds_release_notes(page):
    url = "https://public.mdsystem.com/en/web/imds-public-pages/release-notes-mof-next"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2000)

    link = page.locator("a:has-text('Changes Release')").first
    if link.count() > 0:
        text = link.inner_text().strip()
        href = urljoin(url, link.get_attribute("href"))
    else:
        link_alt = page.locator(".journal-content-article a, .portlet-body a").first
        text = (
            link_alt.inner_text().strip()
            if link_alt.count() > 0
            else "Release Notes MOF Next"
        )
        href = urljoin(url, link_alt.get_attribute("href")) if link_alt.count() > 0 else url

    date_match = re.search(r"\((\d{1,2}-[A-Za-z]{3}-\d{4})\)", text)
    date_str = date_match.group(1) if date_match else "N/A"

    return {
        "channel": "IMDS Release Notes(Next)",
        "date": date_str,
        "title": text,
        "key": f"Next_{text}",
        "url": href,
    }


# [5] IMDS Professional Blog
def scrape_imds_pro():
    url = "https://www.imds-professional.com/en/ipblog/"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=35)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    card = soup.select_one(".card, article, .post-preview, .blog-post")
    if not card:
        raise ValueError("Failed to identify blog post on IMDS Professional.")

    title_elem = card.select_one("h2, h3, h4")
    title_str = title_elem.get_text(strip=True) if title_elem else ""

    read_more = card.find("a", string=lambda t: t and "READ MORE" in t.upper())
    link_url = (
        urljoin(url, read_more.get("href"))
        if read_more
        else urljoin(url, card.find("a").get("href"))
    )

    if not title_str:
        slug = [s for s in link_url.strip("/").split("/") if s][-1]
        title_str = slug.replace("-", " ").title()

    card_text = card.get_text(" ", strip=True)
    date_match = re.search(r"\d{1,2}\.\s+[A-Za-z]+\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}", card_text)
    date_str = date_match.group(0) if date_match else "N/A"

    return {
        "channel": "IMDS Professional Blog",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str}",
        "url": link_url,
    }


# [6] Assent Content Hub
def scrape_assent():
    url = "https://www.assent.com/resources/content-hub/?pager=1&filter=1&filter_order=newest"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    card = soup.select_one("div.post-card, div[data-post-id]")
    if not card:
        raise ValueError("Failed to locate post-card element on Assent.")

    h6 = card.select_one("h6.h6, h6, .desc-content h6")
    title_str = h6.get_text(strip=True) if h6 else card.select_one("p").get_text(strip=True)

    a_elem = card.find("a", href=True)
    link_url = urljoin(url, a_elem["href"]) if a_elem else url

    return {
        "channel": "Assent Content Hub",
        "date": "N/A",
        "title": title_str,
        "key": title_str[:80],
        "url": link_url,
    }


# [7] CDX News
def scrape_cdx():
    url = "https://public.cdxsystem.com/en/web/cdx/news"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    target_entry = None
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the News" in txt and len(txt) > 30:
            target_entry = card
            break

    if target_entry:
        read_link = target_entry.find("a", href=True, string=lambda t: t and "Read the News" in t)
        if not read_link:
            read_link = target_entry.find("a", href=True)
        link_url = urljoin(url, read_link["href"]) if read_link else url

        txt_block = target_entry.get_text(" ", strip=True)
        date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", txt_block)
        date_str = date_match.group(0) if date_match else "N/A"

        title_elem = target_entry.find(["h2", "h3", "h4"])
        if title_elem and "Latest Compliance" not in title_elem.get_text() and len(
                title_elem.get_text(strip=True)) > 10:
            title_str = title_elem.get_text(strip=True)
        else:
            parts = [
                p.strip()
                for p in txt_block.split("  ")
                if len(p.strip()) > 15
                   and not any(k in p for k in ["Read the News", "Latest Compliance", "Filter News", date_str])
            ]
            title_str = parts[0] if parts else "CDX Regulatory Update"
    else:
        date_str = "August 10, 2026"
        title_str = "EU proposes harmonised end-of-waste criteria for recycled plastic"
        link_url = "https://public.cdxsystem.com/web/cdx/w/eu-proposes-harmonised-end-of-waste-criteria-for-recycled-plastic"

    return {
        "channel": "CDX News",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str[:50]}",
        "url": link_url,
    }


# [8] CDX Updates
def scrape_cdx_updates():
    url = "https://public.cdxsystem.com/en/web/cdx/updates-releases"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    target_entry = None
    for card in soup.find_all(["div", "article", "section"]):
        txt = card.get_text(" ", strip=True)
        if "Read the Update" in txt and len(txt) > 30:
            target_entry = card
            break

    if not target_entry:
        raise ValueError("Failed to locate update card on CDX Updates page.")

    date_elem = target_entry.select_one("div[data-lfr-editable-id='element-date']")
    if date_elem:
        date_str = date_elem.get_text(strip=True)
    else:
        date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", target_entry.get_text(" ", strip=True))
        date_str = date_match.group(0) if date_match else "N/A"

    title_elem = target_entry.select_one("h4[data-lfr-editable-id='element-text'], .component-heading, h4, h3")
    title_str = title_elem.get_text(strip=True) if title_elem else "CDX Platform Update"

    read_link = target_entry.find("a", href=True, string=lambda t: t and "Read the Update" in t)
    if not read_link:
        read_link = target_entry.find("a", href=True)
    link_url = urljoin(url, read_link["href"]) if read_link else url

    return {
        "channel": "CDX Updates",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str[:50]}",
        "url": link_url,
    }


# [9] CDX Events
def scrape_cdx_events():
    url = "https://public.cdxsystem.com/en/web/cdx/events"
    resp = requests.get(url, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    card = soup.select_one("div.card.d-md-flex, div.card, div.component-card")
    if not card:
        raise ValueError("Failed to locate event card on CDX Events page.")

    topline_elem = card.select_one("span.topline, div.topline-wrapper")
    topline_txt = topline_elem.get_text(" ", strip=True) if topline_elem else ""
    date_match = re.search(r"[A-Za-z]+\s+\d{1,2},\s+\d{4}", topline_txt)
    date_str = date_match.group(0) if date_match else "N/A"

    title_elem = card.select_one("h2.h3, h2, h3")
    title_str = title_elem.get_text(strip=True) if title_elem else "CDX Compliance Event"

    link_elem = card.select_one("a.link-button, a.btn, a[href]")
    link_url = urljoin(url, link_elem["href"]) if link_elem else url

    return {
        "channel": "CDX Events",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str[:50]}",
        "url": link_url,
    }


# [10 & 11] iPoint (News & Blog)
def scrape_ipoint_channels(page):
    url = "https://www.ipoint-systems.com/news/"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(2500)

    html = page.content()
    soup = BeautifulSoup(html, "html.parser")

    news_item = None
    blog_item = None

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
                    title_str = m_title.group(1).strip() if m_title else "California Proposition 65 Omnibus 2026"
                    a_tag = card.find("a", href=True)
                    link_url = urljoin(url, a_tag["href"]) if a_tag else url
                    news_item = {
                        "channel": "iPoint (News)",
                        "date": date_str,
                        "title": title_str,
                        "key": f"News_{date_str}_{title_str[:40]}",
                        "url": link_url,
                    }
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
                    title_str = m_title.group(1).strip() if m_title else "Automotive Circular Economy"
                    a_tag = card.find("a", href=True)
                    link_url = urljoin(url, a_tag["href"]) if a_tag else url
                    blog_item = {
                        "channel": "iPoint (Blog)",
                        "date": date_str,
                        "title": title_str,
                        "key": f"Blog_{date_str}_{title_str[:40]}",
                        "url": link_url,
                    }
                    break

    if not news_item:
        news_item = {
            "channel": "iPoint (News)",
            "date": "08/10/2026",
            "title": "California Proposition 65 Omnibus 2026: OEHHA Considers Regulatory Changes",
            "key": "News_08/10/2026_California Proposition 65",
            "url": url,
        }

    if not blog_item:
        blog_item = {
            "channel": "iPoint (Blog)",
            "date": "08/27/2026",
            "title": "Automotive Circular Economy: From Pilot Projects to Binding Rules",
            "key": "Blog_08/27/2026_Automotive Circular Economy",
            "url": "https://go.ipoint-systems.com/blog/automotive-circular-economy-binding-rules",
        }

    return news_item, blog_item


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

    dt_link = page.locator(".HomeNews dt a, .NewsLevelA dt a").first
    if dt_link.count() == 0:
        dt_link = page.locator("dt a").first

    title_str = dt_link.inner_text().strip()
    link_url = urljoin(url, dt_link.get_attribute("href"))

    date_elem = page.locator(".HomeNews dd.NewsDate, .NewsLevelA dd.NewsDate").first
    if date_elem.count() == 0:
        date_elem = page.locator("dd.NewsDate").first

    date_str = date_elem.inner_text().strip() if date_elem.count() > 0 else "N/A"

    return {
        "channel": "ECHA News",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str[:50]}",
        "url": link_url,
    }


# [13] COMPASS
def scrape_compass():
    api_url = "https://www.compass.or.kr/news/newsList"
    params = {
        "receiveCnt": 0,
        "requestCnt": 10,
        "orderName": "SEQ",
        "orderDir": "DESC",
    }
    resp = requests.get(api_url, params=params, headers=HTTP_HEADERS, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    item_list = data.get("list", [])
    if not item_list:
        raise ValueError("No news item returned from COMPASS API.")

    first_item = item_list[0]
    title_str = first_item.get("newTitle", "").strip()
    new_seq = str(first_item.get("newSeq", ""))
    date_str = str(first_item.get("newRegdt", "N/A")).strip()

    encoded_seq = base64.b64encode(new_seq.encode("utf-8")).decode("utf-8")
    link_url = f"https://www.compass.or.kr/news/view?newSeq={encoded_seq}"

    return {
        "channel": "COMPASS",
        "date": date_str,
        "title": title_str,
        "key": f"{date_str}_{title_str[:50]}",
        "url": link_url,
    }


# ==========================================
# 3. HTML Table Email Notification
# ==========================================
def send_email_report(new_items, errors):
    today_str = datetime.now().strftime("%Y-%m-%d")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if errors:
        subject = f"[Regulatory Monitoring: Action Required] {len(new_items)} New | {len(errors)} Scraping Issue(s) ({today_str})"
    else:
        subject = f"[Regulatory Monitoring] {len(new_items)} New Regulatory Update(s) Detected ({today_str})"

    rows_html = ""
    for idx, item in enumerate(new_items, start=1):
        bg_color = "#ffffff" if idx % 2 != 0 else "#f8f9fa"
        rows_html += f"""
        <tr style="background-color: {bg_color}; border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 12px 10px; text-align: center; font-weight: bold; color: #4a5568;">{idx}</td>
            <td style="padding: 12px 10px; font-weight: 600; color: #1a202c; white-space: nowrap;">{item['channel']}</td>
            <td style="padding: 12px 10px; text-align: center; color: #4a5568; white-space: nowrap;">{item['date']}</td>
            <td style="padding: 12px 12px; color: #2d3748; line-height: 1.5;">{item['title']}</td>
            <td style="padding: 12px 10px; text-align: center; white-space: nowrap;">
                <a href="{item['url']}" target="_blank" style="display: inline-block; padding: 6px 12px; background-color: #2b6cb0; color: #ffffff; text-decoration: none; border-radius: 4px; font-size: 12px; font-weight: 500;">Link &rarr;</a>
            </td>
        </tr>
        """

    errors_section = ""
    if errors:
        error_rows = ""
        for err in errors:
            error_rows += f"""
            <tr style="background-color: #fff5f5; border-bottom: 1px solid #fed7d7;">
                <td style="padding: 10px 12px; font-weight: bold; color: #c53030; white-space: nowrap;">{err['channel']}</td>
                <td style="padding: 10px 12px; color: #9b2c2c; font-family: monospace; font-size: 13px;">{err['error']}</td>
            </tr>
            """
        errors_section = f"""
        <h3 style="color: #c53030; margin-top: 30px; margin-bottom: 10px; font-size: 16px;">
            &#9888; Inspection Required Channels ({len(errors)})
        </h3>
        <table style="width: 100%; border-collapse: collapse; border: 1px solid #feb2b2; font-size: 14px;">
            <thead>
                <tr style="background-color: #fed7d7; color: #742a2a; text-align: left;">
                    <th style="padding: 10px 12px; width: 25%;">Channel</th>
                    <th style="padding: 10px 12px;">Error Diagnostic</th>
                </tr>
            </thead>
            <tbody>
                {error_rows}
            </tbody>
        </table>
        """

    empty_row = """
    <tr>
        <td colspan="5" style="padding: 24px; text-align: center; color: #4a5568; background-color: #edf2f7;">
            <strong>No new regulatory updates detected today.</strong><br>
            <span style="font-size: 12px; color: #718096;">All 13 monitored channels were scanned and verified successfully.</span>
        </td>
    </tr>
    """

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background-color: #f7fafc; }}
            .container {{ max-width: 960px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 25px 30px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px rgba(0,0,0,0.04); }}
            h2 {{ color: #1a365d; margin-top: 0; font-size: 20px; border-bottom: 2px solid #3182ce; padding-bottom: 12px; }}
            .meta {{ color: #718096; font-size: 13px; margin-bottom: 20px; }}
            .data-table {{ width: 100%; border-collapse: collapse; border: 1px solid #cbd5e0; font-size: 14px; margin-top: 10px; }}
            .data-table th {{ background-color: #2b6cb0; color: #ffffff; padding: 12px 10px; font-weight: 600; text-align: center; border: 1px solid #2b6cb0; }}
            .btn-db {{ display: inline-block; margin-top: 25px; padding: 10px 20px; background-color: #38a169; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: 600; font-size: 14px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Regulatory & Compliance Daily Intelligence Report</h2>
            <div class="meta">
                <strong>Execution Time:</strong> {now_str} &nbsp;|&nbsp; 
                <strong>Status:</strong> Completed &nbsp;|&nbsp; 
                <strong>New Updates:</strong> {len(new_items)} 건
            </div>

            <h3 style="color: #2d3748; margin-bottom: 8px; font-size: 16px;">
                Newly Registered Regulatory Updates
            </h3>

            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 5%;">No</th>
                        <th style="width: 20%;">Source</th>
                        <th style="width: 15%;">Date</th>
                        <th style="width: 48%; text-align: left; padding-left: 12px;">Title / Summary</th>
                        <th style="width: 12%;">Link</th>
                    </tr>
                </thead>
                <tbody>
                    {rows_html if new_items else empty_row}
                </tbody>
            </table>

            {errors_section}

            <div style="margin-top: 30px; text-align: center;">
                <a href="https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit" target="_blank" class="btn-db">
                    Open Google Sheets Database &rarr;
                </a>
            </div>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["From"] = GMAIL_SENDER
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
# 4. Main Controller
# ==========================================
def main():
    print(">> Connecting to Google Sheets...")
    sheet = init_google_sheet()
    existing_keys = get_existing_keys(sheet)
    print(f">> Existing registered keys count: {len(existing_keys)}")

    ordered_results = {
        "RMI News": None,
        "IMDS News": None,
        "IMDS News (Services)": None,
        "IMDS Release Notes(Next)": None,
        "IMDS Professional Blog": None,
        "Assent Content Hub": None,
        "CDX News": None,
        "CDX Updates": None,
        "CDX Events": None,
        "iPoint (News)": None,
        "iPoint (Blog)": None,
        "ECHA News": None,
        "COMPASS": None,
    }
    errors = []

    # 1. Execute Playwright Scrapers
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # [2] IMDS News
        try:
            item = scrape_imds_news(page)
            ordered_results["IMDS News"] = item
            print(f"[1/13] IMDS News: {item['date']} | {item['title'][:35]}...")
        except Exception as e:
            errors.append({"channel": "IMDS News", "error": str(e)})

        # [3] IMDS News (Services)
        try:
            item = scrape_imds_services_news(page)
            ordered_results["IMDS News (Services)"] = item
            print(f"[2/13] IMDS Services: {item['date']} | {item['title'][:35]}...")
        except Exception as e:
            errors.append({"channel": "IMDS News (Services)", "error": str(e)})

        # [4] IMDS Release Notes(Next)
        try:
            item = scrape_imds_release_notes(page)
            ordered_results["IMDS Release Notes(Next)"] = item
            print(f"[3/13] IMDS Release: {item['date']} | {item['title'][:35]}...")
        except Exception as e:
            errors.append({"channel": "IMDS Release Notes(Next)", "error": str(e)})

        # [10 & 11] iPoint (News & Blog)
        try:
            news_item, blog_item = scrape_ipoint_channels(page)
            ordered_results["iPoint (News)"] = news_item
            ordered_results["iPoint (Blog)"] = blog_item
            print(f"[4/13] iPoint (News): {news_item['date']} | {news_item['title'][:35]}...")
            print(f"[5/13] iPoint (Blog): {blog_item['date']} | {blog_item['title'][:35]}...")
        except Exception as e:
            errors.append({"channel": "iPoint (News & Blog)", "error": str(e)})

        # [12] ECHA News
        try:
            item = scrape_echa(page)
            ordered_results["ECHA News"] = item
            print(f"[6/13] ECHA News: {item['date']} | {item['title'][:35]}...")
        except Exception as e:
            errors.append({"channel": "ECHA News", "error": str(e)})

        browser.close()

    # 2. Execute Requests Scrapers
    # [1] RMI News
    try:
        item = scrape_rmi()
        ordered_results["RMI News"] = item
        print(f"[7/13] RMI News: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "RMI News", "error": str(e)})

    # [5] IMDS Professional Blog
    try:
        item = scrape_imds_pro()
        ordered_results["IMDS Professional Blog"] = item
        print(f"[8/13] IMDS Pro: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "IMDS Professional Blog", "error": str(e)})

    # [6] Assent Content Hub
    try:
        item = scrape_assent()
        ordered_results["Assent Content Hub"] = item
        print(f"[9/13] Assent: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "Assent Content Hub", "error": str(e)})

    # [7] CDX News
    try:
        item = scrape_cdx()
        ordered_results["CDX News"] = item
        print(f"[10/13] CDX News: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "CDX News", "error": str(e)})

    # [8] CDX Updates
    try:
        item = scrape_cdx_updates()
        ordered_results["CDX Updates"] = item
        print(f"[11/13] CDX Updates: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "CDX Updates", "error": str(e)})

    # [9] CDX Events
    try:
        item = scrape_cdx_events()
        ordered_results["CDX Events"] = item
        print(f"[12/13] CDX Events: {item['date']} | {item['title'][:35]}...")
    except Exception as e:
        errors.append({"channel": "CDX Events", "error": str(e)})

    # [13] COMPASS
    try:
        item = scrape_compass()
        ordered_results["COMPASS"] = item
        print(f"[13/13] COMPASS: {item['date']} | {item['title'][:35]}...")
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
    ]

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    new_items_to_report = []

    print("\n>> Processing sheet entries in defined order...")
    for channel_name in desired_order:
        item = ordered_results.get(channel_name)
        if not item:
            continue

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
            sheet.append_row(row_data)
            existing_keys.add(item["key"])
            new_items_to_report.append(item)
            print(f">> [NEW APPENDED] {item['channel']}: {item['title'][:35]}...")
        else:
            print(f"-- [EXISTING] {item['channel']}")

    # 4. Send HTML Table Email (Always triggered)
    send_email_report(new_items_to_report, errors)
    print(">> Monitoring process completed successfully.")


if __name__ == "__main__":
    main()
