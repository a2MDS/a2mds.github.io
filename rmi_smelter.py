import os
import smtplib
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# ==========================================
# 📧 계정 환경 변수 로드 (기존 설정 그대로 사용)
# ==========================================
EMAIL_SENDER = os.environ.get("ALERT_EMAIL_SENDER", "")
EMAIL_PASSWORD = os.environ.get("ALERT_EMAIL_PASSWORD", "")
EMAIL_RECEIVER = os.environ.get("ALERT_EMAIL_RECEIVER", "")
TARGET_SPREADSHEET_ID = os.environ.get("TARGET_SPREADSHEET_ID", "1u_fOmUwj1AdAif6sBVcWgMuR3vAcxGb6Bz1tY0Bz45Q")

def format_diff_badge(current_val: int, prev_val: int = None) -> str:
    if prev_val is None:
        return '<span style="color: #94a3b8;">-</span>'
    diff = current_val - prev_val
    if diff > 0:
        return f'<span style="color: #16a34a; font-weight: 600;">▲ +{diff:,}</span>'
    elif diff < 0:
        return f'<span style="color: #dc2626; font-weight: 600;">▼ {diff:,}</span>'
    return '<span style="color: #94a3b8;">-</span>'

def test_send():
    if not all([EMAIL_SENDER, EMAIL_PASSWORD, EMAIL_RECEIVER]):
        print("⚠️ 이메일 환경변수(ALERT_EMAIL_SENDER, ALERT_EMAIL_PASSWORD, ALERT_EMAIL_RECEIVER)가 설정되어 있지 않습니다.")
        return

    # 가상 테스트 데이터
    now_kst = datetime.now(timezone(timedelta(hours=9)))
    today_file_tag = now_kst.strftime("%Y%m%d")
    timestamp_full_str = now_kst.strftime("%Y-%m-%d %H:%M:%S") + " KST (UTC+9)"
    timestamp_log_str = now_kst.strftime("%Y-%m-%d %H:%M:%S KST")
    base_name = f"RMI Smelter Data Sync_{today_file_tag}"

    raw_counts = {"CMRT": 415, "EMRT": 280, "AMRT": 190, "Revision": 75, "Eligible": 310, "Public": 420}
    prev_raw = {"CMRT": 412, "EMRT": 280, "AMRT": 188, "Revision": 76, "Eligible": 310, "Public": 418}
    total_sources_sum = sum(raw_counts.values())
    prev_total_sources = sum(prev_raw.values())
    raw_ratios = {k: (v / total_sources_sum * 100) for k, v in raw_counts.items()}

    unique_counts = {"conformant": 380, "active": 45, "identified": 90, "removed": 25, "others": 10}
    prev_unique = {"conformant": 378, "active": 46, "identified": 88, "removed": 25, "others": 10}
    total_unique = sum(unique_counts.values())
    prev_total_unique = sum(prev_unique.values())
    unique_ratios = {k: (v / total_unique * 100) for k, v in unique_counts.items()}

    success_subject = f"[TEST] RMI Facility Daily Intelligence Report ({today_file_tag})"
    success_body = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>RMI Smelter &amp; Facility Daily Intelligence Report</title>
</head>
<body style="margin: 0; padding: 10px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; -webkit-text-size-adjust: 100%;">
    <div style="width: 100%; max-width: 800px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 16px; border: 1px solid #e5e7eb; box-sizing: border-box;">
        
        <!-- Header (reg_monitoring style) -->
        <h2 style="color: #111827; margin-top: 0; font-size: 18px; line-height: 1.3; border-bottom: 3px solid #16a34a; padding-bottom: 10px;">
            RMI Smelter &amp; Facility Daily Intelligence Report
        </h2>
        <div style="color: #4b5563; font-size: 12px; margin-bottom: 15px; line-height: 1.6;">
            <strong>Execution Time:</strong> {timestamp_full_str}<br>
            <span style="display: inline-block; background-color: rgba(22, 163, 74, 0.08); color: #16a34a; padding: 3px 8px; border-radius: 4px; font-weight: 600; font-size: 11px; border: 1px solid #bbf7d0; margin-top: 4px;">
                &bull; Scope: CMRT, EMRT, AMRT, Revisions, Eligible &amp; Public Facilities
            </span>
        </div>

        <!-- Table 1: Raw Ingestion with Diff -->
        <div style="margin-bottom: 22px;">
            <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 8px;">
                1. Original Source Counts (Raw File)
            </div>
            <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #16a34a; border-radius: 4px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 380px;">
                    <thead>
                        <tr style="background-color: #16a34a; color: #ffffff;">
                            <th style="padding: 8px 10px; font-weight: 600;">Source</th>
                            <th style="padding: 8px 10px; text-align: right; font-weight: 600; width: 70px; white-space: nowrap;">Count</th>
                            <th style="padding: 8px 10px; text-align: right; font-weight: 600; width: 60px; white-space: nowrap;">Ratio</th>
                            <th style="padding: 8px 10px; text-align: center; font-weight: 600; width: 80px; white-space: nowrap;">vs Prev Day</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">CMRT (3TG)</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['CMRT']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['CMRT']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['CMRT'], prev_raw.get('CMRT'))}</td>
                        </tr>
                        <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">EMRT (Cobalt / Mica)</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['EMRT']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['EMRT']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['EMRT'], prev_raw.get('EMRT'))}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">AMRT (Aluminum)</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['AMRT']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['AMRT']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['AMRT'], prev_raw.get('AMRT'))}</td>
                        </tr>
                        <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">Revision History</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Revision']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Revision']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Revision'], prev_raw.get('Revision'))}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">Eligible Facilities List</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Eligible']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Eligible']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Eligible'], prev_raw.get('Eligible'))}</td>
                        </tr>
                        <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px;">RMI Public Facilities List</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{raw_counts['Public']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{raw_ratios['Public']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(raw_counts['Public'], prev_raw.get('Public'))}</td>
                        </tr>
                        <tr style="background-color: #f0fdf4; font-weight: 700;">
                            <td style="padding: 8px 10px; border-top: 1px solid #bbf7d0; color: #166534;">Total Sources Sum</td>
                            <td style="padding: 8px 10px; border-top: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">{total_sources_sum:,}</td>
                            <td style="padding: 8px 10px; border-top: 1px solid #bbf7d0; text-align: right; color: #166534; white-space: nowrap;">100.0%</td>
                            <td style="padding: 8px 10px; border-top: 1px solid #bbf7d0; text-align: center; color: #166534; white-space: nowrap;">{format_diff_badge(total_sources_sum, prev_total_sources)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Table 2: Consolidated Master DB (Unique CID Base with Diff) -->
        <div style="margin-bottom: 22px;">
            <div style="font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 8px;">
                2. Consolidated Master Database (Unique CIDs)
            </div>
            <div style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; border: 1px solid #16a34a; border-radius: 4px;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left; min-width: 520px;">
                    <thead>
                        <tr style="background-color: #16a34a; color: #ffffff;">
                            <th style="padding: 8px 10px; font-weight: 600; white-space: nowrap;">RMAP Status</th>
                            <th style="padding: 8px 10px; text-align: right; font-weight: 600; width: 75px; white-space: nowrap;">Facilities</th>
                            <th style="padding: 8px 10px; text-align: right; font-weight: 600; width: 60px; white-space: nowrap;">Ratio</th>
                            <th style="padding: 8px 10px; text-align: center; font-weight: 600; width: 80px; white-space: nowrap;">vs Prev Day</th>
                            <th style="padding: 8px 10px; font-weight: 600;">Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px; font-weight: 600; color: #15803d; white-space: nowrap;">Conformant</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['conformant']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['conformant']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['conformant'], prev_unique.get('conformant'))}</td>
                            <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Fully conformant with RMAP standards</td>
                        </tr>
                        <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px; font-weight: 600; color: #1d4ed8; white-space: nowrap;">Active</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['active']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['active']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['active'], prev_unique.get('active'))}</td>
                            <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Participating in assessment program</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px; font-weight: 600; color: #4b5563; white-space: nowrap;">Identified</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['identified']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['identified']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['identified'], prev_unique.get('identified'))}</td>
                            <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">Listed operational (Non-assessed)</td>
                        </tr>
                        <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                            <td style="padding: 8px 10px; font-weight: 600; color: #b91c1c; white-space: nowrap;">Removed</td>
                            <td style="padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;">{unique_counts['removed']:,}</td>
                            <td style="padding: 8px 10px; text-align: right; color: #64748b; white-space: nowrap;">{unique_ratios['removed']:.1f}%</td>
                            <td style="padding: 8px 10px; text-align: center; white-space: nowrap;">{format_diff_badge(unique_counts['removed'], prev_unique.get('removed'))}</td>
                            <td style="padding: 8px 10px; font-size: 11px; color: #64748b;">De-listed / Inactive facilities</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e5e7eb;">
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

        <!-- Bullet Section: System & Cloud Synchronization -->
        <div style="background-color: #f8fafc; border-left: 4px solid #16a34a; padding: 12px 14px; border-radius: 0 6px 6px 0; margin-bottom: 20px;">
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">
            System &amp; Cloud Synchronization
            </div>
            <ul style="margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.5; color: #334155;">
                <li style="margin-bottom: 4px;">
                    <strong>Master File Archive:</strong> <code style="word-break: break-all;">{base_name}.xlsx</code> (Google Drive sync complete)
                </li>
                <li>
                    <strong>Live Sheet Database:</strong> Synced via Apps Script chunks &amp; timestamp refreshed.
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                        └ <em>Summary history logged to 'Summary History' tab A~O ({timestamp_log_str})</em>
                    </div>
                </li>
            </ul>
        </div>

        <!-- View Records Button Section -->
        <div style="margin-top: 25px; margin-bottom: 10px; text-align: center;">
            <a href="https://docs.google.com/spreadsheets/d/{TARGET_SPREADSHEET_ID}/edit" target="_blank" style="display: inline-block; padding: 10px 20px; background-color: #16a34a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">
                View Monitoring Records &rarr;
            </a>
        </div>
    </div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Daily RMI Smelter Harvest <{EMAIL_SENDER}>"
    msg["To"] = EMAIL_RECEIVER
    msg["Subject"] = success_subject
    msg.attach(MIMEText(success_body, "html", "utf-8"))

    try:
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(EMAIL_SENDER, EMAIL_PASSWORD)
        server.send_message(msg)
        server.quit()
        print(f"✅ 테스트 이메일 발송 완료: {EMAIL_RECEIVER}")
    except Exception as ex:
        print(f"❌ 발송 실패: {ex}")

if __name__ == "__main__":
    test_send()
