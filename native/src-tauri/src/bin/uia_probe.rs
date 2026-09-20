#[cfg(windows)]
fn main() {
    use dsh_selection_companion_native::providers::browser_accessibility::BrowserAccessibilityProvider;
    use dsh_selection_companion_native::providers::{ProviderCapture, SelectionProvider};

    let provider = match BrowserAccessibilityProvider::standard() {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("[uia-probe] provider init failed: {error}");
            std::process::exit(1);
        }
    };

    match provider.capture() {
        Ok(ProviderCapture::Captured(snapshot)) => {
            match serde_json::to_string_pretty(&snapshot) {
                Ok(json) => println!("{json}"),
                Err(error) => {
                    eprintln!("[uia-probe] snapshot serialization failed: {error}");
                    std::process::exit(1);
                }
            }
        }
        Ok(ProviderCapture::NoSelection) => {
            eprintln!(
                "[uia-probe] Chromium Document/TextPattern is readable, but no non-empty selection is currently exposed"
            );
            std::process::exit(2);
        }
        Ok(ProviderCapture::NotApplicable) => {
            eprintln!("[uia-probe] no supported Chromium browser window is exposed through Windows UIA");
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("[uia-probe] capture failed: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("[uia-probe] Windows UI Automation is only available on Windows");
    std::process::exit(2);
}
