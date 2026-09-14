use crate::protocol::SelectionSnapshot;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureTrigger {
    UiaEvent,
    FallbackPoll,
    DomPush,
    Manual,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureContext {
    pub trigger: CaptureTrigger,
    pub captured_at: u64,
    pub foreground_process: Option<String>,
    pub foreground_window: Option<u64>,
}

impl CaptureContext {
    pub fn new(trigger: CaptureTrigger, captured_at: u64) -> Self {
        Self {
            trigger,
            captured_at,
            foreground_process: None,
            foreground_window: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderCandidate {
    pub provider_id: &'static str,
    pub snapshot: SelectionSnapshot,
}

impl ProviderCandidate {
    pub fn new(provider_id: &'static str, snapshot: SelectionSnapshot) -> Result<Self, String> {
        if provider_id.trim().is_empty() {
            return Err("provider id must not be empty".to_owned());
        }
        snapshot.validate().map_err(|error| error.to_string())?;
        if snapshot.provider != provider_id {
            return Err(format!(
                "provider candidate identity mismatch: registry id {provider_id} != snapshot provider {}",
                snapshot.provider
            ));
        }
        Ok(Self {
            provider_id,
            snapshot,
        })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderAttempt {
    Candidate(ProviderCandidate),
    NoSelection {
        provider_id: &'static str,
    },
    NotApplicable {
        provider_id: &'static str,
    },
    Error {
        provider_id: &'static str,
        message: String,
    },
}

impl ProviderAttempt {
    pub fn provider_id(&self) -> &'static str {
        match self {
            Self::Candidate(candidate) => candidate.provider_id,
            Self::NoSelection { provider_id }
            | Self::NotApplicable { provider_id }
            | Self::Error { provider_id, .. } => provider_id,
        }
    }
}
