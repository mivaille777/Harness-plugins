use dsh_selection_companion_native::{
    bridge::DEFAULT_PIPE_NAME,
    protocol::{IpcMessage, SelectionMaterial, IPC_PROTOCOL_VERSION},
};
use serde_json::{json, Value};

fn material(scope: &str, completeness: &str, truncated: Option<bool>, context: Option<Value>) -> SelectionMaterial {
    let mut value = json!({
        "snapshotId": "snapshot-ec02-rust",
        "revision": 8,
        "capturedAt": 1_700_000_000_000u64,
        "selection": { "text": "Fixed Rust selection." },
        "source": { "kind": "browser", "app": "Chrome" },
        "document": { "title": "EC02 Rust fixture", "url": "https://example.test/rust" },
        "authorizedScope": scope,
        "actualScope": scope,
        "completeness": completeness
    });
    if let Some(truncated) = truncated {
        value["truncated"] = json!(truncated);
    }
    if let Some(context) = context {
        value["context"] = context;
    }
    serde_json::from_value(value).expect("fixture must deserialize as SelectionMaterial")
}

#[test]
fn protocol_and_default_pipe_are_version_four() {
    assert_eq!(IPC_PROTOCOL_VERSION, 4);
    assert_eq!(DEFAULT_PIPE_NAME, r"\\.\pipe\dsh-selection-companion-v4");
}

#[test]
fn accepts_all_canonical_material_scopes() {
    let fixtures = [
        material("selection", "complete", None, None),
        material(
            "local",
            "partial",
            Some(true),
            Some(json!({ "before": "before", "after": "after" })),
        ),
        material(
            "section",
            "complete",
            Some(false),
            Some(json!({ "sectionText": "section body" })),
        ),
        material(
            "page",
            "partial",
            Some(true),
            Some(json!({ "pageText": "page body" })),
        ),
    ];

    for fixture in fixtures {
        fixture.validate().expect("canonical V4 material must validate");
    }
}

#[test]
fn allows_actual_scope_to_be_narrower_than_authorization() {
    let material: SelectionMaterial = serde_json::from_value(json!({
        "snapshotId": "snapshot-fallback",
        "revision": 1,
        "capturedAt": 1_000,
        "selection": { "text": "fixed" },
        "source": { "kind": "browser" },
        "authorizedScope": "page",
        "actualScope": "section",
        "completeness": "partial",
        "truncated": true,
        "context": { "sectionText": "bounded fallback" }
    }))
    .unwrap();

    material.validate().expect("bounded fallback must remain within authorization");
}

#[test]
fn rejects_scope_escalation_and_context_smuggling() {
    let invalid = [
        json!({
            "snapshotId": "scope-escalation",
            "revision": 1,
            "capturedAt": 1_000,
            "selection": { "text": "fixed" },
            "source": { "kind": "browser" },
            "authorizedScope": "local",
            "actualScope": "page",
            "completeness": "complete",
            "context": { "pageText": "must not pass" }
        }),
        json!({
            "snapshotId": "selection-smuggling",
            "revision": 1,
            "capturedAt": 1_000,
            "selection": { "text": "fixed" },
            "source": { "kind": "browser" },
            "authorizedScope": "selection",
            "actualScope": "selection",
            "completeness": "complete",
            "context": { "pageText": "must not pass" }
        }),
        json!({
            "snapshotId": "local-smuggling",
            "revision": 1,
            "capturedAt": 1_000,
            "selection": { "text": "fixed" },
            "source": { "kind": "browser" },
            "authorizedScope": "local",
            "actualScope": "local",
            "completeness": "complete",
            "context": { "before": "ok", "sectionText": "must not pass" }
        }),
    ];

    for value in invalid {
        let material: SelectionMaterial = serde_json::from_value(value).unwrap();
        assert!(material.validate().is_err());
    }
}

#[test]
fn rejects_v3_before_payload_dispatch() {
    let message = json!({
        "protocol": 3,
        "id": "legacy-v3",
        "type": "bridge.ping",
        "payload": { "sentAt": 1 }
    });
    assert!(IpcMessage::from_json(&message.to_string()).is_err());
}
