# 햄보드 모바일 Vercel 배포

이 저장소 구조에서는 Vercel의 **Root Directory를 `app/mobile`** 로 지정합니다.

모바일 원본은 `app/mobile/web/mobile`에 있고, 데스크톱과 공유하는 Repository/동기화 모듈의 원본은 `app/window/web/shared`에 한 벌만 유지합니다. 모바일 빌드는 해당 공유 모듈을 읽어 `dist-mobile/shared`로 복사합니다.

## Vercel 설정

1. GitHub 저장소를 Vercel에 연결합니다.
2. Root Directory: `app/mobile`
3. Framework Preset: `Other`
4. Root Directory 밖의 소스 파일을 빌드에 포함하는 옵션(Include source files outside of the Root Directory)을 활성화합니다. `../window/web/shared`를 읽기 위해 필요합니다.
5. 환경 변수 `HAMBOARD_GOOGLE_OAUTH_CLIENT_ID`에 Google 웹 OAuth 클라이언트 ID를 넣고 Production에 적용합니다.
6. Deploy 합니다.
7. 발급된 고정 Production 주소를 Google Cloud의 승인된 JavaScript 원본에 등록합니다.

`dist-mobile`은 생성물이라 Git에 올리지 않습니다.

## 로컬 빌드

```powershell
cd app/mobile
npm run mobile:build
```

생성 결과는 `app/mobile/dist-mobile`에 생깁니다.
