import { invoke } from "@tauri-apps/api/core";

/** The folder a note's images and attachments are filed under. */
export const MEDIA_FOLDER = "media";

/** Splits a path on either separator, so Windows and POSIX paths both work. */
function segments(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** The separator the host is already using, inferred from the path itself. */
function separatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function joinPath(parent: string, name: string) {
  return `${parent}${separatorFor(parent)}${name}`;
}

export function fileNameOf(path: string) {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * The way from `directory` to `target`, as a relative path. Markdown links are
 * always written with forward slashes: they are read back by splitting on
 * either separator, and a backslash in a link is an escape as often as it is a
 * path on the one platform that uses them.
 */
export function relativePath(directory: string, target: string) {
  const from = segments(directory);
  const to = segments(target);

  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++;

  const climb = Array.from({ length: from.length - shared }, () => "..");
  return [...climb, ...to.slice(shared)].join("/");
}

/**
 * A link's target, escaped so the markdown parser reads all of it. Spaces end a
 * link target, which every screenshot name on a Mac would otherwise walk into.
 */
export function encodeLinkTarget(path: string) {
  return encodeURI(path).replace(/[()]/g, (char) => (char === "(" ? "%28" : "%29"));
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

export function isImage(type: string) {
  return type.startsWith("image/");
}

const IMAGE_SUFFIXES = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]);

/** Whether a path names an image, judged by its extension - a file on disk
 * arrives without the media type a dropped or pasted one carries. */
export function isImagePath(path: string) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_SUFFIXES.has(path.slice(dot + 1).toLowerCase());
}

/**
 * A name for something pasted straight from the clipboard, which arrives with
 * no name of its own. Dashes rather than spaces: it ends up in a link.
 */
export function pastedName(type: string) {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");

  return `Pasted-${stamp}.${IMAGE_EXTENSIONS[type] ?? "png"}`;
}

/**
 * Base64, built in chunks - spreading a whole image into `fromCharCode` at once
 * overflows the argument list somewhere north of a hundred thousand pixels.
 */
function toBase64(bytes: Uint8Array) {
  const CHUNK = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Writes a dropped or pasted file into `directory`, returning the path it
 * actually landed at - the name is taken as a suggestion, and the backend
 * renames rather than overwrite anything already sitting there.
 */
export async function writeMedia(directory: string, name: string, file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return invoke<string>("write_media", { directory, name, data: toBase64(bytes) });
}

/** Broadcast after a file lands on disk, so the sidebar can show it. */
export const ATTACHMENT_EVENT = "nuza-attachment";

export function announceAttachment(path: string) {
  window.dispatchEvent(new CustomEvent(ATTACHMENT_EVENT, { detail: { path } }));
}
