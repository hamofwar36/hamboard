# Hamboard repository layout

이 폴더가 GitHub에 올릴 기준 루트입니다.

- `window/`: Windows Tauri 2 데스크톱 햄보드의 source of truth
- `mobile/`: 모바일 웹앱 source와 Vercel 배포 설정
- `.gitignore`, `README.md`: 저장소 공통 파일

## 모바일 작업 범위

일반적인 모바일 UI/기능 수정은 `mobile/**`만 수정합니다.

단, PC와 모바일이 함께 사용하는 동기화 규격 또는 Repository 계약이 바뀌는 경우에만 `window/web/shared/**`도 함께 수정합니다. `window/web/shared`가 공유 모듈의 유일한 원본이며, 모바일 빌드가 이를 복사해 배포합니다.

## Vercel

Vercel Root Directory는 `app/mobile`로 지정합니다. 자세한 내용은 `mobile/MOBILE_VERCEL_DEPLOY.md`를 봅니다.

## Desktop

기존 데스크톱 프로젝트 구조는 `window/` 안에 그대로 유지했습니다. `window/src-tauri/tauri.conf.json`의 `frontendDist: ../web` 관계도 그대로입니다.
