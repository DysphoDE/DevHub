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
    page.locator("#workspace-settings").click()
    dialog = page.locator("#workspace-dialog")
    dialog.wait_for(state="visible")
    workspace_input = page.locator("#workspace-input")
    assert workspace_input.input_value()
    assert page.locator("#workspace-path").inner_text() == workspace_input.input_value()

    page.screenshot(path=str(result_dir / "workspace-settings.png"), full_page=True)

    page.locator("#workspace-cancel").click()
    assert not dialog.is_visible()
    assert console_errors == [], f"Browser console errors: {console_errors}"
    browser.close()
