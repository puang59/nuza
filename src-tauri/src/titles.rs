//! The title a note gives itself, for the sidebar to show in place of its
//! file name when asked to: the frontmatter's `title:`, or else its first
//! top-level `# ` heading.

/// How far down a note its title is looked for.
const TITLE_SEARCH_LINES: usize = 200;

/// A note's own title, by path.
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct NoteTitle {
    pub path: String,
    pub title: String,
}

/// The title in `text`, the note at `path`, if it has one.
pub fn title_in(path: &str, text: &str) -> Vec<NoteTitle> {
    title_of(text)
        .map(|title| NoteTitle {
            path: path.to_string(),
            title,
        })
        .into_iter()
        .collect()
}

fn title_of(text: &str) -> Option<String> {
    let mut lines = text.lines().take(TITLE_SEARCH_LINES).peekable();

    // Frontmatter: a `---` on the first line, closed by another.
    if lines.peek().is_some_and(|first| first.trim_end() == "---") {
        lines.next();
        let mut from_frontmatter = None;
        for line in lines.by_ref() {
            if line.trim_end() == "---" || line.trim_end() == "..." {
                break;
            }
            if let Some(value) = line.strip_prefix("title:") {
                let value = value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
                if !value.is_empty() {
                    from_frontmatter = Some(value.to_string());
                }
            }
        }
        if from_frontmatter.is_some() {
            return from_frontmatter;
        }
    }

    let mut in_code = false;
    for line in lines {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("# ") {
            // A closing run of #s is not part of the title.
            let heading = heading.trim().trim_end_matches('#').trim();
            if !heading.is_empty() {
                return Some(heading.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::title_of;

    #[test]
    fn the_frontmatter_title_comes_first() {
        let note = "---\ntags: [a]\ntitle: \"Groceries\"\n---\n# Something else\n";
        assert_eq!(title_of(note).as_deref(), Some("Groceries"));
    }

    #[test]
    fn else_the_first_top_level_heading() {
        assert_eq!(
            title_of("intro\n\n## Not this\n# Plans ##\n").as_deref(),
            Some("Plans")
        );
        assert_eq!(
            title_of("---\nother: x\n---\n# From the heading\n").as_deref(),
            Some("From the heading")
        );
    }

    #[test]
    fn not_a_heading_in_code_and_not_an_empty_one() {
        assert_eq!(
            title_of("```sh\n# comment\n```\n# Real\n").as_deref(),
            Some("Real")
        );
        assert_eq!(title_of("# \nplain\n"), None);
        assert_eq!(title_of("just text"), None);
    }
}
