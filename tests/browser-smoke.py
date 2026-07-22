from pathlib import Path
import os
from playwright.sync_api import sync_playwright


result_dir = Path(__file__).parent.parent / "test-results"
result_dir.mkdir(exist_ok=True)
test_port = int(os.environ.get("DEVHUB_TEST_PORT", "7331"))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    page.goto(f"http://127.0.0.1:{test_port}", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="Sample Vite").wait_for()
    assert page.locator(".project-card").count() == 3
    assert page.get_by_role("heading", name="Sample Portfolio").count() == 1
    assert page.get_by_text("Eine kleine PHP-Testanwendung für DevHub.").count() == 1
    vite_card = page.locator(".project-card", has=page.get_by_role("heading", name="Sample Vite"))
    assert vite_card.locator(".launcher-command").inner_text() == "npm run dev"

    vite_card.locator("[data-launcher-action='start']").first.click()
    vite_card.locator(".launcher-status.running").wait_for(timeout=10000)
    page.wait_for_timeout(600)
    page.screenshot(path=str(result_dir / "dashboard.png"), full_page=True)
    vite_card.locator("[data-log]").click()
    page.get_by_text("ready at http://localhost:43124/").wait_for(timeout=10000)
    page.screenshot(path=str(result_dir / "logs.png"), full_page=True)
    page.locator("#close-log").click()
    vite_card.locator("[data-launcher-action='stop']").first.click()
    vite_card.locator(".launcher-status", has_text="bereit").wait_for(timeout=10000)

    html_card = page.locator(".project-card", has=page.get_by_role("heading", name="Sample Portfolio"))
    html_card.locator("[data-launcher-action='start']").first.click()
    html_card.locator(".launcher-status.running").wait_for(timeout=10000)
    html_url = html_card.locator("a.primary-card-action").get_attribute("href")
    assert html_url
    html_response = page.request.get(html_url)
    assert html_response.ok and "Sample Portfolio" in html_response.text()
    html_card.locator("[data-launcher-action='stop']").first.click()
    html_card.locator(".launcher-status", has_text="bereit").wait_for(timeout=10000)

    php_card = page.locator(".project-card", has=page.get_by_role("heading", name="Sample PHP"))
    php_card.locator("[data-launcher-action='start']").first.click()
    php_card.locator(".launcher-status.running").wait_for(timeout=10000)
    php_url = php_card.locator("a.primary-card-action").get_attribute("href")
    assert php_url
    php_response = page.request.get(php_url)
    assert php_response.ok and "DevHub PHP test" in php_response.text()
    php_card.locator("[data-launcher-action='stop']").first.click()
    php_card.locator(".launcher-status", has_text="bereit").wait_for(timeout=10000)

    page.keyboard.press("Control+K")
    assert page.locator("#search").evaluate("element => element === document.activeElement")
    page.locator("#search").fill("Sample Portfolio")
    page.get_by_role("heading", name="Sample Portfolio").wait_for()
    assert page.locator(".project-card").count() == 1
    page.locator("#search").fill("")

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    mobile.goto(f"http://127.0.0.1:{test_port}", wait_until="domcontentloaded")
    mobile.wait_for_load_state("networkidle")
    mobile.locator("#mobile-view-filters").wait_for()
    mobile.get_by_role("button", name="Favoriten", exact=True).click()
    mobile.get_by_role("heading", name="Keine passenden Projekte").wait_for()
    mobile.get_by_role("button", name="Alle", exact=True).click()
    mobile.get_by_role("heading", name="Sample Portfolio").wait_for()
    mobile.wait_for_timeout(500)
    mobile.screenshot(path=str(result_dir / "dashboard-mobile.png"), full_page=False)
    mobile.close()

    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
