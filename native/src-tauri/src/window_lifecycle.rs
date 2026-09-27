use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowLifecycleStatus {
    pub created_count: u64,
    pub destroyed_count: u64,
    pub active_count: u64,
}

pub struct WindowLifecycleMetrics {
    created_count: AtomicU64,
    destroyed_count: AtomicU64,
    active_count: AtomicU64,
}

impl WindowLifecycleMetrics {
    pub fn with_initial_windows(initial_window_count: usize) -> Self {
        let initial_window_count = initial_window_count as u64;
        Self {
            created_count: AtomicU64::new(initial_window_count),
            destroyed_count: AtomicU64::new(0),
            active_count: AtomicU64::new(initial_window_count),
        }
    }

    /// Record windows built after startup when future code adds dynamic windows.
    pub fn record_created(&self) {
        self.created_count.fetch_add(1, Ordering::Relaxed);
        self.active_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_destroyed(&self) {
        self.destroyed_count.fetch_add(1, Ordering::Relaxed);
        let _ = self
            .active_count
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |active| {
                Some(active.saturating_sub(1))
            });
    }

    fn status(&self) -> WindowLifecycleStatus {
        WindowLifecycleStatus {
            created_count: self.created_count.load(Ordering::Relaxed),
            destroyed_count: self.destroyed_count.load(Ordering::Relaxed),
            active_count: self.active_count.load(Ordering::Relaxed),
        }
    }
}

#[tauri::command]
pub fn runtime_window_lifecycle_status(
    metrics: State<'_, WindowLifecycleMetrics>,
) -> WindowLifecycleStatus {
    metrics.status()
}

#[cfg(test)]
mod tests {
    use super::WindowLifecycleMetrics;

    #[test]
    fn starts_with_windows_created_by_the_tauri_configuration() {
        let metrics = WindowLifecycleMetrics::with_initial_windows(2);

        assert_eq!(metrics.status().created_count, 2);
        assert_eq!(metrics.status().destroyed_count, 0);
        assert_eq!(metrics.status().active_count, 2);
    }

    #[test]
    fn tracks_dynamic_creation_and_destruction_without_counting_visibility_changes() {
        let metrics = WindowLifecycleMetrics::with_initial_windows(2);
        metrics.record_created();
        metrics.record_destroyed();
        metrics.record_destroyed();

        assert_eq!(metrics.status().created_count, 3);
        assert_eq!(metrics.status().destroyed_count, 2);
        assert_eq!(metrics.status().active_count, 1);
    }

    #[test]
    fn repeated_destruction_does_not_underflow_active_count() {
        let metrics = WindowLifecycleMetrics::with_initial_windows(0);
        metrics.record_destroyed();

        assert_eq!(metrics.status().destroyed_count, 1);
        assert_eq!(metrics.status().active_count, 0);
    }
}
