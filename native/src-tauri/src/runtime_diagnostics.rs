use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryStatus {
    pub available: bool,
    pub working_set_bytes: Option<u64>,
    pub private_bytes: Option<u64>,
    pub error: Option<String>,
}

#[tauri::command]
pub fn runtime_memory_status() -> ProcessMemoryStatus {
    current_process_memory_status()
}

#[cfg(windows)]
fn current_process_memory_status() -> ProcessMemoryStatus {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    let mut counters = PROCESS_MEMORY_COUNTERS_EX::default();
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
    let succeeded = unsafe {
        K32GetProcessMemoryInfo(
            GetCurrentProcess(),
            (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            counters.cb,
        )
    };

    if succeeded == 0 {
        let error_code = unsafe { GetLastError() };
        return ProcessMemoryStatus {
            available: false,
            working_set_bytes: None,
            private_bytes: None,
            error: Some(format!("K32GetProcessMemoryInfo failed ({error_code})")),
        };
    }

    ProcessMemoryStatus {
        available: true,
        working_set_bytes: Some(counters.WorkingSetSize as u64),
        private_bytes: Some(counters.PrivateUsage as u64),
        error: None,
    }
}

#[cfg(not(windows))]
fn current_process_memory_status() -> ProcessMemoryStatus {
    ProcessMemoryStatus {
        available: false,
        working_set_bytes: None,
        private_bytes: None,
        error: Some("Process memory metrics are only available on Windows".to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::{current_process_memory_status, ProcessMemoryStatus};

    #[test]
    fn serializes_memory_status_with_typed_frontend_field_names() {
        let status = ProcessMemoryStatus {
            available: true,
            working_set_bytes: Some(1_024),
            private_bytes: Some(2_048),
            error: None,
        };
        let value = serde_json::to_value(status).expect("memory status should serialize");

        assert_eq!(value["available"], true);
        assert_eq!(value["workingSetBytes"], 1_024);
        assert_eq!(value["privateBytes"], 2_048);
        assert_eq!(value["error"], serde_json::Value::Null);
    }

    #[cfg(windows)]
    #[test]
    fn reports_current_process_memory() {
        let status = current_process_memory_status();

        assert!(status.available, "{}", status.error.unwrap_or_default());
        assert!(status.working_set_bytes.is_some_and(|bytes| bytes > 0));
        assert!(status.private_bytes.is_some_and(|bytes| bytes > 0));
        assert!(status.error.is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn reports_memory_metrics_as_unavailable_off_windows() {
        let status = current_process_memory_status();

        assert!(!status.available);
        assert!(status.working_set_bytes.is_none());
        assert!(status.private_bytes.is_none());
        assert!(status.error.is_some());
    }
}
