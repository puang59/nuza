use super::manifest::{self, PluginManifest};
use super::store::{self, PluginsConfig};
use std::fs;
use std::path::Path;

fn good() -> PluginManifest {
    PluginManifest {
        id: "word-goal".into(),
        name: "Word Goal".into(),
        version: "1.2.0".into(),
        min_app_version: "2.0.0".into(),
        api_version: 1,
        description: "A daily word target in the status bar.".into(),
        author: "Jane Doe".into(),
        author_url: None,
        funding_url: None,
        permissions: vec![],
    }
}

fn install(root: &Path, folder: &str, manifest: Option<&PluginManifest>, main: bool) {
    let dir = store::plugins_folder(root).join(folder);
    fs::create_dir_all(&dir).unwrap();
    if let Some(manifest) = manifest {
        fs::write(
            dir.join("manifest.json"),
            serde_json::to_string(manifest).unwrap(),
        )
        .unwrap();
    }
    if main {
        fs::write(dir.join("main.js"), "nuza.registerPlugin(function () {});").unwrap();
    }
}

#[test]
fn a_good_manifest_has_no_problem() {
    assert_eq!(manifest::problem(&good(), "word-goal"), None);
}

/// A change to a good manifest, and what the problem with it should say.
type Breakage = (&'static str, Box<dyn Fn(&mut PluginManifest)>);

#[test]
fn a_manifest_is_refused_for_each_rule_it_breaks() {
    let cases: Vec<Breakage> = vec![
        (
            "not a valid plugin id",
            Box::new(|m| m.id = "Word_Goal".into()),
        ),
        (
            "but its folder is called",
            Box::new(|m| m.id = "other-id".into()),
        ),
        (
            "can't contain \"nuza\"",
            Box::new(|m| m.name = "Nuza Goals".into()),
        ),
        ("name has to be", Box::new(|m| m.name = " ".into())),
        (
            "description has to be",
            Box::new(|m| m.description = "x".repeat(251)),
        ),
        ("who wrote it", Box::new(|m| m.author = String::new())),
        (
            "not a version number like 1.0.0",
            Box::new(|m| m.version = "1.0".into()),
        ),
        (
            "Needs nuza 99.0.0 or newer",
            Box::new(|m| m.min_app_version = "99.0.0".into()),
        ),
        ("plugin API 7", Box::new(|m| m.api_version = 7)),
        (
            "doesn't know: \"camera\"",
            Box::new(|m| m.permissions = vec!["camera".into()]),
        ),
    ];
    for (expected, change) in cases {
        let mut manifest = good();
        change(&mut manifest);
        // The folder keeps the good id, so only the id-mismatch case differs from it.
        let folder = if expected.contains("folder") {
            "word-goal".to_string()
        } else {
            manifest.id.clone()
        };
        let problem = manifest::problem(&manifest, &folder).unwrap_or_default();
        assert!(
            problem.contains(expected),
            "expected {expected:?}, got {problem:?}"
        );
    }
}

#[test]
fn ids_are_lower_case_words_joined_by_dashes() {
    for id in ["word-goal", "abc", "a1-b2"] {
        assert!(manifest::is_valid_id(id), "{id}");
    }
    for id in [
        "ab",
        "-word",
        "word-",
        "Word",
        "word_goal",
        "word goal",
        "../x",
        &"a".repeat(65),
    ] {
        assert!(!manifest::is_valid_id(id), "{id}");
    }
}

#[test]
fn versions_are_three_numbers() {
    assert_eq!(manifest::version("3.0.12"), Some((3, 0, 12)));
    assert!(manifest::version("3.0").is_none());
    assert!(manifest::version("3.0.0.1").is_none());
    assert!(manifest::version("3.x.0").is_none());
}

#[test]
fn a_vault_with_no_settings_runs_nothing() {
    let vault = tempfile::tempdir().unwrap();
    assert_eq!(store::read_config(vault.path()), PluginsConfig::default());

    fs::create_dir_all(store::app_folder(vault.path())).unwrap();
    fs::write(
        store::app_folder(vault.path()).join("plugins.json"),
        "{ not json",
    )
    .unwrap();
    assert_eq!(store::read_config(vault.path()), PluginsConfig::default());
}

#[test]
fn settings_are_kept() {
    let vault = tempfile::tempdir().unwrap();
    let config = PluginsConfig {
        community: true,
        enabled: vec!["word-goal".into()],
    };
    store::write_config(vault.path(), &config).unwrap();
    assert_eq!(store::read_config(vault.path()), config);
}

#[test]
fn installed_plugins_are_listed_with_what_stops_them_loading() {
    let vault = tempfile::tempdir().unwrap();
    let root = vault.path();
    install(root, "word-goal", Some(&good()), true);
    install(
        root,
        "no-main",
        Some(&PluginManifest {
            id: "no-main".into(),
            name: "No Main".into(),
            ..good()
        }),
        false,
    );
    install(root, "no-manifest", None, true);
    install(
        root,
        "too-new",
        Some(&PluginManifest {
            id: "too-new".into(),
            name: "Too New".into(),
            min_app_version: "99.0.0".into(),
            ..good()
        }),
        true,
    );
    let config = PluginsConfig {
        community: true,
        enabled: vec!["word-goal".into()],
    };

    let found = store::installed(root, &config);
    let by_id = |id: &str| found.iter().find(|plugin| plugin.id == id).unwrap();

    assert_eq!(by_id("word-goal").problem, None);
    assert!(by_id("word-goal").enabled);
    assert_eq!(by_id("word-goal").hash.len(), 12);
    assert!(!by_id("no-main").enabled);
    assert_eq!(
        by_id("no-main").problem.as_deref(),
        Some("It has no main.js")
    );
    assert_eq!(
        by_id("no-manifest").problem.as_deref(),
        Some("It has no manifest.json")
    );
    assert_eq!(
        by_id("too-new").problem.as_deref(),
        Some("Needs nuza 99.0.0 or newer")
    );
}

#[test]
fn installs_cut_short_are_cleared_and_hidden_folders_skipped() {
    let vault = tempfile::tempdir().unwrap();
    let root = vault.path();
    install(root, "word-goal", Some(&good()), true);
    install(root, ".staging-kanban-1a2b", None, true);
    install(root, ".DS_Store-ish", None, false);

    let found = store::installed(root, &PluginsConfig::default());

    assert_eq!(
        found
            .iter()
            .map(|plugin| plugin.id.as_str())
            .collect::<Vec<_>>(),
        vec!["word-goal"]
    );
    assert!(!store::plugins_folder(root)
        .join(".staging-kanban-1a2b")
        .exists());
}

#[test]
fn plugins_are_listed_by_name() {
    let vault = tempfile::tempdir().unwrap();
    let root = vault.path();
    install(
        root,
        "zeta",
        Some(&PluginManifest {
            id: "zeta".into(),
            name: "Alpha Tool".into(),
            ..good()
        }),
        true,
    );
    install(
        root,
        "alpha",
        Some(&PluginManifest {
            id: "alpha".into(),
            name: "Zed Tool".into(),
            ..good()
        }),
        true,
    );
    let names: Vec<String> = store::installed(root, &PluginsConfig::default())
        .into_iter()
        .map(|plugin| plugin.manifest.unwrap().name)
        .collect();
    assert_eq!(names, vec!["Alpha Tool", "Zed Tool"]);
}

mod scheme {
    use super::super::protocol::resolve;
    use super::*;

    /// A vault with community plugins on and word-goal installed and enabled,
    /// with an asset, its settings, and a file just outside its folder.
    fn vault() -> tempfile::TempDir {
        let vault = tempfile::tempdir().unwrap();
        let root = vault.path();
        install(root, "word-goal", Some(&good()), true);
        install(
            root,
            "kanban",
            Some(&PluginManifest {
                id: "kanban".into(),
                ..good()
            }),
            true,
        );
        let folder = store::plugins_folder(root).join("word-goal");
        fs::write(folder.join("styles.css"), ".word-goal {}").unwrap();
        fs::create_dir_all(folder.join("assets/icons")).unwrap();
        fs::write(folder.join("assets/icons/flag.svg"), "<svg/>").unwrap();
        fs::write(folder.join("data.json"), "{}").unwrap();
        fs::write(root.join("secret.md"), "private").unwrap();
        store::write_config(
            root,
            &PluginsConfig {
                community: true,
                enabled: vec!["word-goal".into()],
            },
        )
        .unwrap();
        vault
    }

    #[test]
    fn serves_an_enabled_plugins_code_styles_and_assets() {
        let vault = vault();
        for file in [
            "word-goal/main.js",
            "word-goal/styles.css",
            "word-goal/assets/icons/flag.svg",
        ] {
            assert!(resolve(vault.path(), file).is_ok(), "{file}");
        }
    }

    #[test]
    fn refuses_anything_else() {
        let vault = vault();
        let refused = [
            "word-goal/data.json",
            "word-goal/manifest.json",
            "word-goal/../../secret.md",
            "word-goal/assets/../../../secret.md",
            "word-goal/assets/",
            "word-goal//etc/passwd",
            "word-goal/assets//etc/passwd",
            "../secret.md",
            "Word-Goal/main.js",
            "word-goal",
            "kanban/main.js",
            "missing/main.js",
        ];
        for file in refused {
            assert!(resolve(vault.path(), file).is_err(), "{file}");
        }
    }

    #[test]
    fn serves_nothing_while_community_plugins_are_off() {
        let vault = vault();
        store::write_config(
            vault.path(),
            &PluginsConfig {
                community: false,
                enabled: vec!["word-goal".into()],
            },
        )
        .unwrap();
        assert_eq!(resolve(vault.path(), "word-goal/main.js"), Err(403));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_plugin_is_refused_but_a_linked_plugin_is_served() {
        let vault = vault();
        let root = vault.path();
        let folder = store::plugins_folder(root).join("word-goal");
        std::os::unix::fs::symlink(root.join("secret.md"), folder.join("assets/secret.md"))
            .unwrap();
        assert_eq!(resolve(root, "word-goal/assets/secret.md"), Err(403));

        // A plugin being worked on elsewhere, linked into the vault.
        let elsewhere = tempfile::tempdir().unwrap();
        fs::write(elsewhere.path().join("main.js"), "").unwrap();
        fs::remove_dir_all(&folder).unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), &folder).unwrap();
        assert!(resolve(root, "word-goal/main.js").is_ok());
    }
}

mod trust {
    use super::super::trust::PluginTrust;

    #[test]
    fn a_vault_is_trusted_only_once_this_machine_says_so() {
        let data = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let trust = PluginTrust::new(Some(data.path()), false);
        assert!(!trust.allows(vault.path()));

        trust.trust(vault.path()).unwrap();
        assert!(trust.allows(vault.path()));
        // Kept for the next run.
        assert!(PluginTrust::new(Some(data.path()), false).is_trusted(vault.path()));
    }

    #[test]
    fn a_copy_of_a_trusted_vault_is_asked_about_again() {
        let data = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let copy = tempfile::tempdir().unwrap();
        let trust = PluginTrust::new(Some(data.path()), false);
        trust.trust(vault.path()).unwrap();
        assert!(!trust.allows(copy.path()));
    }

    #[test]
    fn a_vault_reached_through_a_link_is_the_same_vault() {
        let data = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        let links = tempfile::tempdir().unwrap();
        let link = links.path().join("notes");
        #[cfg(unix)]
        std::os::unix::fs::symlink(vault.path(), &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(vault.path(), &link).unwrap();
        let trust = PluginTrust::new(Some(data.path()), false);
        trust.trust(&link).unwrap();
        assert!(trust.allows(vault.path()));
    }

    #[test]
    fn no_plugins_runs_nothing_even_where_trusted() {
        let data = tempfile::tempdir().unwrap();
        let vault = tempfile::tempdir().unwrap();
        PluginTrust::new(Some(data.path()), false)
            .trust(vault.path())
            .unwrap();
        let trust = PluginTrust::new(Some(data.path()), true);
        assert!(trust.is_trusted(vault.path()));
        assert!(!trust.allows(vault.path()));
    }

    #[test]
    fn without_a_data_folder_nothing_is_trusted() {
        let vault = tempfile::tempdir().unwrap();
        let trust = PluginTrust::new(None, false);
        assert!(trust.trust(vault.path()).is_err());
        assert!(!trust.allows(vault.path()));
    }
}
