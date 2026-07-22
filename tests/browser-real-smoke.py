from pathlib import Path
from playwright.sync_api import sync_playwright


result_dir = Path(__file__).parent.parent / "test-results"
result_dir.mkdir(exist_ok=True)


def assert_minimum_visible_text_size(page, root_selector="body", minimum=10):
    undersized = page.locator(root_selector).evaluate(
        """(root, minimum) => [...root.querySelectorAll('*')]
            .filter((element) => {
                const style = getComputedStyle(element);
                const bounds = element.getBoundingClientRect();
                const hasOwnText = [...element.childNodes]
                    .some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && bounds.width
                    && bounds.height
                    && hasOwnText
                    && Number.parseFloat(style.fontSize) < minimum;
            })
            .map((element) => ({
                text: element.textContent.trim().slice(0, 60),
                size: getComputedStyle(element).fontSize,
                selector: element.className || element.tagName.toLowerCase(),
            }))""",
        minimum,
    )
    assert undersized == [], f"Visible text below {minimum}px: {undersized}"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 2560, "height": 1200}, device_scale_factor=1)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.goto("http://127.0.0.1:7331", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    page.locator(".project-card").first.wait_for(timeout=15000)
    assert_minimum_visible_text_size(page)
    assert page.locator(".project-card").count() >= 40
    assert page.get_by_text("DevHub", exact=True).count() >= 1
    assert page.locator("#focus-shelf").count() == 0
    assert page.locator("#palette-dialog").count() == 0
    for selector in ("#laragon-toggle", "#laragon-open", "#laragon-reload"):
        assert page.locator(selector).is_visible()
    assert "Font Awesome" in page.locator(".global-search-icon").evaluate("element => getComputedStyle(element).fontFamily")
    page.locator("#runtime-details").click()
    assert page.locator("#runtime-topology").is_visible()
    assert page.locator("#laragon-toggle").is_visible()
    page.locator("#runtime-details").click()
    page.wait_for_timeout(700)
    page.screenshot(path=str(result_dir / "dashboard-real.png"), full_page=False)

    page.locator('[data-view="list"]').click()
    page.locator(".project-list-row").first.wait_for()
    assert_minimum_visible_text_size(page, "#project-list")
    first_row = page.locator(".project-list-row").first
    assert first_row.locator(".list-launcher-toggle").count() == 0
    multi_launcher_row = None
    for index in range(page.locator(".project-list-row").count()):
        candidate = page.locator(".project-list-row").nth(index)
        launcher_count = int(candidate.locator(".list-launcher-head b").inner_text())
        assert candidate.locator(".launcher-row").count() == launcher_count
        if launcher_count > 1 and multi_launcher_row is None:
            multi_launcher_row = candidate
    assert multi_launcher_row is not None
    action_row = page.locator(".project-list-row:has(.launcher-row)").first
    action_buttons = action_row.locator(".list-action-grid > .primary-card-action, .list-action-grid .card-icon-action")
    action_boxes = [action_buttons.nth(index).bounding_box() for index in range(action_buttons.count())]
    assert all(box is not None for box in action_boxes)
    assert len({round(box["height"]) for box in action_boxes}) == 1
    utility_buttons = action_row.locator(".list-utility-actions .card-icon-action")
    utility_boxes = [utility_buttons.nth(index).bounding_box() for index in range(utility_buttons.count())]
    assert len({round(box["width"]) for box in utility_boxes}) == 1
    assert round(utility_boxes[0]["width"]) == 34
    action_grid_box = action_row.locator(".list-action-grid").bounding_box()
    assert sum(box["width"] for box in action_boxes) < action_grid_box["width"] * 0.5
    apache_button = page.locator("#laragon-toggle")
    if apache_button.locator("#laragon-toggle-label").inner_text() == "Apache starten":
        assert "online" not in (apache_button.get_attribute("class") or "")
        assert "offline" in (apache_button.get_attribute("class") or "")
        assert apache_button.evaluate("element => getComputedStyle(element).backgroundColor") == "rgb(32, 45, 60)"
    page.wait_for_timeout(500)
    page.screenshot(path=str(result_dir / "dashboard-real-list.png"), full_page=False)

    devhub_row = page.locator(".project-list-row", has=page.get_by_role("heading", name="DevHub", exact=True)).first
    devhub_row.get_by_role("heading", name="DevHub", exact=True).click()
    page.locator("#project-dialog[open]").wait_for()
    page.locator(".git-file-path").first.wait_for()
    assert_minimum_visible_text_size(page, "#project-dialog")
    assert float(page.locator(".git-file-path").first.evaluate("element => parseFloat(getComputedStyle(element).fontSize)")) >= 10
    assert float(page.locator(".diff-line").first.evaluate("element => parseFloat(getComputedStyle(element).fontSize)")) >= 11
    assert float(page.locator(".commit-composer label").evaluate("element => parseFloat(getComputedStyle(element).fontSize)")) >= 11
    assert page.locator("#project-dialog [data-git-suggest-message]").is_visible()
    page.screenshot(path=str(result_dir / "project-drawer-real.png"), full_page=False)
    page.locator("[data-close-project]").click()

    page.locator("#view-filters [data-page='git']").click()
    page.locator("#git-page:not([hidden])").wait_for()
    assert_minimum_visible_text_size(page, "#git-page")
    assert page.locator(".git-repository-item").count() >= 1
    assert page.locator(".git-repository-item.active").count() == 1
    assert page.locator(".git-selected-header").is_visible()
    assert page.locator(".git-page-detail .git-files-panel").is_visible()
    suggestion_button = page.locator(".git-page-detail [data-git-suggest-message]")
    assert suggestion_button.is_visible()
    if suggestion_button.is_enabled():
        page.locator(".git-page-detail [data-commit-message]").wait_for()
        page.wait_for_function("document.querySelector('.git-page-detail [data-commit-message]').value.trim().length >= 3")
        assert "Automatisch vorgeschlagen" in page.locator(".git-page-detail .commit-composer-note").inner_text()
    git_rows = page.locator(".git-page-detail .git-file-row")
    git_rows.first.click()
    git_rows.nth(1).click(modifiers=["Control"])
    assert page.locator(".git-page-detail .git-file-row.selected").count() == 2
    assert page.locator(".git-page-detail [data-git-select-file]:checked").count() == 2
    assert page.locator(".git-page-detail [data-git-selection-action='discard-files']").is_enabled()
    assert float(page.locator(".git-page-detail .git-file-action").first.evaluate("element => parseFloat(getComputedStyle(element).borderRadius)")) >= 8
    page.locator(".git-page-detail [data-git-selection-action='discard-files']").click()
    page.locator("#git-discard-dialog[open]").wait_for()
    assert "2 Dateien" in page.locator("#git-discard-count").inner_text()
    page.locator("#git-discard-cancel").click()
    assert page.locator(".git-command-refresh").bounding_box()["height"] <= 46
    assert page.locator(".git-repository-item").first.bounding_box()["height"] <= 68
    assert page.locator(".git-status-strip").bounding_box()["height"] <= 48
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    page.locator(".git-page-detail .git-mode-tabs [data-git-mode='history']").click()
    page.locator(".git-history-workbench").wait_for()
    assert_minimum_visible_text_size(page, ".git-page-detail")
    assert page.locator(".git-history-commit").count() >= 1
    assert page.locator(".git-history-commit.active").count() == 1
    assert page.locator(".git-commit-head").is_visible()
    page.locator(".git-page-detail .git-mode-tabs [data-git-mode='changes']").click()
    page.locator(".git-filter-tabs [data-git-filter='changed']").click()
    assert page.locator(".git-filter-tabs [data-git-filter='changed']").get_attribute("aria-pressed") == "true"
    page.locator(".git-filter-tabs [data-git-filter='all']").click()
    page.screenshot(path=str(result_dir / "git-workspace-real.png"), full_page=False)
    page.locator("#view-filters [data-page='projects'][data-filter='all']").click()
    page.locator("#projects-page:not([hidden])").wait_for()

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
    assert_minimum_visible_text_size(mobile)
    assert mobile.locator(".global-search").is_visible()
    assert mobile.locator("#service-dock").is_visible()
    for selector in ("#laragon-toggle", "#laragon-open", "#laragon-reload"):
        assert mobile.locator(selector).is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    mobile.screenshot(path=str(result_dir / "dashboard-real-mobile.png"), full_page=False)
    mobile.locator("#mobile-workspace-tabs [data-page='git']").click()
    mobile.locator("#git-page:not([hidden])").wait_for()
    assert_minimum_visible_text_size(mobile, "#git-page")
    assert mobile.locator(".git-repository-list").is_visible()
    assert mobile.locator(".git-selected-header").is_visible()
    assert mobile.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
    mobile.screenshot(path=str(result_dir / "git-workspace-real-mobile.png"), full_page=False)
    mobile.close()
    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
