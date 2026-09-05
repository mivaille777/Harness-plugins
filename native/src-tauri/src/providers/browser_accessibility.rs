use std::time::{SystemTime, UNIX_EPOCH};

use crate::protocol::{
    SelectionCapabilities, SelectionContext, SelectionDocument, SelectionGeometry,
    SelectionSnapshot, SelectionSource, SelectionSourceKind, SelectionValue,
};
use crate::providers::{ProviderCapture, SelectionProvider};

const PROVIDER_ID: &str = "browser-accessibility";
const DEFAULT_CONTEXT_CHARS: i32 = 900;
const MAX_ANCESTOR_DEPTH: usize = 24;
const MAX_FALLBACK_NODES: usize = 400;

#[derive(Debug, Clone)]
pub struct BrowserAccessibilityProvider {
    context_chars: i32,
    #[cfg(windows)]
    automation: uiautomation::UIAutomation,
}

impl BrowserAccessibilityProvider {
    pub fn standard() -> Result<Self, String> {
        Self::new(DEFAULT_CONTEXT_CHARS)
    }

    pub fn new(context_chars: i32) -> Result<Self, String> {
        if context_chars <= 0 {
            return Err("browser accessibility context_chars must be greater than zero".to_owned());
        }

        #[cfg(windows)]
        let automation = uiautomation::UIAutomation::new().map_err(|error| error.to_string())?;

        Ok(Self {
            context_chars,
            #[cfg(windows)]
            automation,
        })
    }
}

impl SelectionProvider for BrowserAccessibilityProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn capture(&self) -> Result<ProviderCapture, String> {
        #[cfg(windows)]
        {
            return windows_impl::capture(&self.automation, self.context_chars);
        }

        #[cfg(not(windows))]
        {
            Ok(ProviderCapture::NotApplicable)
        }
    }
}

fn clean_context(value: String) -> Option<String> {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

fn browser_identity(window_title: &str) -> (&'static str, Option<&'static str>) {
    let lower = window_title.to_ascii_lowercase();
    if lower.contains("microsoft edge") {
        ("Microsoft Edge", Some("msedge.exe"))
    } else if lower.contains("google chrome") {
        ("Google Chrome", Some("chrome.exe"))
    } else if lower.contains("brave") {
        ("Brave", Some("brave.exe"))
    } else {
        ("Chromium Browser", None)
    }
}

fn document_title_from_window(window_title: &str) -> Option<String> {
    let suffixes = [" - Google Chrome", " - Microsoft Edge", " - Brave"];
    let trimmed = suffixes
        .iter()
        .find_map(|suffix| window_title.strip_suffix(suffix))
        .unwrap_or(window_title)
        .trim();
    (!trimmed.is_empty()).then_some(trimmed.to_owned())
}

fn looks_like_url(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("http://")
        || value.starts_with("https://")
        || value.starts_with("file://")
        || value.starts_with("chrome://")
        || value.starts_with("edge://")
}

fn source_kind(url: Option<&str>) -> SelectionSourceKind {
    match url {
        Some(value) if value.to_ascii_lowercase().contains(".pdf") => SelectionSourceKind::Pdf,
        _ => SelectionSourceKind::Browser,
    }
}

fn confidence(
    local_context: bool,
    section_context: bool,
    heading: bool,
    url: bool,
    title: bool,
    geometry: bool,
) -> f64 {
    let mut score: f64 = 0.40;
    if local_context {
        score += 0.15;
    }
    if section_context {
        score += 0.10;
    }
    if heading {
        score += 0.10;
    }
    if url {
        score += 0.10;
    }
    if title {
        score += 0.08;
    }
    if geometry {
        score += 0.05;
    }
    score.min(0.98)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use uiautomation::controls::ControlType;
    use uiautomation::patterns::{UITextPattern, UITextRange, UIValuePattern};
    use uiautomation::types::{HeadingLevel, TextPatternRangeEndpoint, TextUnit};
    use uiautomation::{UIAutomation, UIElement, UITreeWalker};

    pub(super) fn capture(
        automation: &UIAutomation,
        context_chars: i32,
    ) -> Result<ProviderCapture, String> {
        let walker = automation
            .get_control_view_walker()
            .map_err(|error| error.to_string())?;
        let focused = automation
            .get_focused_element()
            .map_err(|error| error.to_string())?;

        let Some(browser_window) = find_browser_window(&focused, &walker) else {
            return Ok(ProviderCapture::NotApplicable);
        };

        let selected = find_selected_range(&focused, &walker).or_else(|| {
            let mut visited = 0usize;
            search_selected_range(&browser_window, &walker, &mut visited)
        });
        let Some((range, selected_text, text_provider)) = selected else {
            return Ok(ProviderCapture::NoSelection);
        };

        let before = context_before(&range, context_chars);
        let after = context_after(&range, context_chars);
        let paragraph = paragraph_text(&range);
        let enclosing = range.get_enclosing_element().ok();
        let heading = enclosing
            .as_ref()
            .and_then(|element| nearest_heading(element, &walker));
        let document_title = find_document_title(&text_provider, &walker)
            .or_else(|| document_title_from_window(&browser_window.get_name().unwrap_or_default()));
        let url = find_address_bar_url(&browser_window, &walker);
        let geometry = enclosing.as_ref().and_then(element_geometry);

        let window_title = browser_window.get_name().unwrap_or_default();
        let (app, process_name) = browser_identity(&window_title);
        let process_id = focused.get_process_id().unwrap_or_default();
        let local_context = before.is_some() || after.is_some();
        let section_context = paragraph.is_some() || heading.is_some();
        let has_heading = heading.is_some();
        let has_url = url.is_some();
        let has_title = document_title.is_some();
        let has_geometry = geometry.is_some();
        let confidence_value = confidence(
            local_context,
            section_context,
            has_heading,
            has_url,
            has_title,
            has_geometry,
        );
        let captured_at = now_millis();

        let snapshot = SelectionSnapshot {
            id: format!("browser-uia-{process_id}-{captured_at}"),
            revision: 1,
            captured_at,
            selection: SelectionValue {
                text: selected_text,
                language: None,
            },
            source: SelectionSource {
                kind: source_kind(url.as_deref()),
                app: Some(app.to_owned()),
                process: process_name.map(str::to_owned),
                window_title: clean_context(window_title),
            },
            document: Some(SelectionDocument {
                title: document_title,
                url,
                file_path: None,
                section: heading,
                frame_url: None,
            }),
            context: SelectionContext {
                before,
                after,
                section_text: paragraph,
                page_available: false,
            },
            capabilities: SelectionCapabilities {
                local_context,
                section_context,
                page_context: false,
                screenshot: false,
            },
            geometry,
            provider: PROVIDER_ID.to_owned(),
            confidence: confidence_value,
        };

        snapshot.validate().map_err(|error| error.to_string())?;
        Ok(ProviderCapture::Captured(snapshot))
    }

    fn find_browser_window(focused: &UIElement, walker: &UITreeWalker) -> Option<UIElement> {
        let mut current = focused.clone();
        let mut candidate = None;
        for _ in 0..MAX_ANCESTOR_DEPTH {
            let class_name = current.get_classname().unwrap_or_default();
            if class_name.starts_with("Chrome_WidgetWin_") {
                candidate = Some(current.clone());
            }
            match walker.get_parent(&current) {
                Ok(parent) => current = parent,
                Err(_) => break,
            }
        }
        candidate
    }

    fn find_selected_range(
        focused: &UIElement,
        walker: &UITreeWalker,
    ) -> Option<(UITextRange, String, UIElement)> {
        let mut current = focused.clone();
        for _ in 0..MAX_ANCESTOR_DEPTH {
            if let Some(found) = selected_range_from_element(&current) {
                return Some((found.0, found.1, current));
            }
            current = walker.get_parent(&current).ok()?;
        }
        None
    }

    fn search_selected_range(
        element: &UIElement,
        walker: &UITreeWalker,
        visited: &mut usize,
    ) -> Option<(UITextRange, String, UIElement)> {
        if *visited >= MAX_FALLBACK_NODES {
            return None;
        }
        *visited += 1;
        if let Some(found) = selected_range_from_element(element) {
            return Some((found.0, found.1, element.clone()));
        }

        let mut child = walker.get_first_child(element).ok();
        while let Some(current) = child {
            if let Some(found) = search_selected_range(&current, walker, visited) {
                return Some(found);
            }
            if *visited >= MAX_FALLBACK_NODES {
                return None;
            }
            child = walker.get_next_sibling(&current).ok();
        }
        None
    }

    fn selected_range_from_element(element: &UIElement) -> Option<(UITextRange, String)> {
        let pattern = element.get_pattern::<UITextPattern>().ok()?;
        let ranges = pattern.get_selection().ok()?;
        ranges.into_iter().find_map(|range| {
            let text = range.get_text(-1).ok()?;
            (!text.trim().is_empty()).then_some((range, text))
        })
    }

    fn context_before(selection: &UITextRange, limit: i32) -> Option<String> {
        let range = selection.clone();
        range
            .move_endpoint_by_range(
                TextPatternRangeEndpoint::End,
                selection,
                TextPatternRangeEndpoint::Start,
            )
            .ok()?;
        range
            .move_endpoint_by_unit(TextPatternRangeEndpoint::Start, TextUnit::Character, -limit)
            .ok()?;
        clean_context(range.get_text(-1).ok()?)
    }

    fn context_after(selection: &UITextRange, limit: i32) -> Option<String> {
        let range = selection.clone();
        range
            .move_endpoint_by_range(
                TextPatternRangeEndpoint::Start,
                selection,
                TextPatternRangeEndpoint::End,
            )
            .ok()?;
        range
            .move_endpoint_by_unit(TextPatternRangeEndpoint::End, TextUnit::Character, limit)
            .ok()?;
        clean_context(range.get_text(-1).ok()?)
    }

    fn paragraph_text(selection: &UITextRange) -> Option<String> {
        let range = selection.clone();
        range.expand_to_enclosing_unit(TextUnit::Paragraph).ok()?;
        clean_context(range.get_text(-1).ok()?)
    }

    fn nearest_heading(element: &UIElement, walker: &UITreeWalker) -> Option<String> {
        let mut current = element.clone();
        for _ in 0..12 {
            if let Some(value) = heading_name(&current) {
                return Some(value);
            }

            let mut sibling = walker.get_previous_sibling(&current).ok();
            for _ in 0..12 {
                let Some(candidate) = sibling else { break };
                if let Some(value) = heading_name(&candidate) {
                    return Some(value);
                }
                if let Some(value) = last_heading_descendant(&candidate, walker, 0) {
                    return Some(value);
                }
                sibling = walker.get_previous_sibling(&candidate).ok();
            }

            current = walker.get_parent(&current).ok()?;
        }
        None
    }

    fn heading_name(element: &UIElement) -> Option<String> {
        let heading = element.get_heading_level().ok()?;
        if heading == HeadingLevel::HeadingLevelNone {
            return None;
        }
        clean_context(element.get_name().ok()?)
    }

    fn last_heading_descendant(
        element: &UIElement,
        walker: &UITreeWalker,
        depth: usize,
    ) -> Option<String> {
        if depth >= 3 {
            return None;
        }
        let mut child = walker.get_last_child(element).ok();
        while let Some(candidate) = child {
            if let Some(value) = heading_name(&candidate) {
                return Some(value);
            }
            if let Some(value) = last_heading_descendant(&candidate, walker, depth + 1) {
                return Some(value);
            }
            child = walker.get_previous_sibling(&candidate).ok();
        }
        None
    }

    fn find_document_title(element: &UIElement, walker: &UITreeWalker) -> Option<String> {
        let mut current = element.clone();
        for _ in 0..MAX_ANCESTOR_DEPTH {
            if current.get_control_type().ok() == Some(ControlType::Document) {
                if let Some(name) = current.get_name().ok().and_then(clean_context) {
                    return Some(name);
                }
            }
            current = walker.get_parent(&current).ok()?;
        }
        None
    }

    fn find_address_bar_url(browser_window: &UIElement, walker: &UITreeWalker) -> Option<String> {
        let window_rect = browser_window.get_bounding_rectangle().ok();
        let mut visited = 0usize;
        find_url_recursive(
            browser_window,
            walker,
            window_rect.as_ref(),
            0,
            &mut visited,
        )
    }

    fn find_url_recursive(
        element: &UIElement,
        walker: &UITreeWalker,
        window_rect: Option<&uiautomation::types::Rect>,
        depth: usize,
        visited: &mut usize,
    ) -> Option<String> {
        if depth > 7 || *visited >= 300 {
            return None;
        }
        *visited += 1;

        if element.get_control_type().ok() == Some(ControlType::Edit)
            && is_near_browser_chrome(element, window_rect)
        {
            if let Ok(pattern) = element.get_pattern::<UIValuePattern>() {
                if let Ok(value) = pattern.get_value() {
                    let value = value.trim();
                    if looks_like_url(value) {
                        return Some(value.to_owned());
                    }
                }
            }
        }

        let mut child = walker.get_first_child(element).ok();
        while let Some(current) = child {
            if let Some(url) = find_url_recursive(&current, walker, window_rect, depth + 1, visited)
            {
                return Some(url);
            }
            child = walker.get_next_sibling(&current).ok();
        }
        None
    }

    fn is_near_browser_chrome(
        element: &UIElement,
        window_rect: Option<&uiautomation::types::Rect>,
    ) -> bool {
        let Some(window) = window_rect else {
            return true;
        };
        let Ok(rect) = element.get_bounding_rectangle() else {
            return false;
        };
        let top_band = window.get_top() + (window.get_height().max(1) / 3).min(240);
        rect.get_top() >= window.get_top() && rect.get_top() <= top_band
    }

    fn element_geometry(element: &UIElement) -> Option<SelectionGeometry> {
        // uiautomation 0.16 does not wrap TextRange.GetBoundingRectangles.
        // Use the enclosing accessibility element as a conservative screen-space
        // anchor. Task 6 can refine the exact selection range rectangle without
        // changing SelectionSnapshot or the provider seam.
        let rect = element.get_bounding_rectangle().ok()?;
        let width = rect.get_width();
        let height = rect.get_height();
        if width <= 0 || height <= 0 {
            return None;
        }
        Some(SelectionGeometry {
            monitor_id: None,
            x: rect.get_left() as f64,
            y: rect.get_top() as f64,
            width: width as f64,
            height: height as f64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_positive_context_limits() {
        assert!(BrowserAccessibilityProvider::new(0).is_err());
    }

    #[test]
    fn recognizes_browser_titles_without_localized_address_bar_names() {
        assert_eq!(browser_identity("Paper - Google Chrome").0, "Google Chrome");
        assert_eq!(
            browser_identity("Paper - Microsoft Edge").0,
            "Microsoft Edge"
        );
        assert_eq!(browser_identity("Paper - Brave").0, "Brave");
    }

    #[test]
    fn strips_known_browser_suffixes_from_document_title() {
        assert_eq!(
            document_title_from_window("Safe Bayesian Optimization - Google Chrome").as_deref(),
            Some("Safe Bayesian Optimization")
        );
    }

    #[test]
    fn url_detection_is_scheme_based_and_locale_independent() {
        assert!(looks_like_url("https://example.com/paper"));
        assert!(looks_like_url("edge://settings"));
        assert!(!looks_like_url("Search Google or type a URL"));
    }

    #[test]
    fn confidence_reflects_available_context() {
        let minimal = confidence(false, false, false, false, false, false);
        let rich = confidence(true, true, true, true, true, true);
        assert!(minimal < rich);
        assert!(rich <= 0.98);
    }
}
