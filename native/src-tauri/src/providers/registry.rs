use std::time::{SystemTime, UNIX_EPOCH};

use super::arbitrator::{arbitrate, ArbitrationResult};
use super::browser_accessibility::BrowserAccessibilityProvider;
use super::canonicalizer::canonicalize;
use super::types::{CaptureContext, CaptureTrigger, ProviderAttempt, ProviderCandidate};
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

    /// Run the complete provider path for one capture trigger: collect provider
    /// attempts, arbitrate eligible candidates, and canonicalize exactly one
    /// winning snapshot. Provider failures cannot bypass arbitration or common
    /// CaptureRuntime policy, and candidates are never field-merged.
    pub fn capture(&self, trigger: CaptureTrigger) -> Result<ProviderCapture, String> {
        let mut context = CaptureContext::new(trigger, now_millis());
        let attempts = self.capture_all(&context);
        // Arbitration should compare freshness against the end of the provider
        // read, not against its beginning. This avoids treating a slow but valid
        // provider read as a future-dated candidate.
        context.captured_at = now_millis();

        let mut candidates = Vec::new();
        let mut saw_no_selection = false;
        let mut errors = Vec::new();

        for attempt in attempts {
            match attempt {
                ProviderAttempt::Candidate(candidate) => candidates.push(candidate),
                ProviderAttempt::NoSelection { .. } => saw_no_selection = true,
                ProviderAttempt::NotApplicable { .. } => {}
                ProviderAttempt::Error {
                    provider_id,
                    message,
                } => errors.push((provider_id, message)),
            }
        }

        if !candidates.is_empty() {
            return match arbitrate(&context, candidates) {
                ArbitrationResult::Selected { candidate, .. } => {
                    canonicalize(candidate).map(ProviderCapture::Captured)
                }
                ArbitrationResult::NoCandidate { rejected } => Err(format!(
                    "provider arbitration rejected all {} candidate(s)",
                    rejected.len()
                )),
                ArbitrationResult::Conflict { provider_ids, .. } => Err(format!(
                    "provider arbitration conflict between: {}",
                    provider_ids.join(", ")
                )),
            };
        }

        // A healthy applicable provider that reports no selection wins over an
        // unrelated provider error. This keeps one broken optional provider from
        // turning an ordinary empty selection into a capture failure.
        if saw_no_selection {
            return Ok(ProviderCapture::NoSelection);
        }

        if !errors.is_empty() {
            let summary = errors
                .into_iter()
                .map(|(provider_id, message)| format!("{provider_id}: {message}"))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(format!("all applicable providers failed: {summary}"));
        }

        Ok(ProviderCapture::NotApplicable)
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

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        SelectionCapabilities, SelectionContext, SelectionSnapshot, SelectionSource,
        SelectionSourceKind, SelectionValue,
    };

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
        snapshot_at(provider, text, 1)
    }

    fn snapshot_at(provider: &str, text: &str, captured_at: u64) -> SelectionSnapshot {
        SelectionSnapshot {
            id: format!("{provider}-snapshot"),
            revision: 1,
            captured_at,
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

    #[test]
    fn capture_routes_candidates_through_arbitration_and_canonicalization() {
        let captured_at = now_millis();
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "browser-accessibility",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot_at(
                    "browser-accessibility",
                    "Unified selection",
                    captured_at,
                ))),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "browser-dom",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot_at(
                    "browser-dom",
                    "Unified selection",
                    captured_at,
                ))),
            })
            .unwrap();

        let result = registry.capture(CaptureTrigger::UiaEvent).unwrap();

        assert!(matches!(
            result,
            ProviderCapture::Captured(snapshot)
                if snapshot.provider == "browser-dom" && snapshot.selection.text == "Unified selection"
        ));
    }

    #[test]
    fn capture_fails_closed_when_fresh_providers_disagree_on_selection_text() {
        let captured_at = now_millis();
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "browser-accessibility",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot_at(
                    "browser-accessibility",
                    "Selection A",
                    captured_at,
                ))),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "browser-dom",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot_at(
                    "browser-dom",
                    "Selection B",
                    captured_at,
                ))),
            })
            .unwrap();

        let error = registry.capture(CaptureTrigger::UiaEvent).unwrap_err();

        assert!(error.contains("arbitration conflict"));
        assert!(error.contains("browser-accessibility"));
        assert!(error.contains("browser-dom"));
    }

    #[test]
    fn capture_allows_a_valid_candidate_to_survive_an_optional_provider_error() {
        let captured_at = now_millis();
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "browser-accessibility",
                result: FakeResult::Capture(ProviderCapture::Captured(snapshot_at(
                    "browser-accessibility",
                    "Selection",
                    captured_at,
                ))),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "broken-provider",
                result: FakeResult::Error("simulated failure".to_owned()),
            })
            .unwrap();

        let result = registry.capture(CaptureTrigger::FallbackPoll).unwrap();

        assert!(matches!(result, ProviderCapture::Captured(snapshot) if snapshot.selection.text == "Selection"));
    }

    #[test]
    fn capture_prefers_no_selection_over_an_unrelated_provider_error() {
        let mut registry = ProviderRegistry::new();
        registry
            .register(FakeProvider {
                id: "browser-accessibility",
                result: FakeResult::Capture(ProviderCapture::NoSelection),
            })
            .unwrap();
        registry
            .register(FakeProvider {
                id: "broken-provider",
                result: FakeResult::Error("simulated failure".to_owned()),
            })
            .unwrap();

        assert_eq!(
            registry.capture(CaptureTrigger::FallbackPoll).unwrap(),
            ProviderCapture::NoSelection
        );
    }
}
