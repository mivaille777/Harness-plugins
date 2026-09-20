#[cfg(windows)]
#[tokio::main]
async fn main() {
    use dsh_selection_companion_native::bridge::BridgeRuntime;
    use dsh_selection_companion_native::providers::browser_accessibility::BrowserAccessibilityProvider;
    use dsh_selection_companion_native::providers::{ProviderCapture, SelectionProvider};

    let provider = match BrowserAccessibilityProvider::standard() {
        Ok(provider) => provider,
        Err(error) => {
            eprintln!("[pipeline-probe] provider init failed: {error}");
            std::process::exit(1);
        }
    };

    let snapshot = match provider.capture() {
        Ok(ProviderCapture::Captured(snapshot)) => {
            eprintln!(
                "[pipeline-probe] UIA captured {} chars from {}",
                snapshot.selection.text.chars().count(),
                snapshot.source.app.as_deref().unwrap_or(snapshot.provider.as_str()),
            );
            snapshot
        }
        Ok(ProviderCapture::NoSelection) => {
            eprintln!(
                "[pipeline-probe] UIA is readable, but no non-empty selection is currently exposed"
            );
            std::process::exit(2);
        }
        Ok(ProviderCapture::NotApplicable) => {
            eprintln!("[pipeline-probe] no supported Chromium browser window is exposed through Windows UIA");
            std::process::exit(2);
        }
        Err(error) => {
            eprintln!("[pipeline-probe] UIA capture failed: {error}");
            std::process::exit(1);
        }
    };

    let expected_id = snapshot.id.clone();
    let expected_revision = snapshot.revision;
    let expected_text = snapshot.selection.text.clone();

    let bridge = match BridgeRuntime::from_environment() {
        Ok(bridge) => bridge,
        Err(error) => {
            eprintln!("[pipeline-probe] bridge config failed: {error}");
            std::process::exit(1);
        }
    };

    if let Err(error) = bridge.submit_selection(snapshot).await {
        eprintln!("[pipeline-probe] selection publish failed: {error}");
        std::process::exit(1);
    }
    eprintln!("[pipeline-probe] selection.update accepted by Harness");

    let current = match bridge.current_selection().await {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            eprintln!("[pipeline-probe] Harness returned no current selection after accepting selection.update");
            std::process::exit(1);
        }
        Err(error) => {
            eprintln!("[pipeline-probe] selection.current failed: {error}");
            std::process::exit(1);
        }
    };

    if current.id != expected_id
        || current.revision != expected_revision
        || current.selection.text != expected_text
    {
        eprintln!(
            "[pipeline-probe] read-back mismatch: expected {}@{}, got {}@{}",
            expected_id, expected_revision, current.id, current.revision
        );
        std::process::exit(1);
    }

    println!(
        "[pipeline-probe] PASS: UIA -> BridgeRuntime -> Harness -> selection.current ({})",
        current.id
    );
    println!("{}", serde_json::to_string_pretty(&current).unwrap());
}

#[cfg(not(windows))]
fn main() {
    eprintln!("[pipeline-probe] Windows UI Automation and named pipes are only available on Windows");
    std::process::exit(2);
}
