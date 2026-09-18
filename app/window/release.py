#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import bump_version

ROOT = Path(__file__).resolve().parent
TAURI_CONF = ROOT / "src-tauri" / "tauri.conf.json"
NSIS_DIR = ROOT / "src-tauri" / "target" / "release" / "bundle" / "nsis"
OUTPUT_ROOT = ROOT / "release-output"

GITHUB_LATEST_RE = re.compile(
    r"^https://github\.com/([^/]+)/([^/]+)/releases/latest/download/latest\.json$"
)


def die(message: str, code: int = 1) -> None:
    print(f"\n오류: {message}")
    raise SystemExit(code)


def run(command: list[str], *, cwd: Path = ROOT) -> None:
    printable = " ".join(command)
    print(f"\n> {printable}")
    try:
        subprocess.run(command, cwd=cwd, check=True)
    except FileNotFoundError:
        die(f"명령을 찾을 수 없습니다: {command[0]}")
    except subprocess.CalledProcessError as exc:
        die(f"명령 실행에 실패했습니다. 종료 코드: {exc.returncode}")


def find_command(name: str) -> str:
    found = shutil.which(name)
    if not found:
        die(f"{name}을(를) 찾을 수 없습니다. PATH 설정을 확인하세요.")
    return found


def load_tauri_config() -> dict:
    try:
        return json.loads(TAURI_CONF.read_text(encoding="utf-8"))
    except FileNotFoundError:
        die("src-tauri/tauri.conf.json을 찾을 수 없습니다.")
    except json.JSONDecodeError as exc:
        die(f"src-tauri/tauri.conf.json 형식이 올바르지 않습니다: {exc}")


def github_repo_from_config(config: dict) -> tuple[str, str]:
    endpoints = config.get("plugins", {}).get("updater", {}).get("endpoints", [])
    for endpoint in endpoints:
        if not isinstance(endpoint, str):
            continue
        match = GITHUB_LATEST_RE.fullmatch(endpoint.strip())
        if match:
            return match.group(1), match.group(2)
    die("tauri.conf.json updater endpoints에서 GitHub latest.json 주소를 찾지 못했습니다.")


def check_updater_config(config: dict) -> None:
    if config.get("bundle", {}).get("createUpdaterArtifacts") is not True:
        die('tauri.conf.json의 bundle.createUpdaterArtifacts가 true가 아닙니다.')
    pubkey = config.get("plugins", {}).get("updater", {}).get("pubkey")
    if not isinstance(pubkey, str) or not pubkey.strip():
        die("tauri.conf.json에 updater 공개키가 없습니다.")


def check_signing_key() -> None:
    key = os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").strip()
    if not key:
        die(
            "TAURI_SIGNING_PRIVATE_KEY 환경변수가 없습니다.\n"
            "PowerShell에서 개인키 파일 경로 또는 개인키 내용을 환경변수로 설정한 뒤 다시 실행하세요.\n"
            "개인키를 release.py나 프로젝트 파일 안에 저장하지 마세요."
        )


def host_target() -> str:
    machine = platform.machine().lower()
    mapping = {
        "amd64": "windows-x86_64",
        "x86_64": "windows-x86_64",
        "x64": "windows-x86_64",
        "arm64": "windows-aarch64",
        "aarch64": "windows-aarch64",
        "x86": "windows-i686",
        "i386": "windows-i686",
        "i686": "windows-i686",
    }
    target = mapping.get(machine)
    if not target:
        die(f"지원하지 않는 Windows 아키텍처입니다: {platform.machine()}")
    return target


def prompt_version(current: str) -> str:
    print(f"현재 버전: {current}")
    value = input(f"릴리즈 버전 (현재 {current}, 예: 1.0.4): ").strip()
    return value


def prompt_notes() -> str:
    print("\n업데이트 내용을 입력하세요. 여러 줄 입력 가능, 빈 줄에서 Enter를 누르면 완료됩니다.")
    lines: list[str] = []
    while True:
        line = input("  > " if not lines else "    ")
        if not line.strip():
            break
        lines.append(line.rstrip())
    return "\n".join(lines).strip()


def ensure_versions_match() -> str:
    versions = bump_version.read_current_versions()
    if len(set(versions)) != 1:
        die(
            "현재 버전이 서로 다릅니다.\n"
            f"package.json={versions[0]}, tauri.conf.json={versions[1]}, Cargo.toml={versions[2]}"
        )
    return versions[0]


def set_version(version: str) -> None:
    package_data = bump_version.read_json(bump_version.PACKAGE_JSON)
    tauri_data = bump_version.read_json(bump_version.TAURI_CONF)
    package_data["version"] = version
    tauri_data["version"] = version
    bump_version.write_json(bump_version.PACKAGE_JSON, package_data)
    bump_version.write_json(bump_version.TAURI_CONF, tauri_data)
    bump_version.update_cargo_version(version)


def prepare_output_dir(version: str, force: bool) -> Path:
    output_dir = OUTPUT_ROOT / f"v{version}"
    if output_dir.exists():
        if not force:
            die(
                f"출력 폴더가 이미 있습니다: {output_dir.relative_to(ROOT)}\n"
                "다시 만들려면 --force 옵션을 사용하세요."
            )
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def clean_old_nsis_artifacts() -> None:
    if NSIS_DIR.exists():
        shutil.rmtree(NSIS_DIR)


def find_nsis_artifacts() -> tuple[Path, Path]:
    if not NSIS_DIR.exists():
        die("NSIS 빌드 폴더가 생성되지 않았습니다.")

    installers = sorted(NSIS_DIR.glob("*.exe"))
    signed: list[tuple[Path, Path]] = []
    for installer in installers:
        signature = Path(str(installer) + ".sig")
        if signature.is_file():
            signed.append((installer, signature))

    if not signed:
        die(
            "서명된 NSIS 설치파일을 찾지 못했습니다.\n"
            "src-tauri/target/release/bundle/nsis 안에 .exe와 대응하는 .exe.sig가 있어야 합니다."
        )
    if len(signed) != 1:
        names = ", ".join(pair[0].name for pair in signed)
        die(f"서명된 NSIS 설치파일이 여러 개라 자동 선택할 수 없습니다: {names}")
    return signed[0]


def build_latest_json(
    *,
    version: str,
    notes: str,
    target: str,
    owner: str,
    repo: str,
    installer_name: str,
    signature: str,
) -> dict:
    tag = f"v{version}"
    encoded_name = quote(installer_name)
    download_url = f"https://github.com/{owner}/{repo}/releases/download/{tag}/{encoded_name}"
    return {
        "version": version,
        "notes": notes,
        "pub_date": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "platforms": {
            target: {
                "signature": signature,
                "url": download_url,
            }
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="햄보드 Windows 릴리즈 빌드 + GitHub 업로드 파일 준비"
    )
    parser.add_argument("version", nargs="?", help="릴리즈 버전 (현재 버전과 같아도 됨, 예: 1.0.4)")
    parser.add_argument("--notes", help="latest.json에 넣을 업데이트 내용")
    parser.add_argument("--force", action="store_true", help="같은 버전의 release-output 폴더 덮어쓰기")
    parser.add_argument(
        "--check",
        action="store_true",
        help="빌드하지 않고 현재 릴리즈 설정과 도구만 점검",
    )
    return parser.parse_args()


def preflight(config: dict) -> tuple[str, str, str]:
    if os.name != "nt":
        die("이 릴리즈 스크립트는 Windows에서 실행해야 합니다.")
    npm = find_command("npm")
    find_command("cargo")
    find_command("rustc")
    check_updater_config(config)
    check_signing_key()
    owner, repo = github_repo_from_config(config)
    return npm, owner, repo


def main() -> None:
    args = parse_args()
    print("햄보드 릴리즈 준비 도구")
    print("=" * 36)

    config = load_tauri_config()
    current_version = ensure_versions_match()
    npm, owner, repo = preflight(config)
    target = host_target()

    print(f"GitHub 저장소 : {owner}/{repo}")
    print(f"업데이트 대상 : {target}")
    print("서명 개인키    : 환경변수에서 확인됨 (내용은 표시하지 않음)")

    if args.check:
        print("\n점검 완료. 릴리즈 빌드에 필요한 기본 설정이 준비되어 있습니다.")
        return

    version = (args.version or prompt_version(current_version)).strip()
    if not bump_version.VERSION_RE.fullmatch(version):
        die("버전은 1.0.5처럼 숫자.숫자.숫자 형식이어야 합니다.")
    same_version = version == current_version

    notes = args.notes if args.notes is not None else prompt_notes()
    output_dir = prepare_output_dir(version, args.force)

    print("\n릴리즈 준비를 시작합니다.")
    print(f"버전         : {current_version}" if same_version else f"버전         : {current_version} -> {version}")
    print(f"출력 폴더    : {output_dir.relative_to(ROOT)}")

    if not same_version:
        set_version(version)

        # package-lock.json은 손으로 수정하지 않고 npm 명령의 결과로만 동기화한다.
        run([npm, "install", "--package-lock-only", "--ignore-scripts"])
    else:
        print("현재 소스 버전을 그대로 릴리즈합니다. 버전 파일은 변경하지 않습니다.")

    # 이전 버전 NSIS 산출물이 섞이지 않도록 생성물 폴더만 정리한다.
    clean_old_nsis_artifacts()

    # Cargo.lock은 Tauri/Cargo 빌드 과정에서 필요한 경우 자연스럽게 갱신된다.
    run([npm, "run", "tauri", "--", "build", "--bundles", "nsis"])

    installer, signature_file = find_nsis_artifacts()
    signature = signature_file.read_text(encoding="utf-8").strip()
    if not signature:
        die(f"서명 파일이 비어 있습니다: {signature_file}")

    copied_installer = output_dir / "hamboard_setup.exe"
    copied_signature = output_dir / "hamboard_setup.exe.sig"
    shutil.copy2(installer, copied_installer)
    shutil.copy2(signature_file, copied_signature)

    latest = build_latest_json(
        version=version,
        notes=notes,
        target=target,
        owner=owner,
        repo=repo,
        installer_name=copied_installer.name,
        signature=signature,
    )
    latest_path = output_dir / "latest.json"
    latest_path.write_text(
        json.dumps(latest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("\n완료!")
    print(f"GitHub Release 태그는 v{version} 으로 만들고 아래 파일을 모두 업로드하세요.")
    for path in sorted(output_dir.iterdir()):
        print(f" - {path.name}")
    print(f"\n업로드 폴더: {output_dir}")
    print("개인키는 출력 폴더나 latest.json에 포함되지 않았습니다.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n취소되었습니다.")
        sys.exit(130)
