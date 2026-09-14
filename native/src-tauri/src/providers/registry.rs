use super::browser_accessibility::BrowserAccessibilityProvider;
use super::types::{CaptureContext, ProviderAttempt, ProviderCandidate};
use super::{ProviderCapture, SelectionProvider};

#[derive(Default)]
pub struct ProviderRegistry {
    providers: Vec<Box<dyn SelectionProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Current production-equivalent registry. Later batches may add DOM, Word,
    /// PDF, and generic UIA providers without changing the capture/session seam.
    pub fn browser_default(context_chars: i32) -> Result<Self, String> {
        let mut registry = Self::new();
        registry.register(BrowserAccessibilityProvider::new(context_chars)?)?;
        Ok(registry)
    }

    pub fn register<P>(&mut self, provider: P) -> Result<(), String>
    where
        P: SelectionProvider + 'static,
    {
        let id = provider.id();
        if id.trim().is_empty() {
            return Err("provider id must not be empty".to_owned());
        }
        if self.providers.iter().any(|current| current.id() == id) {
            return Err(format!("provider id is already registered: {id}"));
        }
        self.providers.push(Box::new(provider));
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.providers.len()
    }

    pub fn is_empty(&self) -> bool {
        self.providers.is_empty()
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.providers.iter().map(|provider| provider.id()).collect()
    }

    /// Capture all currently registered providers without choosing a winner.
    /// Arbitration intentionally lives in a separate layer so adding a richer
    /// provider cannot bypass common privacy/admission policy.
    pub fn capture_all(&self, _context: &CaptureContext) -> Vec<ProviderAttempt> {
        self.providers
            .iter()
            .map(|provider| {
                let provider_id = provider.id();
                match provider.capture() {
                    Ok(ProviderCapture::Captured(snapshot)) => {
                        match ProviderCandidate::new(provider_id, snapshot) {
                            Ok(candidate) => ProviderAttempt::Candidate(candidate),
                            Err(message) => ProviderAttempt::Error {
                                provider_id,
                                message,
                            },
                        }
                    }
                    Ok(ProviderCapture::NoSelection) => {
                        ProviderAttempt::NoSelection { provider_id }
                    }
                    Ok(ProviderCapture::NotApplicable) => {
                        ProviderAttempt::NotApplicable { provider_id }
                    }
                    Err(message) => ProviderAttempt::Error {
                        provider_id,
                        message,
                    },
                }
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        SelectionCapabilities, SelectionContext, SelectionSnapshot, SelectionSource,
        SelectionSourceKind, SelectionValue,
    };
    use crate::providers::types::CaptureTrigger;

    #[derive(Clone)]
    enum FakeResult {
        Capture(ProviderCapture),
        Error(String),
    }

    struct FakeProvider {
        id: &'static str,
        result: FakeResult,
    }

    impl SelectionProvider for FakeProvider {
        fn id(&self) -> &'static str {
            self.id
        }

        fn capture(&self) -> Result<ProviderCapture, String> {
            match &self.result {
                FakeResult::Capture(capture) => Ok(capture.clone()),
                FakeResult::Error(message) => Err(message.clone()),
            }
        }
    }

    fn snapshot(provider: &str, text: &str) -> SelectionSnapshot {
        SelectionSnapshot {
            id: format!("{provider}-snapshot"),
            revision: 1,
            captured_at: 1,
            selection: SelectionValue {
                text: text.to_owned(),
                language: None,
            },
            source: SelectionSource {
                kind: SelectionSourceKind::Browser,
                app: Some("Test Browser".to_owned()),
                process: Some("browser.exe".to_owned()),
                window_title: Some("Test Document".to_owned()),
            },
            document: None,
            context: SelectionContext {
                before: None,
                after: None,
                section_text: None,
                page_text: None,
                page_available: false,
            },
            capabilities: SelectionCapabilities {
                local_context: false,
                section_context: false,
                page_context: false,
                screenshot: false,
            },
            geometry: None,
            provider: provider.to_owned(),
            confidence: 0.5,
        }
    }

    fn context() -> CaptureContext {
        CaptureContext::new(CaptureTrigger::Manual, 1)
    }

    #[test]
    fn browser_default_registers_the_existing_accessibility_provider() {
        let registry = ProviderRegistry::browser_default(900).unwrap();
        assert_eq!(registry.ids(), vec!["browser-accessibility"]);
    }

    #[test]
    fn registry_rejects_duplicate_provider_ids() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "browser-uia",
                result: FakeResult::Capture(ProviderCapture::NotApplicable),
            })
            .unwrap();

        let error = registry
            .register(FakeProvider {
                id: "browser-uia",
                result: FakeResult::Capture(ProviderCapture::NoSelection),
            })
            .unwrap_err();

        assert!(error.contains("already registered"));
        assert_eq!(registry.ids(), vec!["browser-uia"]);
    }

    #[test]
    fn registry_preserves_provider_results_without_arbitrating() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "dom",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot(
                    "dom",
                    "DOM selection",
                ))),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "uia",
                result: FakeResult::Capture(ProviderCapture::NoSelection),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "word",
                result: FakeResult::Capture(ProviderCapture::NotApplicable),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "broken",
                result: FakeResult::Error("provider failed".to_owned()),
            })
            .unwrap();

        let attempts = registry.capture_all(&context());

        assert_eq!(attempts.len(), 4);
        assert!(matches!(attempts[0], ProviderAttempt::Candidate(_)));
        assert!(matches!(attempts[1], ProviderAttempt::NoSelection { .. }));
        assert!(matches!(attempts[2], ProviderAttempt::NotApplicable { .. }));
        assert!(matches!(attempts[3], ProviderAttempt::Error { .. }));
        assert_eq!(
            attempts.iter().map(ProviderAttempt::provider_id).collect::<Vec<_>>(),
            vec!["dom", "uia", "word", "broken"]
        );
    }

    #[test]
    fn registry_turns_provider_identity_mismatch_into_a_bounded_error() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "registered-id",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot(
                    "different-id",
                    "Selection",
                ))),
            })
            .unwrap();

        let attempts = registry.capture_all(&context());

        assert!(matches!(
            &attempts[0],
            ProviderAttempt::Error { provider_id, message }
                if *provider_id == "registered-id" && message.contains("identity mismatch")
        ));
    }
}
