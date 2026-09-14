use serde_json::Value;

use crate::protocol::{SelectionMaterial, SelectionSnapshot};

/// Normalize the Tauri command boundary onto Protocol V4 canonical material.
///
/// New Lens requests send SelectionMaterial directly. A legacy SelectionSnapshot
/// is accepted only as a compatibility fallback and is projected to the exact
/// selection-only material that older callers already produced. Local filesystem
/// paths are stripped before any material can cross the named-pipe boundary.
pub fn normalize_submission_material(value: Value) -> Result<SelectionMaterial, String> {
    if let Ok(mut material) = serde_json::from_value::<SelectionMaterial>(value.clone()) {
        if let Some(document) = material.document.as_mut() {
            document.file_path = None;
        }
        material.validate().map_err(|error| error.to_string())?;
        return Ok(material);
    }

    let snapshot: SelectionSnapshot = serde_json::from_value(value)
        .map_err(|error| format!("invalid submission material: {error}"))?;
    snapshot.validate().map_err(|error| error.to_string())?;
    let material = SelectionMaterial::from_snapshot(&snapshot);
    material.validate().map_err(|error| error.to_string())?;
    Ok(material)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_explicitly_authorized_canonical_material_and_strips_local_paths() {
        let source = serde_json::json!({
            "snapshotId": "snapshot-canonical",
            "revision": 5,
            "capturedAt": 1_000,
            "selection": { "text": "fixed selection" },
            "source": { "kind": "browser", "app": "Chrome" },
            "document": {
                "title": "Fixture",
                "url": "https://example.test",
                "filePath": "C:/private/canonical.html"
            },
            "authorizedScope": "local",
            "actualScope": "local",
            "completeness": "partial",
            "truncated": true,
            "context": {
                "before": "AUTHORIZED_BEFORE_SENTINEL",
                "after": "AUTHORIZED_AFTER_SENTINEL"
            }
        });

        let material = normalize_submission_material(source).unwrap();
        let serialized = serde_json::to_value(material).unwrap();
        assert_eq!(serialized["authorizedScope"], "local");
        assert_eq!(serialized["actualScope"], "local");
        assert_eq!(
            serialized["context"]["before"],
            "AUTHORIZED_BEFORE_SENTINEL"
        );
        assert_eq!(serialized["truncated"], true);
        assert!(serialized["document"]["filePath"].is_null());
    }

    #[test]
    fn converts_legacy_snapshot_to_selection_only_material() {
        let source = serde_json::json!({
            "id": "snapshot-legacy",
            "revision": 2,
            "capturedAt": 2_000,
            "selection": { "text": "legacy selection" },
            "source": { "kind": "browser", "app": "Chrome" },
            "document": {
                "title": "Legacy fixture",
                "url": "https://example.test/legacy",
                "filePath": "C:/private/legacy.html"
            },
            "context": {
                "before": "captured but not authorized",
                "after": null,
                "sectionText": null,
                "pageText": null,
                "pageAvailable": false
            },
            "capabilities": {
                "localContext": true,
                "sectionContext": false,
                "pageContext": false,
                "screenshot": false
            },
            "provider": "legacy-fixture",
            "confidence": 1.0
        });

        let material = normalize_submission_material(source).unwrap();
        let serialized = serde_json::to_value(material).unwrap();
        assert_eq!(serialized["authorizedScope"], "selection");
        assert_eq!(serialized["actualScope"], "selection");
        assert!(serialized.get("context").is_none());
        assert!(serialized["document"]["filePath"].is_null());
    }

    #[test]
    fn rejects_invalid_material_instead_of_widening_it() {
        let source = serde_json::json!({
            "snapshotId": "snapshot-invalid",
            "revision": 1,
            "capturedAt": 1,
            "selection": { "text": "fixed selection" },
            "source": { "kind": "browser" },
            "authorizedScope": "local",
            "actualScope": "page",
            "completeness": "complete",
            "context": { "pageText": "must not pass" }
        });

        assert!(normalize_submission_material(source).is_err());
    }
}
