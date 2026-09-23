#!/usr/bin/env python3
"""
Assembles the Tauri updater manifest from the signatures on a GitHub release.

tauri-action can write this file itself, but it does so once per build job, and
those jobs run in parallel against the same release - so they race, and the
loser can publish a manifest that silently omits its platform. Building it here
instead, once every build has finished, removes the race entirely.

Exits non-zero if any expected platform is missing, so an incomplete manifest
fails the release rather than shipping a partial one.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

DEFAULT_NOTES = "See the assets to download this version and install."

# Bundle suffix -> the updater platform keys it satisfies. Order matters: the
# macOS entries have to be tested before any looser suffix could shadow them.
#
# The bare "windows-x86_64" and "linux-x86_64" keys are what the updater looks
# up by default, so they point at the same bundle tauri-action would pick: the
# .msi on Windows (it prefers WiX over NSIS unless told otherwise) and the
# AppImage on Linux.
SUFFIX_PLATFORMS: list[tuple[str, list[str]]] = [
    ("_aarch64.app.tar.gz", ["darwin-aarch64", "darwin-aarch64-app"]),
    ("_x64.app.tar.gz", ["darwin-x86_64", "darwin-x86_64-app"]),
    (".AppImage", ["linux-x86_64", "linux-x86_64-appimage"]),
    (".deb", ["linux-x86_64-deb"]),
    (".rpm", ["linux-x86_64-rpm"]),
    (".msi", ["windows-x86_64", "windows-x86_64-msi"]),
    ("-setup.exe", ["windows-x86_64-nsis"]),
]

REQUIRED_PLATFORMS = {key for _, keys in SUFFIX_PLATFORMS for key in keys}


def platforms_for(asset_name: str) -> list[str]:
    for suffix, keys in SUFFIX_PLATFORMS:
        if asset_name.endswith(suffix):
            return keys
    return []


def build_platforms(sig_dir: Path, repo: str, tag: str) -> dict[str, dict[str, str]]:
    platforms: dict[str, dict[str, str]] = {}

    for sig_path in sorted(sig_dir.glob("*.sig")):
        asset_name = sig_path.name.removesuffix(".sig")
        keys = platforms_for(asset_name)
        if not keys:
            print(f"  skipping {asset_name} (not an updater bundle)", file=sys.stderr)
            continue

        signature = sig_path.read_text().strip()
        if not signature:
            print(f"  skipping {asset_name} (empty signature)", file=sys.stderr)
            continue

        url = f"https://github.com/{repo}/releases/download/{quote(tag)}/{quote(asset_name)}"
        for key in keys:
            platforms[key] = {"signature": signature, "url": url}
            print(f"  {key} -> {asset_name}", file=sys.stderr)

    return platforms


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sig-dir", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--notes", default="")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--pub-date",
        help="Override the timestamp, for reproducible tests. Defaults to now.",
    )
    args = parser.parse_args()

    if not args.sig_dir.is_dir():
        print(f"Signature directory {args.sig_dir} does not exist", file=sys.stderr)
        return 1

    platforms = build_platforms(args.sig_dir, args.repo, args.tag)

    missing = sorted(REQUIRED_PLATFORMS - platforms.keys())
    if missing:
        print(f"Missing signatures for: {', '.join(missing)}", file=sys.stderr)
        return 1

    pub_date = args.pub_date or (
        datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )

    manifest = {
        "version": args.version,
        "notes": args.notes.strip() or DEFAULT_NOTES,
        "pub_date": pub_date,
        "platforms": dict(sorted(platforms.items())),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {args.output} with {len(platforms)} platform entries", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
