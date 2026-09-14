use super::types::{CaptureContext, ProviderCandidate};
use crate::protocol::SelectionSourceKind;

const DEFAULT_MAX_CANDIDATE_AGE_MS: u64 = 3_000;
const DEFAULT_MAX_FUTURE_SKEW_MS: u64 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArbitrationPolicy {
    pub max_candidate_age_ms: u64,
    pub max_future_skew_ms: u64,
}

impl Default for ArbitrationPolicy {
    fn default() -> Self {
        Self {
            max_candidate_age_ms: DEFAULT_MAX_CANDIDATE_AGE_MS,
            max_future_skew_ms: DEFAULT_MAX_FUTURE_SKEW_MS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RejectionReason {
    Stale,
    FutureSkew,
    ForegroundMismatch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RejectedCandidate {
    pub provider_id: &'static str,
    pub reason: RejectionReason,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ArbitrationResult {
    Selected {
        candidate: ProviderCandidate,
        rejected: Vec<RejectedCandidate>,
    },
    NoCandidate {
        rejected: Vec<RejectedCandidate>,
    },
    Conflict {
        provider_ids: Vec<&'static str>,
        rejected: Vec<RejectedCandidate>,
    },
}

pub fn arbitrate(
    context: &CaptureContext,
    candidates: Vec<ProviderCandidate>,
) -> ArbitrationResult {
    arbitrate_with_policy(context, candidates, ArbitrationPolicy::default())
}

pub fn arbitrate_with_policy(
    context: &CaptureContext,
    candidates: Vec<ProviderCandidate>,
    policy: ArbitrationPolicy,
) -> ArbitrationResult {
    let mut rejected = Vec::new();
    let mut eligible = Vec::new();

    for candidate in candidates {
        if candidate
            .snapshot
            .captured_at
            .saturating_add(policy.max_candidate_age_ms)
            < context.captured_at
        {
            rejected.push(RejectedCandidate {
                provider_id: candidate.provider_id,
                reason: RejectionReason::Stale,
            });
            continue;
        }
        if candidate.snapshot.captured_at
            > context
                .captured_at
                .saturating_add(policy.max_future_skew_ms)
        {
            rejected.push(RejectedCandidate {
                provider_id: candidate.provider_id,
                reason: RejectionReason::FutureSkew,
            });
            continue;
        }
        if foreground_mismatch(context, &candidate) {
            rejected.push(RejectedCandidate {
                provider_id: candidate.provider_id,
                reason: RejectionReason::ForegroundMismatch,
            });
            continue;
        }
        eligible.push(candidate);
    }

    if eligible.is_empty() {
        return ArbitrationResult::NoCandidate { rejected };
    }

    let first_text = normalized_text(&eligible[0].snapshot.selection.text);
    if eligible
        .iter()
        .skip(1)
        .any(|candidate| normalized_text(&candidate.snapshot.selection.text) != first_text)
    {
        let mut provider_ids = eligible
            .iter()
            .map(|candidate| candidate.provider_id)
            .collect::<Vec<_>>();
        provider_ids.sort_unstable();
        provider_ids.dedup();
        return ArbitrationResult::Conflict {
            provider_ids,
            rejected,
        };
    }

    eligible.sort_by(|left, right| {
        quality_score(context, right)
            .cmp(&quality_score(context, left))
            .then_with(|| right.snapshot.captured_at.cmp(&left.snapshot.captured_at))
            .then_with(|| left.provider_id.cmp(right.provider_id))
    });

    ArbitrationResult::Selected {
        candidate: eligible.remove(0),
        rejected,
    }
}

fn foreground_mismatch(context: &CaptureContext, candidate: &ProviderCandidate) -> bool {
    let Some(expected) = context.foreground_process.as_deref() else {
        return false;
    };
    let Some(actual) = candidate.snapshot.source.process.as_deref() else {
        return false;
    };
    normalize_process(expected) != normalize_process(actual)
}

fn normalize_process(value: &str) -> String {
    value
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(value)
        .trim()
        .to_ascii_lowercase()
}

fn normalized_text(value: &str) -> String {
    value.trim().to_owned()
}

fn points(condition: bool, value: i32) -> i32 {
    if condition {
        value
    } else {
        0
    }
}

fn quality_score(context: &CaptureContext, candidate: &ProviderCandidate) -> i32 {
    let snapshot = &candidate.snapshot;
    let mut score = provider_priority(candidate.provider_id);

    if let (Some(expected), Some(actual)) = (
        context.foreground_process.as_deref(),
        snapshot.source.process.as_deref(),
    ) {
        if normalize_process(expected) == normalize_process(actual) {
            score += 100;
        }
    }

    score += match (&snapshot.source.kind, candidate.provider_id) {
        (SelectionSourceKind::Word, "word-com") => 60,
        (SelectionSourceKind::Pdf, "pdf-accessibility") => 60,
        (SelectionSourceKind::Browser, "browser-dom") => 60,
        (SelectionSourceKind::Pdf, "browser-dom") => 50,
        _ => 0,
    };

    if let Some(document) = &snapshot.document {
        score += points(
            document
                .title
                .as_ref()
                .is_some_and(|value| !value.is_empty()),
            8,
        );
        score += points(
            document.url.as_ref().is_some_and(|value| !value.is_empty()),
            12,
        );
        score += points(
            document
                .section
                .as_ref()
                .is_some_and(|value| !value.is_empty()),
            10,
        );
        score += points(
            document
                .frame_url
                .as_ref()
                .is_some_and(|value| !value.is_empty()),
            5,
        );
    }
    score += points(snapshot.capabilities.local_context, 8);
    score += points(snapshot.capabilities.section_context, 12);
    score += points(snapshot.capabilities.page_context, 16);
    score += points(snapshot.geometry.is_some(), 4);

    // Confidence is a bounded quality hint only. It never grants scope or
    // bypasses freshness/foreground/conflict checks.
    score + (snapshot.confidence.clamp(0.0, 1.0) * 9.0).round() as i32
}

fn provider_priority(provider_id: &str) -> i32 {
    match provider_id {
        "browser-dom" => 500,
        "word-com" => 500,
        "pdf-accessibility" => 480,
        "browser-accessibility" => 400,
        "generic-uia" => 100,
        _ => 200,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        SelectionCapabilities, SelectionContext, SelectionDocument, SelectionSnapshot,
        SelectionSource, SelectionValue,
    };
    use crate::providers::types::{CaptureTrigger, ProviderCandidate};

    fn context(process: &str, captured_at: u64) -> CaptureContext {
        CaptureContext {
            trigger: CaptureTrigger::Manual,
            captured_at,
            foreground_process: Some(process.to_owned()),
            foreground_window: Some(42),
        }
    }

    fn candidate(
        provider: &'static str,
        kind: SelectionSourceKind,
        process: &str,
        text: &str,
        captured_at: u64,
        rich: bool,
    ) -> ProviderCandidate {
        let snapshot = SelectionSnapshot {
            id: format!("{provider}-{captured_at}"),
            revision: 1,
            captured_at,
            selection: SelectionValue {
                text: text.to_owned(),
                language: None,
            },
            source: SelectionSource {
                kind,
                app: Some("Test App".to_owned()),
                process: Some(process.to_owned()),
                window_title: Some("Test Document".to_owned()),
            },
            document: rich.then(|| SelectionDocument {
                title: Some("Document".to_owned()),
                url: Some("https://example.test/doc".to_owned()),
                file_path: None,
                section: Some("Section".to_owned()),
                frame_url: None,
            }),
            context: SelectionContext {
                before: rich.then(|| "before".to_owned()),
                after: rich.then(|| "after".to_owned()),
                section_text: rich.then(|| "section".to_owned()),
                page_text: None,
                page_available: false,
            },
            capabilities: SelectionCapabilities {
                local_context: rich,
                section_context: rich,
                page_context: false,
                screenshot: false,
            },
            geometry: None,
            provider: provider.to_owned(),
            confidence: if rich { 0.95 } else { 0.55 },
        };
        ProviderCandidate::new(provider, snapshot).unwrap()
    }

    #[test]
    fn browser_dom_beats_browser_uia_for_the_same_fresh_selection() {
        let result = arbitrate(
            &context("chrome.exe", 10_000),
            vec![
                candidate(
                    "browser-accessibility",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Bayesian optimization",
                    9_990,
                    false,
                ),
                candidate(
                    "browser-dom",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Bayesian optimization",
                    9_995,
                    true,
                ),
            ],
        );

        assert!(matches!(
            result,
            ArbitrationResult::Selected { candidate, .. } if candidate.provider_id == "browser-dom"
        ));
    }

    #[test]
    fn stale_dom_is_rejected_and_fresh_uia_wins() {
        let result = arbitrate(
            &context("chrome.exe", 20_000),
            vec![
                candidate(
                    "browser-dom",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Selection",
                    10_000,
                    true,
                ),
                candidate(
                    "browser-accessibility",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Selection",
                    19_990,
                    false,
                ),
            ],
        );

        match result {
            ArbitrationResult::Selected {
                candidate,
                rejected,
            } => {
                assert_eq!(candidate.provider_id, "browser-accessibility");
                assert_eq!(
                    rejected,
                    vec![RejectedCandidate {
                        provider_id: "browser-dom",
                        reason: RejectionReason::Stale,
                    }]
                );
            }
            other => panic!("unexpected arbitration result: {other:?}"),
        }
    }

    #[test]
    fn word_com_beats_generic_uia_for_the_same_word_selection() {
        let result = arbitrate(
            &context("WINWORD.EXE", 5_000),
            vec![
                candidate(
                    "generic-uia",
                    SelectionSourceKind::Word,
                    "WINWORD.EXE",
                    "Controller tuning",
                    4_990,
                    false,
                ),
                candidate(
                    "word-com",
                    SelectionSourceKind::Word,
                    "WINWORD.EXE",
                    "Controller tuning",
                    4_995,
                    true,
                ),
            ],
        );

        assert!(matches!(
            result,
            ArbitrationResult::Selected { candidate, .. } if candidate.provider_id == "word-com"
        ));
    }

    #[test]
    fn fresh_candidates_with_conflicting_text_fail_closed() {
        let result = arbitrate(
            &context("chrome.exe", 5_000),
            vec![
                candidate(
                    "browser-dom",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Selection A",
                    4_995,
                    true,
                ),
                candidate(
                    "browser-accessibility",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Selection B",
                    4_997,
                    false,
                ),
            ],
        );

        assert!(matches!(
            result,
            ArbitrationResult::Conflict { provider_ids, .. }
                if provider_ids == vec!["browser-accessibility", "browser-dom"]
        ));
    }

    #[test]
    fn foreground_mismatch_is_rejected_before_quality_scoring() {
        let result = arbitrate(
            &context("WINWORD.EXE", 5_000),
            vec![
                candidate(
                    "browser-dom",
                    SelectionSourceKind::Browser,
                    "chrome.exe",
                    "Wrong foreground",
                    4_999,
                    true,
                ),
                candidate(
                    "generic-uia",
                    SelectionSourceKind::Word,
                    "WINWORD.EXE",
                    "Correct foreground",
                    4_999,
                    false,
                ),
            ],
        );

        match result {
            ArbitrationResult::Selected {
                candidate,
                rejected,
            } => {
                assert_eq!(candidate.provider_id, "generic-uia");
                assert!(rejected.contains(&RejectedCandidate {
                    provider_id: "browser-dom",
                    reason: RejectionReason::ForegroundMismatch,
                }));
            }
            other => panic!("unexpected arbitration result: {other:?}"),
        }
    }

    #[test]
    fn pdf_specific_provider_beats_generic_uia() {
        let result = arbitrate(
            &context("msedge.exe", 5_000),
            vec![
                candidate(
                    "generic-uia",
                    SelectionSourceKind::Pdf,
                    "msedge.exe",
                    "PDF selection",
                    4_990,
                    false,
                ),
                candidate(
                    "pdf-accessibility",
                    SelectionSourceKind::Pdf,
                    "msedge.exe",
                    "PDF selection",
                    4_995,
                    true,
                ),
            ],
        );

        assert!(matches!(
            result,
            ArbitrationResult::Selected { candidate, .. } if candidate.provider_id == "pdf-accessibility"
        ));
    }
}
