#!/usr/bin/env python3
"""Strictly validate the generated-client calling contract lock.

The lock's `sha256` is not just compared against a literal: it is
independently recomputed from the vendored authority files under
contracts/vendor/calling-contract-authority/, byte-for-byte reproducing
scripts/telephony-contract-digest.sh's algorithm in the upstream
appolon1908-hue/codestra-production-platform repository. A lock digest
that no longer matches those vendored bytes -- stale, hand-edited, or
copied from the wrong authority -- fails closed instead of passing
because it happens to equal a hardcoded string.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / ".codestra/calling-contract.lock.json"
VENDOR_DIR = ROOT / "contracts/vendor/calling-contract-authority"
VENDOR_SOURCE = VENDOR_DIR / "calling-contract-authority.source.json"
EXPECTED = {
    "version": "1.0.0",
    "sha256": "b39cdffe56a8185c91174228f0423df68b1137f34875f6ee52f9914f904bf724",
    "authority": "appolon1908-hue/codestra-production-platform#257",
    "role": "generated_clients",
    "external_effects_enabled": False,
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def compute_authority_digest() -> str:
    """Reproduce scripts/telephony-contract-digest.sh exactly: sha256sum
    each component file at its original upstream path, then sha256 the
    concatenated `<hex>  <path>\\n` lines -- GNU coreutils' own text-mode
    output format, byte for byte."""
    source = json.loads(VENDOR_SOURCE.read_text(encoding="utf-8"))
    lines: list[str] = []
    for component in source["components"]:
        # Vendored files sit at the same relative path as in the authority
        # repo (see the "layout" note in calling-contract-authority.source.json),
        # so their own internal relative $ref values resolve correctly.
        vendored = VENDOR_DIR / component["source_path"]
        actual = sha256_file(vendored)
        if actual != component["sha256"]:
            raise ValueError(
                f"vendored authority file {component['source_path']} does not match its pinned sha256"
                " (contracts/vendor/calling-contract-authority/calling-contract-authority.source.json is stale or the file was edited)"
            )
        lines.append(f"{actual}  {component['source_path']}\n")
    return hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()


def reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON field: {key}")
        result[key] = value
    return result


def parse_document(text: str) -> object:
    return json.loads(text, object_pairs_hook=reject_duplicate_pairs)


def validate(document: object) -> None:
    if not isinstance(document, dict):
        raise ValueError("calling contract lock must be a JSON object")
    if set(document) != set(EXPECTED):
        raise ValueError("calling contract lock fields do not match the canonical schema")
    for field in ("version", "sha256", "authority", "role"):
        if type(document.get(field)) is not str or document[field] != EXPECTED[field]:
            raise ValueError(f"calling contract {field} does not match authority")
    if not re.fullmatch(r"[0-9a-f]{64}", document["sha256"]):
        raise ValueError("calling contract digest is malformed")
    authority_digest = compute_authority_digest()
    if document["sha256"] != authority_digest:
        raise ValueError(
            "calling contract sha256 does not match the digest recomputed from the vendored"
            " authority files -- the pin is stale, or the vendored files no longer reflect"
            f" {EXPECTED['authority']} (recomputed {authority_digest})"
        )
    if type(document.get("external_effects_enabled")) is not bool:
        raise ValueError("external_effects_enabled must be a JSON boolean")
    if document["external_effects_enabled"] is not False:
        raise ValueError("calling contract must remain fail closed")


def self_test() -> None:
    validate(copy.deepcopy(EXPECTED))
    invalid: list[object] = [
        None,
        [],
        {**EXPECTED, "external_effects_enabled": "false"},
        {**EXPECTED, "external_effects_enabled": 0},
        {**EXPECTED, "external_effects_enabled": None},
        {**EXPECTED, "external_effects_enabled": True},
        {key: value for key, value in EXPECTED.items() if key != "authority"},
        {**EXPECTED, "authority": "appolon1908-hue/codestra-production-platform#260"},
        {**EXPECTED, "role": "wrong_role"},
        {**EXPECTED, "sha256": "0" * 64},
        {**EXPECTED, "unexpected": "field"},
    ]
    for number, document in enumerate(invalid, 1):
        try:
            validate(document)
        except ValueError:
            continue
        raise AssertionError(f"negative lock fixture {number} was accepted")

    duplicate_json = [
        '{"sha256":"0","sha256":"b39cdffe56a8185c91174228f0423df68b1137f34875f6ee52f9914f904bf724"}',
        '{"authority":"wrong","authority":"appolon1908-hue/codestra-production-platform#257"}',
        '{"external_effects_enabled":true,"external_effects_enabled":false}',
        '{"external_effects_enabled":false,"external_effects_enabled":true}',
    ]
    for number, text in enumerate(duplicate_json, 1):
        try:
            parse_document(text)
        except ValueError:
            continue
        raise AssertionError(f"duplicate-key fixture {number} was accepted")

    # Prove the digest is bound to the vendored authority bytes, not just
    # compared to the hardcoded literal above: corrupt a real vendored file,
    # confirm the otherwise-valid EXPECTED document is now rejected, and
    # always restore the original content even if the assertion fails.
    tampered = VENDOR_DIR / "contracts/telephony/codestra-calling-api.v1.openapi.yaml"
    original = tampered.read_bytes()
    try:
        tampered.write_bytes(original + b"\n# tampered\n")
        try:
            validate(copy.deepcopy(EXPECTED))
        except ValueError:
            pass
        else:
            raise AssertionError("tampered vendored authority file was accepted")
    finally:
        tampered.write_bytes(original)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        validate(parse_document(LOCK.read_text(encoding="utf-8")))
    print("CALLING_CONTRACT_PIN=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
