#!/usr/bin/env python3
"""Stage the production Go MApp sources with their SHA-256 build ID."""

import argparse
import hashlib
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="empty staging directory")
    destination = parser.parse_args().destination
    source = Path(__file__).resolve().parent
    files = [
        (path.name, path.read_bytes())
        for path in sorted(source.glob("*.go"))
        if not path.name.endswith("_test.go")
    ]

    stamp_file = "build_id.go"
    placeholder = b'const backendBuildID = "development"'
    if dict(files).get(stamp_file, b"").count(placeholder) != 1:
        parser.error(f"{stamp_file} must contain the development build ID")

    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        parser.error(f"destination is not empty: {destination}")

    digest = hashlib.sha256()
    for name, contents in files:
        digest.update(name.encode("utf-8") + b"\0" + hashlib.sha256(contents).digest())
    build_id = digest.hexdigest()
    for name, contents in files:
        if name == stamp_file:
            contents = contents.replace(placeholder, f'const backendBuildID = "{build_id}"'.encode("ascii"))
        (destination / name).write_bytes(contents)
    print(build_id)


if __name__ == "__main__":
    main()
