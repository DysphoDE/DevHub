from pathlib import Path
from playwright.sync_api import sync_playwright


result_dir = Path(__file__).parent.parent / "test-results"
result_dir.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1050}, device_scale_factor=1)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto("http://127.0.0.1:7331", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.locator(".project-card").first.wait_for(timeout=15000)
    assert page.locator(".project-card").count() >= 40
    assert page.get_by_text("DevHub", exact=True).count() >= 1
    assert page.locator("#focus-shelf").count() == 0
    assert page.locator("#palette-dialog").count() == 0
    for selector in ("#laragon-toggle", "#laragon-open", "#laragon-reload"):
        assert page.locator(selector).is_visible()
    page.locator("#runtime-details").click()
    assert page.locator("#runtime-topology").is_visible()
    assert page.locator("#laragon-toggle").is_visible()
    page.locator("#runtime-details").click()
    page.wait_for_timeout(700)
    page.screenshot(path=str(result_dir / "dashboard-real.png"), full_page=False)
    page.keyboard.press("Control+K")
    assert page.locator("#search").evaluate("element => element === document.activeElement")
    page.locator("#search").fill("ImageBuddies")
    page.get_by_text("ImageBuddies", exact=True).first.wait_for()
    visible_cards = page.locator(".project-card")
    assert visible_cards.count() >= 1
    assert all("imagebuddies" in text.lower() for text in visible_cards.all_inner_texts())

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    mobile.goto("http://127.0.0.1:7331", wait_until="domcontentloaded")
    mobile.wait_for_load_state("networkidle")
    mobile.locator(".project-card").first.wait_for(timeout=15000)
    assert mobile.locator(".global-search").is_visible()
    assert mobile.locator("#service-dock").is_visible()
    for selector in ("#laragon-toggle", "#laragon-open", "#laragon-reload"):
        assert mobile.locator(selector).is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    mobile.screenshot(path=str(result_dir / "dashboard-real-mobile.png"), full_page=False)
    mobile.close()
    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
