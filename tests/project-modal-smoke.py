from pathlib import Path
from playwright.sync_api import sync_playwright


result_dir = Path(__file__).parent.parent / "test-results"
result_dir.mkdir(exist_ok=True)


def open_dashboard(page):
    page.goto("http://127.0.0.1:7331", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.locator(".project-card").first.wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    console_errors = []

    desktop = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    desktop.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    open_dashboard(desktop)

    boxes = [desktop.locator(".project-card").nth(index).bounding_box() for index in range(min(6, desktop.locator(".project-card").count()))]
    card_heights = [box["height"] for box in boxes if box]
    assert max(card_heights) - min(card_heights) < 2

    card = desktop.locator(".project-card", has=desktop.get_by_role("heading", name="DevHub", exact=True))
    git_signal = card.locator(".git-inline-status")
    git_signal.wait_for()
    assert "Änderung" in git_signal.inner_text()
    assert card.locator(".git-branch-icon").is_visible()
    desktop.screenshot(path=str(result_dir / "project-cards-git.png"), full_page=False)
    favorite = card.locator("[data-favorite]")
    was_favorite = favorite.get_attribute("aria-pressed") == "true"
    favorite.click()
    assert not desktop.locator("#project-dialog").get_attribute("open")
    card = desktop.locator(".project-card", has=desktop.get_by_role("heading", name="DevHub", exact=True))
    assert (card.locator("[data-favorite]").get_attribute("aria-pressed") == "true") != was_favorite
    card.locator("[data-favorite]").click()

    card = desktop.locator(".project-card", has=desktop.get_by_role("heading", name="DevHub", exact=True))
    card.locator("h2").click()
    dialog = desktop.locator("#project-dialog")
    dialog.wait_for(state="visible")
    assert dialog.locator(".project-detail-head").is_visible()
    assert dialog.locator(".detail-facts").is_visible()
    assert dialog.locator(".git-detail").is_visible()
    assert dialog.locator(".launcher-detail").is_visible()
    assert dialog.locator(".git-file-row").count() > 0
    assert dialog.locator("[data-git-action='stage']").count() > 0
    first_file = dialog.locator(".git-file-row").first
    first_path = first_file.get_attribute("data-git-file")
    dialog.locator(".git-diff-panel .diff-line.addition").first.wait_for(timeout=10000)
    assert first_file.get_attribute("class").find("active") >= 0
    assert dialog.locator(".git-diff-head > strong").get_attribute("title") == first_path
    assert dialog.locator(".diff-additions").inner_text().startswith("+")
    if dialog.locator(".git-file-row").count() > 1:
        second_file = dialog.locator(".git-file-row").nth(1)
        second_path = second_file.get_attribute("data-git-file")
        second_file.locator(".git-file-path").click()
        dialog.locator(".git-diff-head > strong").filter(has_text=second_path).wait_for(timeout=10000)
        dialog.locator(".git-diff-panel .diff-line.addition").first.wait_for(timeout=10000)
    commit_input = dialog.locator("#git-commit-message")
    commit_button = dialog.locator("[data-git-action='commit']")
    assert commit_input.is_visible()
    assert commit_button.is_disabled()
    commit_input.fill("Nur ein UI-Test")
    assert commit_button.is_disabled()  # Im echten Repository wird nichts vorgemerkt.
    dialog_box = dialog.bounding_box()
    assert dialog_box and dialog_box["width"] >= 1200
    assert dialog.locator("[data-copy-path]").is_visible()
    assert desktop.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    desktop.screenshot(path=str(result_dir / "project-modal-desktop.png"), full_page=False)

    dialog.locator("[data-close-project]").click()
    dialog.wait_for(state="hidden")
    card = desktop.locator(".project-card", has=desktop.get_by_role("heading", name="DevHub", exact=True))
    card.focus()
    desktop.keyboard.press("Enter")
    dialog.wait_for(state="visible")
    desktop.keyboard.press("Escape")
    dialog.wait_for(state="hidden")

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    open_dashboard(mobile)
    mobile.locator(".project-card").first.locator("h2").click()
    mobile_dialog = mobile.locator("#project-dialog")
    mobile_dialog.wait_for(state="visible")
    assert mobile_dialog.locator(".detail-facts").is_visible()
    assert mobile_dialog.locator(".git-detail").is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    assert mobile_dialog.evaluate("node => node.scrollWidth <= node.clientWidth + 1")
    mobile.screenshot(path=str(result_dir / "project-modal-mobile.png"), full_page=False)

    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
