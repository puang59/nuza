use crate::files::{create_unused, preferred_directory, safe_file_name};
use crate::state::{vault_of, within_vault, within_vault_to_write, Windows};
use crate::tasks::off_thread;
use std::fs;
use std::path::Path;
use tauri::Manager;

/// The scheme a note's images and video are served over.
///
/// Tauri's asset protocol was doing this, and its scope is a list of allowed
/// directories that only ever grows: every vault opened since launch stays on
/// it, so a note in the vault open now could reach into one closed an hour
/// ago - the opposite of what the comment on `Vault` says this app does.
///
/// Nothing can be taken off that list, either. `forbid_directory` does not
/// undo `allow_directory`; it adds to a second list that wins permanently, so
/// revoking a vault on the way out would quietly stop its images loading if
/// it were ever opened again.
///
/// So media does not go through that protocol at all. This one asks
/// `within_vault` - the same question, of the same function, that every
/// filesystem command here asks - which makes the boundary one answer rather
/// than a list that drifts away from it.
pub(crate) const MEDIA_PROTOCOL: &str = "nuza-media";

/// The file a `nuza-media://` request is asking for.
///
/// `convertFileSrc` puts the path in the URI, percent-encoded, with a leading
/// slash that is the URI's rather than the path's.
pub(crate) fn requested_path(uri: &tauri::http::Uri) -> String {
    let encoded = uri.path().as_bytes();
    let without_leading_slash = encoded.strip_prefix(b"/").unwrap_or(encoded);
    percent_encoding::percent_decode(without_leading_slash)
        .decode_utf8_lossy()
        .into_owned()
}

/// An empty reply carrying only a status, for the cases with nothing to say.
pub(crate) fn media_status(status: u16) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .body(Vec::new())
        .unwrap_or_default()
}

/// Reads the part of `file` that `range` asked for, if it asked for one.
///
/// A `<video>` does not fetch a file, it fetches pieces of one, and a server
/// that answers every request with the whole thing is a video that cannot be
/// seeked. The asset protocol handled this; so does this.
pub(crate) fn media_body(
    file: &mut fs::File,
    length: u64,
    range: Option<&str>,
) -> std::io::Result<(Vec<u8>, Option<String>, u16)> {
    media_body_in_chunks(file, length, range, MEDIA_CHUNK)
}

/// The most of a file one ranged answer carries. A player asks for a video
/// "from here to the end" and is content with less - it comes back for the
/// next part - where taking it at its word meant holding the rest of the file
/// in memory for every request, and again for every seek.
pub(crate) const MEDIA_CHUNK: u64 = 1024 * 1024;

/// `media_body`, with how much one ranged answer may carry said outright.
///
/// A request with no range still gets the whole file: that is an `<img>`,
/// which has no use for part of a picture.
pub(crate) fn media_body_in_chunks(
    file: &mut fs::File,
    length: u64,
    range: Option<&str>,
    chunk: u64,
) -> std::io::Result<(Vec<u8>, Option<String>, u16)> {
    use std::io::{Read, Seek};

    let Some(range) = range.and_then(|value| {
        http_range::HttpRange::parse(value, length)
            .ok()
            .and_then(|ranges| ranges.first().copied())
    }) else {
        let mut bytes = Vec::with_capacity(length as usize);
        file.read_to_end(&mut bytes)?;
        return Ok((bytes, None, 200));
    };

    let carried = range.length.min(chunk.max(1));
    let last = range.start + carried - 1;
    file.seek(std::io::SeekFrom::Start(range.start))?;

    let mut bytes = vec![0; carried as usize];
    file.read_exact(&mut bytes)?;

    Ok((
        bytes,
        Some(format!("bytes {}-{}/{}", range.start, last, length)),
        206,
    ))
}

/// Answers one request for a note's media, or says why it will not.
pub(crate) fn serve_media(
    app_handle: &tauri::AppHandle,
    label: &str,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use std::io::Read;

    let asked_for = requested_path(request.uri());

    // The whole point of the scheme. A path that does not resolve inside the
    // folder that is open is not this app's to serve, whether it belongs to a
    // vault that was open earlier or to somewhere that never was.
    let vault = app_handle.state::<Windows>().vault(label);
    let Ok(path) = within_vault(&vault, Path::new(&asked_for)) else {
        return media_status(403);
    };

    let Ok(mut file) = fs::File::open(&path) else {
        return media_status(404);
    };
    let Ok(length) = file.metadata().map(|data| data.len()) else {
        return media_status(404);
    };

    // What it is, read from the first few bytes the way `file(1)` would, with
    // the name as the tie-breaker.
    let mut leading = Vec::new();
    let sniffed = (&mut file).take(length.min(8192)).read_to_end(&mut leading);
    if sniffed.is_err() || file.rewind_to_start().is_err() {
        return media_status(500);
    }
    let mime = tauri_utils::mime_type::MimeType::parse(&leading, &path.to_string_lossy());

    let range = request
        .headers()
        .get(tauri::http::header::RANGE)
        .and_then(|value| value.to_str().ok());

    let Ok((bytes, content_range, status)) = media_body(&mut file, length, range) else {
        return media_status(500);
    };

    let mut response = tauri::http::Response::builder()
        .status(status)
        .header(tauri::http::header::CONTENT_TYPE, mime)
        // Without this a video has no way to ask for part of a file, and the
        // webview will not offer a scrubber it cannot use.
        .header(tauri::http::header::ACCEPT_RANGES, "bytes")
        .header(tauri::http::header::CONTENT_LENGTH, bytes.len());

    if let Some(content_range) = content_range {
        response = response.header(tauri::http::header::CONTENT_RANGE, content_range);
    }

    response.body(bytes).unwrap_or_else(|_| media_status(500))
}

/// `Seek::rewind` by another name, so the `?`-less path above reads plainly.
pub(crate) trait RewindToStart {
    fn rewind_to_start(&mut self) -> std::io::Result<()>;
}

impl RewindToStart for fs::File {
    fn rewind_to_start(&mut self) -> std::io::Result<()> {
        std::io::Seek::rewind(self)
    }
}

/// A percent-encoded header from a request, decoded.
pub(crate) fn header_text(headers: &tauri::http::HeaderMap, name: &str) -> Result<String, String> {
    let value = headers
        .get(name)
        .ok_or_else(|| format!("The request is missing {}", name))?;
    percent_encoding::percent_decode(value.as_bytes())
        .decode_utf8()
        .map(|text| text.into_owned())
        .map_err(|e| e.to_string())
}

/// The bytes of a request's body.
///
/// They arrive raw, as the body itself. Should the webview have fallen back
/// to the message channel, which only speaks JSON, a byte array comes across
/// as an array of numbers instead, and that is read too.
pub(crate) fn body_bytes(body: &tauri::ipc::InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(value) => serde_json::from_value(value.clone())
            .map_err(|e| format!("Could not read the dropped file: {}", e)),
    }
}

/// Writes a dropped or pasted file into the directory in the
/// `x-nuza-directory` header, creating it if it is not there yet, under the
/// name in `x-nuza-name`. The file itself is the body of the request, as it
/// is - no base64, and no JSON around it.
/// Returns the full path actually written, which may have been renamed to
/// avoid overwriting something.
#[tauri::command]
pub(crate) async fn write_media(
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let directory = header_text(request.headers(), "x-nuza-directory")?;
    let name = header_text(request.headers(), "x-nuza-name")?;
    let bytes = body_bytes(request.body())?;

    off_thread(move || {
        let vault = vault_of(&window);

        let directory = preferred_directory(Path::new(&directory));
        let directory = within_vault_to_write(&vault, &directory)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;

        // Checked again now that it exists: create_dir_all resolves nothing,
        // and a media folder that is a symlink out of the vault would have
        // passed above.
        let directory = within_vault(&vault, &directory)?;
        let (mut file, path) = create_unused(&directory, &safe_file_name(&name)?)?;
        std::io::Write::write_all(&mut file, &bytes).map_err(|e| e.to_string())?;
        crate::search::note_changes(&window, &[&path]);

        Ok(path.to_string_lossy().into_owned())
    })
    .await
}
