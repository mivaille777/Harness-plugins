use dsh_selection_companion_native::protocol::IpcMessage;
use std::fs::{read_dir, read_to_string};
use std::path::{Path, PathBuf};

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("protocol")
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = read_dir(dir)
        .unwrap_or_else(|error| panic!("cannot read fixture directory {}: {error}", dir.display()))
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file() && path.extension().and_then(|extension| extension.to_str()) == Some("json")
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

#[test]
fn every_shared_golden_fixture_matches_the_rust_v4_contract() {
    let root = fixture_root();
    let files = json_files(&root);
    assert!(!files.is_empty(), "shared protocol fixture set must not be empty");

    for path in files {
        let source = read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read fixture {}: {error}", path.display()));
        IpcMessage::from_json(&source)
            .unwrap_or_else(|error| panic!("fixture {} violated the Rust contract: {error}", path.display()));
    }
}

#[test]
fn every_shared_invalid_fixture_is_rejected_by_the_rust_v4_contract() {
    let dir = fixture_root().join("invalid");
    let files = json_files(&dir);
    assert!(!files.is_empty(), "shared invalid protocol fixture set must not be empty");

    for path in files {
        let source = read_to_string(&path)
            .unwrap_or_else(|error| panic!("cannot read invalid fixture {}: {error}", path.display()));
        assert!(
            IpcMessage::from_json(&source).is_err(),
            "invalid fixture unexpectedly matched the Rust contract: {}",
            path.display(),
        );
    }
}
