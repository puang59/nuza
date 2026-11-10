//! What a plugin says about itself, in its `manifest.json`, and whether that
//! is something nuza will load. The same rules are checked by the plugin
//! directory's CI before a plugin is listed.

use serde::{Deserialize, Serialize};

/// The plugin API majors this build of nuza can run.
pub(crate) const SUPPORTED_API: &[u32] = &[1];

/// The permissions a manifest may ask for.
const PERMISSIONS: &[&str] = &["network"];

/// The longest manifest read: anything bigger is not a manifest.
pub(crate) const MANIFEST_LIMIT: u64 = 64 * 1024;

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) min_app_version: String,
    pub(crate) api_version: u32,
    pub(crate) description: String,
    pub(crate) author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) author_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) funding_url: Option<String>,
    #[serde(default)]
    pub(crate) permissions: Vec<String>,
}

/// Reads a manifest, saying in a sentence what is wrong with one that is not.
pub(crate) fn parse(text: &str) -> Result<PluginManifest, String> {
    serde_json::from_str(text).map_err(|e| format!("Its manifest.json can't be read: {e}"))
}

/// Whether `id` is a plugin id: lower-case letters, digits and dashes, 3 to 64
/// long, not starting or ending with a dash.
pub(crate) fn is_valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (3..=64).contains(&bytes.len())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes[0] != b'-'
        && bytes[bytes.len() - 1] != b'-'
}

/// What makes `manifest` one nuza will not take, as a sentence for Settings.
/// `folder` is the name of the folder it was found in, which its id must be.
pub(crate) fn problem(manifest: &PluginManifest, folder: &str) -> Option<String> {
    if !is_valid_id(&manifest.id) {
        return Some(format!(
            "\"{}\" is not a valid plugin id: lower-case letters, digits and dashes only",
            manifest.id
        ));
    }
    if manifest.id != folder {
        return Some(format!(
            "Its id is \"{}\", but its folder is called \"{folder}\"",
            manifest.id
        ));
    }
    if manifest.id.contains("nuza") || manifest.name.to_lowercase().contains("nuza") {
        return Some("A plugin's id and name can't contain \"nuza\"".to_string());
    }
    let name = manifest.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Some("Its name has to be 1 to 60 characters".to_string());
    }
    let description = manifest.description.trim();
    if description.is_empty() || description.chars().count() > 250 {
        return Some("Its description has to be 1 to 250 characters".to_string());
    }
    if manifest.author.trim().is_empty() {
        return Some("It doesn't say who wrote it".to_string());
    }
    if version(&manifest.version).is_none() {
        return Some(format!(
            "Its version \"{}\" is not a version number like 1.0.0",
            manifest.version
        ));
    }
    let Some(needs) = version(&manifest.min_app_version) else {
        return Some(format!(
            "Its minAppVersion \"{}\" is not a version number like 3.0.0",
            manifest.min_app_version
        ));
    };
    if Some(needs) > version(env!("CARGO_PKG_VERSION")) {
        return Some(format!("Needs nuza {} or newer", manifest.min_app_version));
    }
    if !SUPPORTED_API.contains(&manifest.api_version) {
        return Some(format!(
            "Written for plugin API {}, which this version of nuza doesn't run",
            manifest.api_version
        ));
    }
    if let Some(unknown) = manifest
        .permissions
        .iter()
        .find(|permission| !PERMISSIONS.contains(&permission.as_str()))
    {
        return Some(format!(
            "Asks for a permission nuza doesn't know: \"{unknown}\""
        ));
    }
    None
}

/// `x.y.z` as three numbers, or None for anything else.
pub(crate) fn version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    parts.next().is_none().then_some((major, minor, patch))
}
