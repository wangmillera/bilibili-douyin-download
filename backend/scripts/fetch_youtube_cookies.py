from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

DEFAULT_URL = "https://www.youtube.com/"
DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "tmp" / "youtube.cookies.txt"
DEFAULT_JSON_OUTPUT = Path(__file__).resolve().parents[2] / "tmp" / "youtube.cookies.json"
COOKIE_DOMAINS = (
    "youtube.com",
    ".youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    ".google.com",
    ".googlevideo.com",
    "youtu.be",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open a browser, let you log into YouTube, then export cookies for local development.")
    parser.add_argument("--url", default=DEFAULT_URL, help="Page to open before login/export.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Path to write the cookie header text file.")
    parser.add_argument("--json-output", default=str(DEFAULT_JSON_OUTPUT), help="Path to write full cookie metadata as JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_path = Path(args.output).expanduser().resolve()
    json_output_path = Path(args.json_output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    json_output_path.parent.mkdir(parents=True, exist_ok=True)

    print("Opening Chromium for YouTube login.")
    print("1. Log into YouTube in the opened window.")
    print("2. Make sure the page has finished loading.")
    print("3. Return here and press Enter to export cookies.")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.goto(args.url, wait_until="domcontentloaded")
        input()

        cookies = [
            cookie
            for cookie in context.cookies()
            if any(cookie["domain"] == domain or cookie["domain"].endswith(domain) for domain in COOKIE_DOMAINS)
        ]
        browser.close()

    if not cookies:
        raise SystemExit("No YouTube cookies were captured. Make sure you logged into YouTube before exporting.")

    cookie_header = "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in cookies if cookie.get("name") and cookie.get("value"))
    output_path.write_text(cookie_header + "\n", encoding="utf-8")
    json_output_path.write_text(json.dumps(cookies, ensure_ascii=False, indent=2), encoding="utf-8")

    key_names = {"SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID", "VISITOR_INFO1_LIVE", "PREF", "LOGIN_INFO", "SID"}
    found = sorted(cookie["name"] for cookie in cookies if cookie["name"] in key_names)

    print(f"Saved cookie header to: {output_path}")
    print(f"Saved cookie metadata to: {json_output_path}")
    print(f"Captured {len(cookies)} cookies. Key cookies present: {', '.join(found) if found else 'none'}")


if __name__ == "__main__":
    main()
