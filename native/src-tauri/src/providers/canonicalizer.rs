use super::types::ProviderCandidate;
use crate::protocol::SelectionSnapshot;

/// Finalize one arbitrated provider candidate into the canonical snapshot that
/// CaptureRuntime may pass to common policy and publish. Provider arbitration
/// chooses the winner; canonicalization validates that winner without merging
/// fields from other candidates.
pub fn canonicalize(candidate: ProviderCandidate) -> Result<SelectionSnapshot, String> {
    candidate
        .snapshot
        .validate()
        .map_err(|error| error.to_string())?;
    if candidate.snapshot.provider != candidate.provider_id {
        return Err(format!(
            "provider candidate identity mismatch: {} != {}",
            candidate.provider_id, candidate.snapshot.provider
        ));
    }
    Ok(candidate.snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        SelectionCapabilities, SelectionContext, SelectionSource, SelectionSourceKind,
        SelectionValue,
    };

    fn snapshot(provider: &str) -> SelectionSnapshot {
        SelectionSnapshot {
            id: "canonical-test".to_owned(),
            revision: 1,
            captured_at: 1,
            selection: SelectionValue {
                text: "Selection".to_owned(),
                language: None,
            },
            source: SelectionSource {
                kind: SelectionSourceKind::Browser,
                app: None,
                process: None,
                window_title: None,
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

    #[test]
    fn canonicalization_keeps_one_provider_snapshot_intact() {
        let expected = snapshot("browser-accessibility");
        let candidate = ProviderCandidate::new("browser-accessibility", expected.clone()).unwrap();

        let actual = canonicalize(candidate).unwrap();

        assert_eq!(actual, expected);
    }
}
