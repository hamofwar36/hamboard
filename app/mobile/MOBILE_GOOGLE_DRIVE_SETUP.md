# 햄보드 모바일 Google Drive 연결

모바일 웹은 PC판과 같은 Google Drive `appDataFolder`와 같은 sync commit 형식을 읽습니다. PC판에서 사용하는 데스크톱 OAuth 클라이언트는 브라우저에서 재사용하지 않고, **같은 Google Cloud 프로젝트**에 웹 애플리케이션용 OAuth 클라이언트를 하나 추가합니다.

1. PC판 OAuth를 만든 Google Cloud 프로젝트를 엽니다.
2. Google Drive API가 활성화되어 있는지 확인합니다.
3. OAuth 동의 화면이 테스트 상태라면 사용할 Google 계정을 테스트 사용자로 등록합니다.
4. `API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID`에서 유형을 `웹 애플리케이션`으로 선택합니다.
5. 승인된 JavaScript 원본에 실제 모바일 웹 주소의 원본을 등록합니다. 경로는 넣지 않습니다.
   - PC 로컬 확인: `http://localhost:1430`
   - 휴대폰 사용: 배포한 `https://...` 주소
6. 생성된 `…apps.googleusercontent.com` 클라이언트 ID를 모바일 화면의 `로컬/로그인` 배지를 눌러 입력합니다.
7. Google 로그인 후 같은 계정의 PC 동기화 데이터를 불러옵니다.

휴대폰에서 사용한 `http://IP주소:1430`은 Google 웹 로그인의 승인된 보안 원본으로 사용할 수 없습니다. 휴대폰 실기기 로그인 QA에는 HTTPS 주소가 필요합니다. 웹 클라이언트 보안 비밀은 모바일 코드나 화면에 입력하지 않습니다.

모바일은 PC와 같은 commit/lease 형식으로 양방향 자동 동기화합니다. 동작 방식과 기기 전환 규칙은 저장소 최상위의 `DEVICE_HANDOFF.md`를 참고하세요.
