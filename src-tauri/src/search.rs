use crate::index::{Note, VaultIndex, INDEX_CHANGED_EVENT};
use crate::state::{locked, vault_of};
use crate::tasks::off_thread;
use crate::tree::FileEntry;
use crate::wiki::scan_index;
use regex::RegexBuilder;
use std::path::Path;
use std::sync::Arc;
use tauri::Emitter;

/// A line of a note that holds what was searched for.
#[derive(serde::Serialize, Debug, PartialEq)]
pub(crate) struct ContentHit {
    pub(crate) path: String,
    /// 1-based, as an editor counts lines.
    pub(crate) line: usize,
    /// Where the match starts in its line, in UTF-16 code units - the unit
    /// both JavaScript strings and CodeMirror positions are counted in.
    pub(crate) column: usize,
    /// The line, cut down around the match when it is long.
    pub(crate) preview: String,
    /// Where the match starts and how long it is, within `preview`, in UTF-16.
    #[serde(rename = "previewStart")]
    pub(crate) preview_start: usize,
    #[serde(rename = "matchLength")]
    pub(crate) match_length: usize,
}

/// The most hits one search returns: past this, the query wants narrowing.
pub(crate) const CONTENT_HIT_LIMIT: usize = 200;
/// The most hits one note contributes, so one long note cannot crowd out the rest.
pub(crate) const HITS_PER_NOTE: usize = 5;
/// How much of a line is shown before the match, and at most in all. Kept
/// short in front: the sidebar is narrow, and the row cuts the end off.
pub(crate) const PREVIEW_BEFORE: usize = 12;
pub(crate) const PREVIEW_LENGTH: usize = 120;
/// A pattern longer than this is a mistake, not a search.
const MAX_PATTERN_LENGTH: usize = 500;

pub(crate) fn utf16_len(chars: &[char]) -> usize {
    chars.iter().map(|c| c.len_utf16()).sum()
}

/// A character folded for comparison. Only characters whose lower case is a
/// single character are folded, so a match always spans as many characters
/// in the line as there are in the query.
pub(crate) fn fold(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(single), None) => single,
        _ => c,
    }
}

/// Where a match is in its line, counted in characters.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Span {
    pub(crate) start: usize,
    pub(crate) length: usize,
}

/// What a search looks for in a line.
pub(crate) enum Matcher {
    /// Plain text, ignoring case.
    Text {
        folded: Vec<char>,
        /// As typed, so a match in the same case can be told from one that is not.
        typed: Vec<char>,
        /// The folded query, when it is all ASCII - which is nearly always, and
        /// lets a line that is ASCII too be searched without being copied.
        ascii: Option<Vec<u8>>,
    },
    /// A regular expression, ignoring case.
    Pattern(regex::Regex),
}

impl Matcher {
    /// A plain-text matcher, or `None` for a query with nothing in it.
    pub(crate) fn text(query: &str) -> Option<Matcher> {
        let typed: Vec<char> = query.trim().chars().collect();
        if typed.is_empty() {
            return None;
        }
        let folded: Vec<char> = typed.iter().map(|&c| fold(c)).collect();
        let ascii = folded
            .iter()
            .all(char::is_ascii)
            .then(|| folded.iter().map(|&c| c as u8).collect());
        Some(Matcher::Text {
            folded,
            typed,
            ascii,
        })
    }

    /// A regular-expression matcher, or `None` for an empty pattern. Matched
    /// in time that grows with the line and not with the pattern's cleverness,
    /// which is what the `regex` crate promises - there is no pattern that
    /// hangs the app.
    pub(crate) fn pattern(pattern: &str) -> Result<Option<Matcher>, String> {
        if pattern.trim().is_empty() {
            return Ok(None);
        }
        if pattern.chars().count() > MAX_PATTERN_LENGTH {
            return Err("That pattern is too long".to_string());
        }
        RegexBuilder::new(pattern)
            .case_insensitive(true)
            .size_limit(1 << 20)
            .build()
            .map(|regex| Some(Matcher::Pattern(regex)))
            .map_err(|_| "Not a valid regular expression".to_string())
    }

    /// Where the first match in `line` is, if there is one.
    pub(crate) fn find(&self, line: &str) -> Option<Span> {
        match self {
            Matcher::Text { folded, ascii, .. } => {
                if let (Some(query), true) = (ascii, line.is_ascii()) {
                    let start = find_ascii(line.as_bytes(), query)?;
                    return Some(Span {
                        start,
                        length: query.len(),
                    });
                }
                let chars: Vec<char> = line.chars().map(fold).collect();
                if chars.len() < folded.len() {
                    return None;
                }
                let start = chars
                    .windows(folded.len())
                    .position(|window| window == folded.as_slice())?;
                Some(Span {
                    start,
                    length: folded.len(),
                })
            }
            Matcher::Pattern(regex) => {
                // An empty match - `^`, `x*` - is not something to show.
                let found = regex.find_iter(line).find(|found| !found.is_empty())?;
                Some(Span {
                    start: line[..found.start()].chars().count(),
                    length: line[found.start()..found.end()].chars().count(),
                })
            }
        }
    }

    /// Whether `text` holds what was typed in the case it was typed in.
    fn typed_as(&self, chars: &[char], span: Span) -> bool {
        match self {
            Matcher::Text { typed, .. } => chars[span.start..span.start + span.length] == typed[..],
            Matcher::Pattern(_) => false,
        }
    }

    /// Whether a name holds what was typed - for a note whose name matches,
    /// whatever its text does.
    fn matches_name(&self, name: &str) -> bool {
        match self {
            Matcher::Text { .. } => self.find(name).is_some(),
            Matcher::Pattern(_) => false,
        }
    }
}

/// The first place `needle` (already lower case) is in `haystack`, ignoring
/// ASCII case, as an offset in bytes - which for ASCII is also in characters.
fn find_ascii(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    let first = needle[0];
    (0..=haystack.len() - needle.len()).find(|&at| {
        haystack[at].to_ascii_lowercase() == first
            && haystack[at + 1..at + needle.len()]
                .iter()
                .zip(&needle[1..])
                .all(|(have, want)| have.to_ascii_lowercase() == *want)
    })
}

/// A line that matched, not yet turned into a hit.
struct Candidate<'a> {
    index: usize,
    line: &'a str,
    span: Span,
    score: i32,
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// How relevant a match is: higher is better. A match that starts a word, is
/// the whole word, is in the case it was typed in, is in a heading, comes early
/// and is in a short line outranks one buried mid-word in a long paragraph -
/// the same things that make a filename match convincing in quick-open.
fn relevance(matcher: &Matcher, chars: &[char], line: &str, span: Span) -> i32 {
    let end = span.start + span.length;
    let starts_word = span.start == 0 || !is_word(chars[span.start - 1]);
    let ends_word = end >= chars.len() || !is_word(chars[end]);

    let mut score = 0;
    if starts_word {
        score += 60;
        if ends_word {
            score += 40;
        }
    }
    if matcher.typed_as(chars, span) {
        score += 30;
    }
    if line.trim_start().starts_with('#') {
        score += 50;
    }
    score -= span.start.min(50) as i32;
    score -= (chars.len() / 4).min(30) as i32;
    score
}

fn preview_of(chars: &[char], span: Span) -> (String, usize) {
    let from = span.start.saturating_sub(PREVIEW_BEFORE);
    let to = (from + PREVIEW_LENGTH)
        .max(span.start + span.length)
        .min(chars.len());
    let mut preview = String::new();
    let mut preview_start = utf16_len(&chars[from..span.start]);
    if from > 0 {
        preview.push('\u{2026}');
        preview_start += 1;
    }
    preview.extend(&chars[from..to]);
    if to < chars.len() {
        preview.push('\u{2026}');
    }
    (preview, preview_start)
}

/// Every line of `text` that `matcher` finds something in, with how relevant
/// each is.
fn candidates<'a>(text: &'a str, matcher: &Matcher) -> Vec<Candidate<'a>> {
    let mut found = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let Some(span) = matcher.find(line) else {
            continue;
        };
        let chars: Vec<char> = line.chars().collect();
        let score = relevance(matcher, &chars, line, span);
        found.push(Candidate {
            index,
            line,
            span,
            score,
        });
    }
    found
}

fn hit_for(path: &str, candidate: &Candidate) -> ContentHit {
    let chars: Vec<char> = candidate.line.chars().collect();
    let span = candidate.span;
    let (preview, preview_start) = preview_of(&chars, span);
    ContentHit {
        path: path.to_string(),
        line: candidate.index + 1,
        column: utf16_len(&chars[..span.start]),
        preview,
        preview_start,
        match_length: utf16_len(&chars[span.start..span.start + span.length]),
    }
}

#[cfg(test)]
/// The first `limit` places in `text` that `matcher` finds, in the order they
/// are written. For when the order of the page is the one that matters.
pub(crate) fn search_text(
    path: &str,
    text: &str,
    matcher: &Matcher,
    limit: usize,
) -> Vec<ContentHit> {
    candidates(text, matcher)
        .iter()
        .take(limit)
        .map(|candidate| hit_for(path, candidate))
        .collect()
}

/// The best hits across `notes`, most relevant first.
///
/// Every note is read through for every query - from memory, now, so this is
/// the cost of scanning text and not of reading files - and each contributes
/// its best few lines rather than its first few. A note whose name holds the
/// query is lifted above one that merely mentions it.
pub(crate) fn search_notes(notes: &[Note], matcher: &Matcher) -> Vec<ContentHit> {
    let mut ranked: Vec<(i32, ContentHit)> = Vec::new();

    for note in notes {
        let mut found = candidates(&note.text, matcher);
        if found.is_empty() {
            continue;
        }
        let lift = if matcher.matches_name(&note.name) {
            80
        } else {
            0
        };
        for candidate in &mut found {
            candidate.score += lift;
        }
        // Best first, and the earlier line when two are as good.
        found.sort_by(|a, b| b.score.cmp(&a.score).then(a.index.cmp(&b.index)));
        found.truncate(HITS_PER_NOTE);
        ranked.extend(
            found
                .iter()
                .map(|candidate| (candidate.score, hit_for(&note.path, candidate))),
        );
    }

    ranked.sort_by(|(a, hit_a), (b, hit_b)| {
        b.cmp(a)
            .then_with(|| hit_a.path.cmp(&hit_b.path))
            .then_with(|| hit_a.line.cmp(&hit_b.line))
    });
    ranked.truncate(CONTENT_HIT_LIMIT);
    ranked.into_iter().map(|(_, hit)| hit).collect()
}

/// Searches the text of every note in `index` for `query`, ignoring case, best
/// match first. With `pattern`, `query` is a regular expression.
pub(crate) fn search_index(
    index: &VaultIndex,
    query: &str,
    pattern: bool,
) -> Result<Vec<ContentHit>, String> {
    let matcher = if pattern {
        Matcher::pattern(query)?
    } else {
        Matcher::text(query)
    };
    let Some(matcher) = matcher else {
        return Ok(Vec::new());
    };
    Ok(search_notes(&index.notes(), &matcher))
}

#[cfg(test)]
/// Searches the text of every note under `root` for `query`, ignoring case.
///
/// The notes are the ones the sidebar lists - the same walk, with the same
/// folders left out and the same rules for symlinks - so a hit is never in a
/// note the tree does not show.
pub(crate) fn search_vault(root: &Path, query: &str) -> Result<Vec<ContentHit>, String> {
    search_index(&*VaultIndex::for_folder(root)?, query, false)
}

/// Every `#tag` written in the open vault, for the sidebar's list of them.
#[tauri::command]
pub(crate) async fn list_tags(
    window: tauri::WebviewWindow,
) -> Result<Vec<crate::tags::TagRef>, String> {
    off_thread(move || {
        let index = vault_of(&window).index.clone();
        Ok(scan_index(&index, crate::tags::tags_in))
    })
    .await
}

/// The title each note in the open vault gives itself, for the sidebar to show
/// in place of file names.
#[tauri::command]
pub(crate) async fn list_titles(
    window: tauri::WebviewWindow,
) -> Result<Vec<crate::titles::NoteTitle>, String> {
    off_thread(move || {
        let index = vault_of(&window).index.clone();
        Ok(scan_index(&index, crate::titles::title_in))
    })
    .await
}

/// The lines of the open vault's notes that contain `query`, ignoring case -
/// or that a regular expression matches, when `pattern` is set - best first.
#[tauri::command]
pub(crate) async fn search_contents(
    window: tauri::WebviewWindow,
    query: String,
    pattern: Option<bool>,
) -> Result<Vec<ContentHit>, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        if locked(&vault.root).is_none() {
            return Ok(Vec::new());
        }
        search_index(&vault.index, &query, pattern.unwrap_or(false))
    })
    .await
}

/// Every file in the open vault, for quick-open: the whole vault's, not only
/// the folders the sidebar has opened.
#[tauri::command]
pub(crate) async fn list_files(window: tauri::WebviewWindow) -> Result<Vec<FileEntry>, String> {
    off_thread(move || {
        let vault = vault_of(&window);
        if locked(&vault.root).is_none() {
            return Ok(Vec::new());
        }
        Ok(vault.index.files())
    })
    .await
}

/// Tells the window its vault's files have changed, if `changed` says they
/// have. The window reads the list again when it hears - not every time a note
/// is saved, which would be several times a minute for nothing.
pub(crate) fn announce_files<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, changed: bool) {
    if changed {
        let _ = window.emit_to(window.label(), INDEX_CHANGED_EVENT, ());
    }
}

/// Keeps the index in step with files the app itself has just changed, rather
/// than waiting for the watcher to report them - which is not there at all for
/// a folder that could not be watched.
pub(crate) fn note_changes<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, paths: &[&Path]) {
    let index: Arc<VaultIndex> = vault_of(window).index.clone();
    let mut changed = false;
    for path in paths {
        changed |= index.refresh(path);
    }
    announce_files(window, changed);
}
