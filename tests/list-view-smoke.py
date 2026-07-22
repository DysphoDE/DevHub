from pathlib import Path
from playwright.sync_api import sync_playwright


result_dir = Path(__file__).parent.parent / "test-results"
result_dir.mkdir(exist_ok=True)


def open_list(page):
    page.goto("http://127.0.0.1:7331", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.locator("[data-view='list']").click()
    page.locator(".project-list-row").first.wait_for()
    page.wait_for_timeout(350)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    console_errors = []

    desktop = browser.new_page(viewport={"width": 1728, "height": 1050}, device_scale_factor=1)
    desktop.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    open_list(desktop)
    assert desktop.locator(".project-list-row").count() >= 40
    first_card = desktop.locator(".project-list-row").first
    card_box = first_card.bounding_box()
    action_box = first_card.locator(".list-actions").bounding_box()
    assert card_box and action_box
    assert card_box["height"] <= 180
    assert action_box["x"] + action_box["width"] <= card_box["x"] + card_box["width"] + 1
    assert first_card.locator(".primary-card-action").is_visible()
    assert first_card.locator(".list-launcher-head").is_visible()
    git_row = desktop.locator(".project-list-row", has=desktop.locator(".git-card-signals")).first
    if git_row.count():
        assert git_row.locator(".git-card-signal").first.is_visible()
    expandable = desktop.locator(".project-list-row", has=desktop.locator(".list-launcher-toggle")).first
    if expandable.count():
        assert expandable.locator(".launcher-row").count() == 2
        expandable.locator(".list-launcher-toggle").click()
        assert expandable.locator(".launcher-row").count() > 2
        expandable.locator(".list-launcher-toggle").click()
        assert expandable.locator(".launcher-row").count() == 2
    desktop.screenshot(path=str(result_dir / "list-view-desktop.png"), full_page=False)

    tablet = browser.new_page(viewport={"width": 1100, "height": 900}, device_scale_factor=1)
    tablet.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    open_list(tablet)
    assert tablet.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert tablet.locator(".project-list-row").first.locator(".list-actions").is_visible()
    tablet.screenshot(path=str(result_dir / "list-view-tablet.png"), full_page=False)

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    open_list(mobile)
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert mobile.locator(".project-list-row").first.locator(".list-utility-actions").is_visible()
    mobile.screenshot(path=str(result_dir / "list-view-mobile.png"), full_page=False)

    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
