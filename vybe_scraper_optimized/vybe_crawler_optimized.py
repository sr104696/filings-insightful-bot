import argparse
import asyncio
import re
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlunparse

from markdownify import markdownify as md
from playwright.async_api import TimeoutError as PlaywrightTimeout
from playwright.async_api import async_playwright

DEFAULT_BASE_URL = "https://sec-scanner-abd-inc22.vybe.build/"
DEFAULT_OUTPUT_MD = "vybe_app_full.md"
DEFAULT_MAX_PAGES = 50
DEFAULT_CONCURRENCY = 5

CONTENT_SELECTORS = ["main", "[role='main']", "#root", "#__next", "[data-vybe-root]", "body"]
NAV_SELECTORS = [
    "nav",
    "header",
    "footer",
    "[aria-label='navigation']",
    "[aria-label='Navigation']",
    "[role='navigation']",
]

SKIP_PATH_PREFIXES = (
    "/api/",
    "/_next/",
    "/assets/",
    "/static/",
    "/node_modules/",
    "/.well-known/",
)

SKIP_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".css", ".js", ".map",
    ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".zip", ".gz", ".mp4", ".webm", ".mov",
    ".mp3", ".wav",
)


def is_route_fragment(fragment: str) -> bool:
    return fragment.startswith("/") or fragment.startswith("!/")


def normalize_url(url: str) -> str:
    p = urlparse(url)
    fragment = p.fragment if is_route_fragment(p.fragment) else ""
    path = p.path.rstrip("/") or "/"
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path, p.params, p.query, fragment))


def should_skip_url(url: str, base_netloc: str) -> bool:
    p = urlparse(url)
    if p.scheme not in {"http", "https"}:
        return True
    if p.netloc.lower() != base_netloc.lower():
        return True

    path_lower = p.path.lower()
    if any(path_lower.startswith(prefix) for prefix in SKIP_PATH_PREFIXES):
        return True
    if path_lower.endswith(SKIP_EXTENSIONS):
        return True
    if any(part in path_lower for part in ["/logout", "/signout"]):
        return True
    return False


def clean_text(html: str) -> str:
    text = md(html, heading_style="ATX", code_language_detection=True, strip=["script", "style", "noscript"])
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip()


async def wait_for_app_content(page, settle_ms: int) -> None:
    for selector in CONTENT_SELECTORS:
        try:
            await page.wait_for_selector(selector, state="attached", timeout=2500)
            break
        except PlaywrightTimeout:
            continue

    try:
        await page.wait_for_load_state("networkidle", timeout=3000)
    except PlaywrightTimeout:
        pass

    await page.wait_for_timeout(settle_ms)


async def extract_raw_links_from_frame(frame) -> list[str]:
    js = """
() => {
  const values = new Set();
  for (const el of document.querySelectorAll('a[href], area[href]')) {
    const href = el.getAttribute('href');
    if (href) values.add(href);
    if (el.href) values.add(el.href);
  }
  const attrs = ['to', 'data-href', 'data-url', 'data-path', 'data-route'];
  for (const el of document.querySelectorAll('*')) {
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (value) values.add(value);
    }
  }
  return Array.from(values);
}
"""
    try:
        return await frame.evaluate(js)
    except Exception:
        return []


async def get_internal_links(page, current_url: str, base_netloc: str) -> set[str]:
    raw_links: list[str] = []
    for frame in page.frames:
        raw_links.extend(await extract_raw_links_from_frame(frame))

    result: set[str] = set()
    for raw in raw_links:
        if not raw:
            continue
        raw = raw.strip()
        if raw.startswith(("mailto:", "tel:", "sms:", "javascript:", "data:", "blob:")):
            continue
        absolute = urljoin(current_url, raw)
        normalized = normalize_url(absolute)
        if should_skip_url(normalized, base_netloc):
            continue
        result.add(normalized)
    return result


async def remove_boilerplate(page) -> None:
    selectors = ["script", "style", "noscript", "svg", *NAV_SELECTORS]
    selector_string = ", ".join(selectors)
    try:
        await page.evaluate(
            """
        (sel) => {
          document.querySelectorAll(sel).forEach((el) => el.remove());
        }
        """,
            selector_string,
        )
    except Exception:
        pass


async def get_best_content_html(page) -> str:
    for selector in CONTENT_SELECTORS:
        try:
            el = await page.query_selector(selector)
            if not el:
                continue
            text = await el.inner_text()
            if text and text.strip():
                return await el.inner_html()
        except Exception:
            continue
    return await page.content()


async def enqueue_url(url: str, queue: asyncio.Queue, visited: set[str], order: dict[str, int], lock: asyncio.Lock, max_pages: int) -> bool:
    async with lock:
        if url in visited or len(visited) >= max_pages:
            return False
        visited.add(url)
        order[url] = len(order)
        await queue.put(url)
        return True


async def scrape_page(context, url: str, base_netloc: str, queue: asyncio.Queue, visited: set[str], order: dict[str, int], lock: asyncio.Lock, results: list[tuple[int, str]], errors: list[str], max_pages: int, settle_ms: int, timeout_ms: int) -> None:
    page = await context.new_page()
    page_order = order.get(url, 0) + 1
    print(f"[{page_order:>3}] Scraping: {url}")

    try:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except PlaywrightTimeout:
            print("      ! Navigation timeout; scraping current DOM anyway")

        await wait_for_app_content(page, settle_ms=settle_ms)
        for link in sorted(await get_internal_links(page, url, base_netloc)):
            await enqueue_url(link, queue, visited, order, lock, max_pages)

        await remove_boilerplate(page)
        html = await get_best_content_html(page)
        markdown = clean_text(html)
        title = await page.title()
        path = urlparse(url).path or "/"

        if markdown:
            block = f"## {title or path}\n\nURL: `{url}`\n\n{markdown}\n\n---\n"
            results.append((order.get(url, 0), block))
    except Exception as e:
        message = f"Error on {url}: {type(e).__name__}: {e}"
        print(f"      ✗ {message}")
        errors.append(message)
    finally:
        await page.close()


async def worker(name: int, context, base_netloc: str, queue: asyncio.Queue, visited: set[str], order: dict[str, int], lock: asyncio.Lock, results: list[tuple[int, str]], errors: list[str], max_pages: int, settle_ms: int, timeout_ms: int) -> None:
    _ = name
    while True:
        url = await queue.get()
        try:
            await scrape_page(context, url, base_netloc, queue, visited, order, lock, results, errors, max_pages, settle_ms, timeout_ms)
        finally:
            queue.task_done()


async def crawl(base_url: str, output_md: Path, max_pages: int, concurrency: int, settle_ms: int, timeout_ms: int) -> None:
    start = time.perf_counter()
    seed = normalize_url(base_url)
    base_netloc = urlparse(seed).netloc
    visited = {seed}
    order = {seed: 0}
    queue: asyncio.Queue = asyncio.Queue()
    lock = asyncio.Lock()
    results: list[tuple[int, str]] = []
    errors: list[str] = []
    await queue.put(seed)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (compatible; VybeDocBot/1.0; +https://vybe.build)",
            java_script_enabled=True,
            ignore_https_errors=True,
            viewport={"width": 1440, "height": 1200},
        )

        workers = [
            asyncio.create_task(worker(i, context, base_netloc, queue, visited, order, lock, results, errors, max_pages, settle_ms, timeout_ms))
            for i in range(concurrency)
        ]

        await queue.join()
        for task in workers:
            task.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        await browser.close()

    results.sort(key=lambda item: item[0])
    output = [
        "# Vybe App — Full Site Dump",
        "",
        f"Base URL: `{seed}`",
        f"Pages discovered: `{len(visited)}`",
        f"Pages captured: `{len(results)}`",
        "",
        "---",
        "",
    ]
    output.extend(block for _, block in results)

    if errors:
        output.extend(["", "## Crawl Errors", "", *[f"- {err}" for err in errors], ""])

    output_md.write_text("\n".join(output), encoding="utf-8")
    elapsed = time.perf_counter() - start
    print(f"\n✓ Done. Discovered {len(visited)} page(s) in {elapsed:.1f}s → {output_md}")


def parse_args():
    parser = argparse.ArgumentParser(description="Crawl a Vybe app and export content to Markdown.")
    parser.add_argument("base_url", nargs="?", default=DEFAULT_BASE_URL, help="Vybe app URL to crawl.")
    parser.add_argument("-o", "--output", default=DEFAULT_OUTPUT_MD, help="Markdown output file.")
    parser.add_argument("--max-pages", type=int, default=DEFAULT_MAX_PAGES, help="Maximum pages/routes to crawl.")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="Number of concurrent browser pages.")
    parser.add_argument("--settle-ms", type=int, default=1000, help="Extra wait after app content appears.")
    parser.add_argument("--timeout-ms", type=int, default=30000, help="Navigation timeout.")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    await crawl(args.base_url, Path(args.output), args.max_pages, args.concurrency, args.settle_ms, args.timeout_ms)


if __name__ == "__main__":
    asyncio.run(main())
