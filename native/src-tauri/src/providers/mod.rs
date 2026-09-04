pub mod browser_accessibility;

use crate::protocol::SelectionSnapshot;

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderCapture {
    Captured(SelectionSnapshot),
    NotApplicable,
    NoSelection,
}

pub trait SelectionProvider {
    fn id(&self) -> &'static str;
    fn capture(&self) -> Result<ProviderCapture, String>;
}
