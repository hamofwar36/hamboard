#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACKAGE_JSON = ROOT / "package.json"
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
CARGO_TOML = ROOT / "src-tauri" / "Cargo.toml"

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def fail(message: str) -> None:
    print(f"\n오류: {message}")
    input("\nEnter를 누르면 종료합니다...")
    raise SystemExit(1)


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"파일을 찾을 수 없습니다: {path.relative_to(ROOT)}")
    except json.JSONDecodeError as exc:
        fail(f"JSON 형식이 올바르지 않습니다: {path.relative_to(ROOT)} ({exc})")


def write_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_current_versions() -> tuple[str, str, str]:
    package_data = read_json(PACKAGE_JSON)
    tauri_data = read_json(TAURI_CONF)

    try:
        package_version = package_data["version"]
    except KeyError:
        fail("package.json에 version 항목이 없습니다.")

    try:
        tauri_version = tauri_data["version"]
    except KeyError:
        fail("src-tauri/tauri.conf.json에 version 항목이 없습니다.")

    try:
        cargo_text = CARGO_TOML.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail("src-tauri/Cargo.toml을 찾을 수 없습니다.")

    package_match = re.search(
        r'(?ms)^\[package\]\s*.*?^version\s*=\s*"([^"]+)"',
        cargo_text,
    )
    if not package_match:
        fail('src-tauri/Cargo.toml의 [package] version을 찾을 수 없습니다.')

    cargo_version = package_match.group(1)
    return package_version, tauri_version, cargo_version


def update_cargo_version(new_version: str) -> None:
    cargo_text = CARGO_TOML.read_text(encoding="utf-8")

    pattern = re.compile(
        r'(?ms)(^\[package\]\s*.*?^version\s*=\s*")[^"]+(")'
    )

    updated_text, count = pattern.subn(
        lambda m: f"{m.group(1)}{new_version}{m.group(2)}",
        cargo_text,
        count=1,
    )

    if count != 1:
        fail('src-tauri/Cargo.toml의 [package] version 변경에 실패했습니다.')

    CARGO_TOML.write_text(updated_text, encoding="utf-8")


def main() -> None:
    print("햄보드 버전 변경 도구")
    print("=" * 32)

    package_version, tauri_version, cargo_version = read_current_versions()

    print(f"package.json              : {package_version}")
    print(f"src-tauri/tauri.conf.json : {tauri_version}")
    print(f"src-tauri/Cargo.toml       : {cargo_version}")

    if len({package_version, tauri_version, cargo_version}) != 1:
        print("\n주의: 현재 세 파일의 버전이 서로 다릅니다.")

    new_version = input("\n새 버전 입력 (예: 1.0.2): ").strip()

    if not VERSION_RE.fullmatch(new_version):
        fail("버전은 1.0.2처럼 숫자.숫자.숫자 형식으로 입력해야 합니다.")

    package_data = read_json(PACKAGE_JSON)
    tauri_data = read_json(TAURI_CONF)

    package_data["version"] = new_version
    tauri_data["version"] = new_version

    write_json(PACKAGE_JSON, package_data)
    write_json(TAURI_CONF, tauri_data)
    update_cargo_version(new_version)

    print("\n완료!")
    print(f"버전을 {new_version}(으)로 변경했습니다.")
    print("\n변경된 파일:")
    print(" - package.json")
    print(" - src-tauri/tauri.conf.json")
    print(" - src-tauri/Cargo.toml")
    print("\npackage-lock.json / Cargo.lock은 직접 수정하지 않습니다.")
    print("평소처럼 이후 빌드/의존성 명령에서 정상적으로 갱신하면 됩니다.")

    input("\nEnter를 누르면 종료합니다...")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n취소되었습니다.")
        sys.exit(130)
