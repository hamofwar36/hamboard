use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

#[tauri::command]
pub async fn google_drive_put_object(
    app: tauri::AppHandle,
    state: tauri::State<'_, GoogleDriveAuthState>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::put_object(app, state.inner(), request).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, request);
        Err("[google-drive-platform-unsupported] Google Drive 업로드는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_list_backups(
    state: tauri::State<'_, GoogleDriveAuthState>,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::list_backups(state.inner()).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("[google-drive-platform-unsupported] Google Drive 백업 조회는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_get_object(
    app: tauri::AppHandle,
    state: tauri::State<'_, GoogleDriveAuthState>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::get_object(app, state.inner(), request).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, request);
        Err("[google-drive-platform-unsupported] Google Drive 백업 다운로드는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_delete_backup_manifest(
    state: tauri::State<'_, GoogleDriveAuthState>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::delete_backup_manifest(state.inner(), request).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, request);
        Err("[google-drive-platform-unsupported] Google Drive 백업 교체는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_list_sync_objects(
    state: tauri::State<'_, GoogleDriveAuthState>,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::list_sync_objects(state.inner()).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Err("[google-drive-platform-unsupported] Google Drive 동기화 조회는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_get_sync_object(
    state: tauri::State<'_, GoogleDriveAuthState>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::get_sync_object(state.inner(), request).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, request);
        Err("[google-drive-platform-unsupported] Google Drive 동기화 다운로드는 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub async fn google_drive_delete_sync_object(
    state: tauri::State<'_, GoogleDriveAuthState>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        drive_upload::delete_sync_object(state.inner(), request).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (state, request);
        Err("[google-drive-platform-unsupported] Google Drive 동기화 정리는 Windows 풀 버전에서 지원합니다.".into())
    }
}

pub struct GoogleDriveAuthState {
    login_in_progress: AtomicBool,
    access_token: Mutex<Option<CachedAccessToken>>,
    object_index: Mutex<Option<CachedObjectIndex>>,
}

impl Default for GoogleDriveAuthState {
    fn default() -> Self {
        Self {
            login_in_progress: AtomicBool::new(false),
            access_token: Mutex::new(None),
            object_index: Mutex::new(None),
        }
    }
}

struct CachedAccessToken {
    value: String,
    expires_at_ms: u64,
}

#[derive(Clone)]
struct RemoteDriveObject {
    id: String,
    object_key: String,
    content_sha256: String,
    byte_size: u64,
}

struct CachedObjectIndex {
    loaded_at_ms: u64,
    entries: HashMap<String, RemoteDriveObject>,
}

fn configured_client_id() -> Option<&'static str> {
    option_env!("HAMBOARD_GOOGLE_OAUTH_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn configured_client_secret() -> Option<&'static str> {
    option_env!("HAMBOARD_GOOGLE_OAUTH_CLIENT_SECRET")
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn oauth_configured() -> bool {
    configured_client_id().is_some() && configured_client_secret().is_some()
}

fn status_value(configured: bool, connected: bool, busy: bool) -> Value {
    json!({
        "provider": "google-drive",
        "configured": configured,
        "connected": connected,
        "busy": busy,
        "scope": "drive.appdata"
    })
}

#[tauri::command]
pub fn google_drive_status(
    state: tauri::State<'_, GoogleDriveAuthState>,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    let connected = oauth_configured() && credential_store::read_refresh_token()?.is_some();
    #[cfg(not(target_os = "windows"))]
    let connected = false;

    Ok(status_value(
        oauth_configured(),
        connected,
        state.login_in_progress.load(Ordering::Acquire),
    ))
}

#[tauri::command]
pub async fn google_drive_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, GoogleDriveAuthState>,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    {
        connect_windows(app, state.inner()).await
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state);
        Err("[google-drive-platform-unsupported] Google Drive 연결은 Windows 풀 버전에서 지원합니다.".into())
    }
}

#[tauri::command]
pub fn google_drive_disconnect(
    state: tauri::State<'_, GoogleDriveAuthState>,
) -> Result<Value, String> {
    #[cfg(target_os = "windows")]
    credential_store::delete_refresh_token()?;

    let mut cached = state
        .access_token
        .lock()
        .map_err(|_| "[google-drive-token-lock-failed] Google Drive 인증 상태를 초기화하지 못했습니다.".to_string())?;
    *cached = None;
    let mut object_index = state
        .object_index
        .lock()
        .map_err(|_| "[google-drive-index-lock-failed] Google Drive 파일 목록을 초기화하지 못했습니다.".to_string())?;
    *object_index = None;
    Ok(status_value(oauth_configured(), false, false))
}

#[cfg(target_os = "windows")]
mod windows_oauth {
    use super::{configured_client_id, configured_client_secret, CachedAccessToken, GoogleDriveAuthState};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use rand::{rngs::OsRng, RngCore};
    use reqwest::header::CONTENT_TYPE;
    use serde_json::Value;
    use sha2::{Digest, Sha256};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::{TcpListener, TcpStream},
        sync::atomic::{AtomicBool, Ordering},
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri_plugin_opener::OpenerExt;
    use url::Url;

    const AUTHORIZE_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
    const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
    const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
    const DRIVE_CHECK_URL: &str =
        "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1&fields=files(id)";
    const CALLBACK_PATH: &str = "/";
    const CALLBACK_TIMEOUT: Duration = Duration::from_secs(300);

    struct LoginGuard<'a>(&'a AtomicBool);

    impl Drop for LoginGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }

    pub async fn connect(
        app: tauri::AppHandle,
        state: &GoogleDriveAuthState,
    ) -> Result<Value, String> {
        let client_id = configured_client_id().ok_or_else(|| {
            "[google-oauth-client-id-not-configured] 이 빌드에는 Google OAuth 클라이언트 ID가 설정되지 않았습니다.".to_string()
        })?;
        let client_secret = configured_client_secret().ok_or_else(|| {
            "[google-oauth-client-secret-not-configured] 이 빌드에는 Google OAuth 데스크톱 클라이언트 보안 비밀이 설정되지 않았습니다.".to_string()
        })?;
        if state
            .login_in_progress
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err("[google-oauth-login-in-progress] Google Drive 연결 창이 이미 열려 있습니다.".into());
        }
        let _login_guard = LoginGuard(&state.login_in_progress);

        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| {
            "[google-oauth-loopback-bind-failed] Google 로그인 응답을 받을 로컬 포트를 열지 못했습니다.".to_string()
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "[google-oauth-loopback-config-failed] Google 로그인 수신기를 준비하지 못했습니다.".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "[google-oauth-loopback-address-failed] Google 로그인 수신 주소를 확인하지 못했습니다.".to_string())?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

        let code_verifier = random_url_safe(64);
        let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
        let csrf_state = random_url_safe(32);
        let mut auth_url = Url::parse(AUTHORIZE_URL)
            .map_err(|_| "[google-oauth-authorize-url-invalid] Google 로그인 주소를 만들지 못했습니다.".to_string())?;
        auth_url.query_pairs_mut()
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("scope", DRIVE_SCOPE)
            .append_pair("code_challenge", &code_challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &csrf_state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");

        app.opener()
            .open_url(auth_url.as_str(), None::<&str>)
            .map_err(|_| "[google-oauth-browser-open-failed] Google 로그인 브라우저를 열지 못했습니다.".to_string())?;

        let callback_state = csrf_state.clone();
        let authorization_code = tauri::async_runtime::spawn_blocking(move || {
            wait_for_callback(listener, &callback_state)
        })
        .await
        .map_err(|_| "[google-oauth-callback-task-failed] Google 로그인 응답 처리가 중단되었습니다.".to_string())??;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "[google-oauth-http-client-failed] Google 연결을 준비하지 못했습니다.".to_string())?;
        let token = exchange_code(
            &client,
            client_id,
            client_secret,
            &redirect_uri,
            &authorization_code,
            &code_verifier,
        )
        .await?;
        verify_drive_access(&client, &token.access_token).await?;

        super::credential_store::write_refresh_token(&token.refresh_token)?;
        let mut cached = state
            .access_token
            .lock()
            .map_err(|_| "[google-drive-token-lock-failed] Google Drive 인증 상태를 저장하지 못했습니다.".to_string())?;
        *cached = Some(CachedAccessToken {
            value: token.access_token,
            expires_at_ms: now_ms().saturating_add(token.expires_in.saturating_mul(1_000)),
        });
        if let Ok(mut index) = state.object_index.lock() {
            *index = None;
        }
        Ok(super::status_value(true, true, false))
    }

    pub async fn access_token(state: &GoogleDriveAuthState) -> Result<String, String> {
        {
            let cached = state
                .access_token
                .lock()
                .map_err(|_| "[google-drive-token-lock-failed] Google Drive 인증 상태를 읽지 못했습니다.".to_string())?;
            if let Some(token) = cached.as_ref() {
                if token.expires_at_ms > now_ms().saturating_add(60_000) {
                    return Ok(token.value.clone());
                }
            }
        }

        let client_id = configured_client_id().ok_or_else(|| {
            "[google-oauth-client-id-not-configured] 이 빌드에는 Google OAuth 클라이언트 ID가 설정되지 않았습니다.".to_string()
        })?;
        let client_secret = configured_client_secret().ok_or_else(|| {
            "[google-oauth-client-secret-not-configured] 이 빌드에는 Google OAuth 데스크톱 클라이언트 보안 비밀이 설정되지 않았습니다.".to_string()
        })?;
        let refresh_token = super::credential_store::read_refresh_token()?.ok_or_else(|| {
            "[google-drive-not-connected] Google Drive 연결이 필요합니다.".to_string()
        })?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "[google-oauth-http-client-failed] Google 연결을 준비하지 못했습니다.".to_string())?;
        let token = match refresh_access_token(&client, client_id, client_secret, &refresh_token).await {
            Ok(value) => value,
            Err(error) if error.contains("invalid_grant") => {
                let _ = super::credential_store::delete_refresh_token();
                if let Ok(mut cached) = state.access_token.lock() {
                    *cached = None;
                }
                return Err(format!(
                    "[google-drive-reconnect-required] Google Drive 연결이 만료되어 다시 로그인이 필요합니다. {error}"
                ));
            }
            Err(error) => return Err(error),
        };
        let mut cached = state
            .access_token
            .lock()
            .map_err(|_| "[google-drive-token-lock-failed] Google Drive 인증 상태를 저장하지 못했습니다.".to_string())?;
        *cached = Some(CachedAccessToken {
            value: token.access_token.clone(),
            expires_at_ms: now_ms().saturating_add(token.expires_in.saturating_mul(1_000)),
        });
        Ok(token.access_token)
    }

    struct TokenResponse {
        access_token: String,
        refresh_token: String,
        expires_in: u64,
    }

    struct RefreshedToken {
        access_token: String,
        expires_in: u64,
    }

    async fn exchange_code(
        client: &reqwest::Client,
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
        code: &str,
        code_verifier: &str,
    ) -> Result<TokenResponse, String> {
        let body = form_body(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ]);
        let value = token_request(client, body, "google-oauth-code-exchange").await?;
        let access_token = required_token_field(&value, "access_token", "google-oauth-access-token-missing")?;
        let refresh_token = required_token_field(&value, "refresh_token", "google-oauth-refresh-token-missing")?;
        Ok(TokenResponse {
            access_token,
            refresh_token,
            expires_in: value.get("expires_in").and_then(Value::as_u64).unwrap_or(3_600),
        })
    }

    async fn refresh_access_token(
        client: &reqwest::Client,
        client_id: &str,
        client_secret: &str,
        refresh_token: &str,
    ) -> Result<RefreshedToken, String> {
        let body = form_body(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ]);
        let value = token_request(client, body, "google-oauth-token-refresh").await?;
        Ok(RefreshedToken {
            access_token: required_token_field(
                &value,
                "access_token",
                "google-oauth-access-token-missing",
            )?,
            expires_in: value.get("expires_in").and_then(Value::as_u64).unwrap_or(3_600),
        })
    }

    async fn token_request(
        client: &reqwest::Client,
        body: String,
        stage: &str,
    ) -> Result<Value, String> {
        let response = client
            .post(TOKEN_URL)
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| format!("[{stage}-network-failed] Google 인증 서버에 연결하지 못했습니다."))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|_| format!("[{stage}-response-read-failed] Google 인증 응답을 읽지 못했습니다."))?;
        let value: Value = serde_json::from_slice(&bytes)
            .map_err(|_| format!("[{stage}-response-invalid] Google 인증 응답 형식이 올바르지 않습니다."))?;
        if !status.is_success() {
            let error_code = value
                .get("error")
                .and_then(Value::as_str)
                .filter(|value| value.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_'))
                .unwrap_or("oauth_error");
            let error_description = value
                .get("error_description")
                .and_then(Value::as_str)
                .map(safe_oauth_error_description)
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "상세 원인 없음".to_string());
            return Err(format!(
                "[{stage}-rejected] Google 인증 요청이 거절되었습니다 ({error_code}, HTTP {}, 원인: {error_description}).",
                status.as_u16(),
            ));
        }
        Ok(value)
    }

    fn safe_oauth_error_description(value: &str) -> String {
        value
            .chars()
            .filter(|ch| !ch.is_control())
            .take(240)
            .collect::<String>()
            .trim()
            .to_string()
    }

    async fn verify_drive_access(
        client: &reqwest::Client,
        access_token: &str,
    ) -> Result<(), String> {
        let response = client
            .get(DRIVE_CHECK_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|_| "[google-drive-scope-check-network-failed] Google Drive 권한을 확인하지 못했습니다.".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "[google-drive-scope-check-failed] Google Drive 앱 데이터 권한을 확인하지 못했습니다 (HTTP {}).",
                response.status().as_u16()
            ));
        }
        Ok(())
    }

    fn required_token_field(value: &Value, key: &str, code: &str) -> Result<String, String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("[{code}] Google 인증 응답에 필요한 토큰이 없습니다."))
    }

    fn form_body(fields: &[(&str, &str)]) -> String {
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in fields {
            serializer.append_pair(key, value);
        }
        serializer.finish()
    }

    fn random_url_safe(byte_count: usize) -> String {
        let mut bytes = vec![0_u8; byte_count];
        OsRng.fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn wait_for_callback(listener: TcpListener, expected_state: &str) -> Result<String, String> {
        let deadline = Instant::now() + CALLBACK_TIMEOUT;
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => match read_callback(&mut stream, expected_state) {
                    Ok(Some(code)) => return Ok(code),
                    Ok(None) => continue,
                    Err(error) => return Err(error),
                },
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err("[google-oauth-callback-timeout] Google 로그인이 5분 안에 완료되지 않았습니다.".into());
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => {
                    return Err("[google-oauth-callback-listen-failed] Google 로그인 응답을 받지 못했습니다.".into())
                }
            }
        }
    }

    fn read_callback(
        stream: &mut TcpStream,
        expected_state: &str,
    ) -> Result<Option<String>, String> {
        stream
            .set_nonblocking(false)
            .map_err(|_| "[google-oauth-callback-config-failed] Google 로그인 응답 방식을 설정하지 못했습니다.".to_string())?;
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|_| "[google-oauth-callback-config-failed] Google 로그인 응답 시간을 설정하지 못했습니다.".to_string())?;
        let mut request_line = String::new();
        BufReader::new(&mut *stream)
            .take(8_192)
            .read_line(&mut request_line)
            .map_err(|_| "[google-oauth-callback-read-failed] Google 로그인 응답을 읽지 못했습니다.".to_string())?;
        if request_line.len() >= 8_192 || !request_line.ends_with('\n') {
            return Err("[google-oauth-callback-too-large] Google 로그인 응답이 허용 크기를 넘었습니다.".into());
        }
        let target = request_line
            .split_whitespace()
            .nth(1)
            .ok_or_else(|| "[google-oauth-callback-invalid] Google 로그인 응답 형식이 올바르지 않습니다.".to_string())?;
        let callback = Url::parse(&format!("http://127.0.0.1{target}"))
            .map_err(|_| "[google-oauth-callback-url-invalid] Google 로그인 응답 주소가 올바르지 않습니다.".to_string())?;
        if callback.path() != CALLBACK_PATH {
            write_browser_response(stream, 404, "햄보드 Google Drive 연결 주소가 아닙니다.");
            return Ok(None);
        }

        let mut code = None;
        let mut returned_state = None;
        let mut oauth_error = None;
        for (key, value) in callback.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => returned_state = Some(value.into_owned()),
                "error" => oauth_error = Some(value.into_owned()),
                _ => {}
            }
        }
        if returned_state.as_deref() != Some(expected_state) {
            write_browser_response(stream, 400, "로그인 확인 값이 일치하지 않습니다. 햄보드로 돌아가 다시 시도해 주세요.");
            return Err("[google-oauth-state-mismatch] Google 로그인 확인 값이 일치하지 않습니다.".into());
        }
        if let Some(error) = oauth_error {
            write_browser_response(stream, 400, "Google Drive 연결이 취소되었거나 허용되지 않았습니다. 햄보드로 돌아가 다시 시도할 수 있습니다.");
            let safe_error = if error.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                error
            } else {
                "oauth_error".to_string()
            };
            return Err(format!("[google-oauth-user-denied] Google Drive 연결이 완료되지 않았습니다 ({safe_error})."));
        }
        let code = code.filter(|value| !value.is_empty()).ok_or_else(|| {
            "[google-oauth-code-missing] Google 로그인 응답에 인증 코드가 없습니다.".to_string()
        })?;
        write_browser_response(stream, 200, "브라우저 인증 응답을 받았습니다. 이 창을 닫고 햄보드에서 최종 연결 결과를 확인해 주세요.");
        Ok(Some(code))
    }

    fn write_browser_response(stream: &mut TcpStream, status: u16, message: &str) {
        let reason = if status == 200 { "OK" } else { "Bad Request" };
        let body = format!(
            "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><title>햄보드 Google Drive</title><body style=\"font-family:sans-serif;padding:40px;line-height:1.6\"><h1>햄보드</h1><p>{message}</p></body></html>"
        );
        let response = format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
            body.as_bytes().len()
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }
}

#[cfg(target_os = "windows")]
async fn connect_windows(
    app: tauri::AppHandle,
    state: &GoogleDriveAuthState,
) -> Result<Value, String> {
    windows_oauth::connect(app, state).await
}

#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub async fn access_token(state: &GoogleDriveAuthState) -> Result<String, String> {
    windows_oauth::access_token(state).await
}

#[cfg(target_os = "windows")]
fn clear_cached_access_token(state: &GoogleDriveAuthState) {
    if let Ok(mut cached) = state.access_token.lock() {
        *cached = None;
    }
}

#[cfg(target_os = "windows")]
mod drive_upload {
    use super::{
        access_token, clear_cached_access_token, CachedObjectIndex, GoogleDriveAuthState,
        RemoteDriveObject,
    };
    use reqwest::header::{
        AUTHORIZATION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, LOCATION, RANGE,
    };
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        fs::File,
        io::{Read, Seek, SeekFrom, Write},
        path::{Component, Path, PathBuf},
        time::{Duration, SystemTime, UNIX_EPOCH},
    };
    use tauri::Manager;
    use url::Url;

    const DRIVE_LIST_URL: &str = "https://www.googleapis.com/drive/v3/files";
    const DRIVE_UPLOAD_URL: &str =
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,appProperties";
    const CHUNK_SIZE: usize = 8 * 1024 * 1024;
    const STAGING_FILE: &str = "cloud-upload-stage.bin";
    const OBJECT_INDEX_TTL_MS: u64 = 15 * 60 * 1_000;
    const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
    const MAX_BACKUP_LIST: usize = 100;
    // Commits, leases, and one descriptor per Asset/quality share this index.
    // Keep the safety bound high enough for libraries containing thousands of images.
    const MAX_SYNC_OBJECTS: usize = 50_000;
    const MAX_SYNC_OBJECT_BYTES: u64 = 16 * 1024 * 1024;

    enum UploadSource {
        File(PathBuf),
        Text(Vec<u8>),
    }

    impl UploadSource {
        async fn inspect(&self) -> Result<(u64, String), String> {
            match self {
                Self::File(path) => {
                    let path = path.clone();
                    tauri::async_runtime::spawn_blocking(move || inspect_file(&path))
                        .await
                        .map_err(|_| {
                            "[google-drive-source-inspect-task-failed] 업로드 파일 검사가 중단되었습니다."
                                .to_string()
                        })?
                }
                Self::Text(bytes) => Ok((bytes.len() as u64, sha256_hex(bytes))),
            }
        }

        async fn read_chunk(&self, offset: u64, length: usize) -> Result<Vec<u8>, String> {
            match self {
                Self::File(path) => {
                    let path = path.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let mut file = File::open(path).map_err(|_| {
                            "[google-drive-source-open-failed] 업로드할 파일을 열지 못했습니다."
                                .to_string()
                        })?;
                        file.seek(SeekFrom::Start(offset)).map_err(|_| {
                            "[google-drive-source-seek-failed] 업로드할 파일 위치를 읽지 못했습니다."
                                .to_string()
                        })?;
                        let mut bytes = vec![0_u8; length];
                        file.read_exact(&mut bytes).map_err(|_| {
                            "[google-drive-source-read-failed] 업로드할 파일 일부를 읽지 못했습니다."
                                .to_string()
                        })?;
                        Ok(bytes)
                    })
                    .await
                    .map_err(|_| {
                        "[google-drive-source-read-task-failed] 업로드 파일 읽기가 중단되었습니다."
                            .to_string()
                    })?
                }
                Self::Text(bytes) => {
                    let start = usize::try_from(offset).map_err(|_| {
                        "[google-drive-source-range-invalid] 업로드 범위가 올바르지 않습니다."
                            .to_string()
                    })?;
                    let end = start.checked_add(length).ok_or_else(|| {
                        "[google-drive-source-range-invalid] 업로드 범위가 올바르지 않습니다."
                            .to_string()
                    })?;
                    bytes.get(start..end).map(Vec::from).ok_or_else(|| {
                        "[google-drive-source-range-invalid] 업로드 범위가 파일을 벗어났습니다."
                            .to_string()
                    })
                }
            }
        }
    }

    pub async fn put_object(
        app: tauri::AppHandle,
        state: &GoogleDriveAuthState,
        request: Value,
    ) -> Result<Value, String> {
        let object_key = required_string(&request, "objectKey", "google-drive-object-key-missing")?;
        validate_object_key(&object_key)?;
        let expected_sha = required_string(
            &request,
            "contentSha256",
            "google-drive-content-hash-missing",
        )?
        .to_ascii_lowercase();
        if !is_sha256(&expected_sha) {
            return Err("[google-drive-content-hash-invalid] 업로드 내용 해시가 올바르지 않습니다.".into());
        }
        let mime_type = required_string(&request, "mimeType", "google-drive-mime-missing")?;
        if mime_type.len() > 255 || mime_type.chars().any(|ch| ch == '\r' || ch == '\n') {
            return Err("[google-drive-mime-invalid] 업로드 파일 형식이 올바르지 않습니다.".into());
        }
        let kind = required_string(&request, "kind", "google-drive-object-kind-missing")?;
        if kind != "asset" && kind != "manifest" && kind != "sync" {
            return Err("[google-drive-object-kind-invalid] 업로드 항목 종류가 올바르지 않습니다.".into());
        }
        let source_kind = required_string(&request, "source", "google-drive-source-missing")?;
        let source = match source_kind.as_str() {
            "file" => {
                let relative_path = required_string(
                    &request,
                    "relativePath",
                    "google-drive-source-path-missing",
                )?;
                UploadSource::File(resolve_upload_path(&app, &relative_path)?)
            }
            "text" if kind == "manifest" || kind == "sync" => UploadSource::Text(
                request
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        "[google-drive-text-content-missing] 업로드할 manifest 내용이 없습니다."
                            .to_string()
                    })?
                    .as_bytes()
                    .to_vec(),
            ),
            _ => {
                return Err(
                    "[google-drive-source-invalid] 업로드 원본 종류가 올바르지 않습니다.".into(),
                )
            }
        };

        let (byte_size, actual_sha) = source.inspect().await?;
        if byte_size == 0 {
            return Err("[google-drive-source-empty] 빈 파일은 온라인 백업에 올릴 수 없습니다.".into());
        }
        if actual_sha != expected_sha {
            return Err("[google-drive-source-hash-mismatch] 준비 후 파일 내용이 달라져 업로드를 중단했습니다.".into());
        }
        let declared_size = request
            .get("byteSize")
            .and_then(Value::as_u64)
            .unwrap_or(byte_size);
        if declared_size != byte_size {
            return Err("[google-drive-source-size-mismatch] 준비 후 파일 크기가 달라져 업로드를 중단했습니다.".into());
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| {
                "[google-drive-http-client-failed] Google Drive 업로드를 준비하지 못했습니다."
                    .to_string()
            })?;
        let token = access_token(state).await?;
        if let Some(existing) = find_existing(
            &client,
            state,
            &token,
            &object_key,
            &expected_sha,
            byte_size,
        )
        .await?
        {
            return Ok(json!({
                "remoteObjectId": existing,
                "contentSha256": expected_sha,
                "uploadByteSize": byte_size,
                "uploadMimeType": mime_type,
                "reused": true
            }));
        }

        let backup_id = request
            .get("backupId")
            .and_then(Value::as_str)
            .unwrap_or("");
        let name = drive_name(&kind, backup_id, &expected_sha);
        let mut app_properties = serde_json::Map::from_iter([
            ("hamboardObjectKey".to_string(), Value::String(object_key.clone())),
            ("hamboardContentSha256".to_string(), Value::String(expected_sha.clone())),
            ("hamboardByteSize".to_string(), Value::String(byte_size.to_string())),
            ("hamboardFormatVersion".to_string(), Value::String("1".to_string())),
            ("hamboardKind".to_string(), Value::String(kind.clone())),
        ]);
        if kind == "sync" {
            let sync_metadata = request.get("syncMetadata").and_then(Value::as_object).ok_or_else(|| {
                "[google-drive-sync-metadata-missing] 동기화 객체 정보가 없습니다.".to_string()
            })?;
            for key in ["syncType", "revision", "baseRevision", "deviceId", "displayName", "clientProfile", "createdAtMs", "expiresAtMs", "assetId", "quality"] {
                if let Some(value) = sync_metadata.get(key).and_then(Value::as_str) {
                    if value.len() > 120 || value.chars().any(char::is_control) {
                        return Err("[google-drive-sync-metadata-invalid] 동기화 객체 정보가 올바르지 않습니다.".into());
                    }
                    app_properties.insert(
                        format!("hamboard{}{}", key[..1].to_ascii_uppercase(), &key[1..]),
                        Value::String(value.to_string()),
                    );
                }
            }
            let sync_type = app_properties.get("hamboardSyncType").and_then(Value::as_str).unwrap_or("");
            if !matches!(sync_type, "commit" | "lease" | "asset") {
                return Err("[google-drive-sync-type-invalid] 동기화 객체 종류가 올바르지 않습니다.".into());
            }
        }
        let metadata = json!({
            "name": name,
            "parents": ["appDataFolder"],
            "mimeType": mime_type,
            "appProperties": app_properties
        });
        let response = client
            .post(DRIVE_UPLOAD_URL)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(CONTENT_TYPE, "application/json; charset=UTF-8")
            .header("X-Upload-Content-Type", &mime_type)
            .header("X-Upload-Content-Length", byte_size.to_string())
            .body(metadata.to_string())
            .send()
            .await
            .map_err(|_| {
                "[google-drive-upload-start-network-failed] Google Drive 업로드를 시작하지 못했습니다."
                    .to_string()
            })?;
        if !response.status().is_success() {
            return Err(drive_error(state, response.status(), "upload-start"));
        }
        let session_url = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.starts_with("https://"))
            .map(str::to_string)
            .ok_or_else(|| {
                "[google-drive-upload-session-missing] Google Drive 업로드 세션 주소가 없습니다."
                    .to_string()
            })?;

        let file = upload_chunks(
            &client,
            state,
            &session_url,
            &source,
            byte_size,
            &mime_type,
        )
        .await?;
        let remote_id = file
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "[google-drive-upload-id-missing] Google Drive가 업로드 파일 ID를 반환하지 않았습니다."
                    .to_string()
            })?;
        remember_uploaded(state, &object_key, remote_id, &expected_sha, byte_size)?;
        Ok(json!({
            "remoteObjectId": remote_id,
            "contentSha256": expected_sha,
            "uploadByteSize": byte_size,
            "uploadMimeType": mime_type,
            "reused": false
        }))
    }

    pub async fn list_backups(state: &GoogleDriveAuthState) -> Result<Value, String> {
        let client = drive_client()?;
        let token = access_token(state).await?;
        let manifests = list_manifest_objects(&client, state, &token).await?;
        let manifest_object_count = manifests.len();
        let mut backups = Vec::new();
        let mut invalid_count = 0_u64;
        let mut invalid_reasons = Vec::new();
        for remote in manifests.into_iter().take(MAX_BACKUP_LIST) {
            if remote.byte_size == 0 || remote.byte_size > MAX_MANIFEST_BYTES {
                invalid_count += 1;
                if invalid_reasons.len() < 20 {
                    invalid_reasons.push(json!({
                        "objectKey": remote.object_key,
                        "reason": "manifest-size-invalid",
                        "byteSize": remote.byte_size
                    }));
                }
                continue;
            }
            let bytes = match download_bytes(&client, state, &token, &remote).await {
                Ok(value) => value,
                Err(error) => {
                    invalid_count += 1;
                    if invalid_reasons.len() < 20 {
                        invalid_reasons.push(json!({
                            "objectKey": remote.object_key,
                            "reason": "manifest-download-failed",
                            "error": error
                        }));
                    }
                    continue;
                }
            };
            let manifest: Value = match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(_) => {
                    invalid_count += 1;
                    if invalid_reasons.len() < 20 {
                        invalid_reasons.push(json!({
                            "objectKey": remote.object_key,
                            "reason": "manifest-json-invalid"
                        }));
                    }
                    continue;
                }
            };
            let valid = manifest.get("format").and_then(Value::as_str)
                == Some("hamboard-cloud-backup")
                && manifest.get("formatVersion").and_then(Value::as_u64) == Some(1)
                && manifest.get("complete").and_then(Value::as_bool) == Some(true)
                && manifest
                    .get("backupId")
                    .and_then(Value::as_str)
                    .map(|value| !value.is_empty())
                    .unwrap_or(false);
            if !valid {
                invalid_count += 1;
                if invalid_reasons.len() < 20 {
                    invalid_reasons.push(json!({
                        "objectKey": remote.object_key,
                        "reason": "manifest-header-invalid",
                        "format": manifest.get("format").and_then(Value::as_str),
                        "formatVersion": manifest.get("formatVersion").and_then(Value::as_u64),
                        "complete": manifest.get("complete").and_then(Value::as_bool)
                    }));
                }
                continue;
            }
            backups.push(json!({
                "manifest": manifest,
                "manifestObject": {
                    "objectKey": remote.object_key,
                    "contentSha256": remote.content_sha256,
                    "byteSize": remote.byte_size,
                    "remoteObjectId": remote.id
                }
            }));
        }
        backups.sort_by(|left, right| {
            let left_date = left.pointer("/manifest/createdAt").and_then(Value::as_str).unwrap_or("");
            let right_date = right.pointer("/manifest/createdAt").and_then(Value::as_str).unwrap_or("");
            right_date.cmp(left_date)
        });
        let truncated = backups.len() >= MAX_BACKUP_LIST;
        Ok(json!({
            "provider": "google-drive",
            "backups": backups,
            "manifestObjectCount": manifest_object_count,
            "invalidCount": invalid_count,
            "invalidReasons": invalid_reasons,
            "truncated": truncated
        }))
    }

    pub async fn get_object(
        app: tauri::AppHandle,
        state: &GoogleDriveAuthState,
        request: Value,
    ) -> Result<Value, String> {
        let object_key = required_string(&request, "objectKey", "google-drive-object-key-missing")?;
        validate_object_key(&object_key)?;
        let expected_sha = required_string(&request, "contentSha256", "google-drive-content-hash-missing")?.to_ascii_lowercase();
        if !is_sha256(&expected_sha) {
            return Err("[google-drive-content-hash-invalid] 다운로드 내용 해시가 올바르지 않습니다.".into());
        }
        let expected_size = request.get("byteSize").and_then(Value::as_u64).ok_or_else(|| {
            "[google-drive-content-size-missing] 다운로드 파일 크기가 없습니다.".to_string()
        })?;
        if expected_size == 0 {
            return Err("[google-drive-content-size-invalid] 빈 파일은 복원할 수 없습니다.".into());
        }
        let target_file_name = required_string(&request, "targetFileName", "google-drive-target-missing")?;
        validate_download_file_name(&target_file_name, &expected_sha)?;
        let client = drive_client()?;
        let token = access_token(state).await?;
        let remote = find_remote_object(&client, state, &token, &object_key, &expected_sha, expected_size).await?;
        let relative_path = format!("assets/{target_file_name}");
        let app_data = app.path().app_local_data_dir().map_err(|_| {
            "[google-drive-app-data-unavailable] 앱 데이터 폴더를 찾지 못했습니다.".to_string()
        })?;
        let asset_dir = app_data.join("assets");
        std::fs::create_dir_all(&asset_dir).map_err(|_| {
            "[google-drive-download-directory-failed] 다운로드 임시 폴더를 만들지 못했습니다.".to_string()
        })?;
        let target = asset_dir.join(&target_file_name);
        if target.is_file() {
            let (size, sha) = inspect_file(&target)?;
            if size == expected_size && sha == expected_sha {
                return Ok(json!({"relativePath": relative_path, "contentSha256": sha, "byteSize": size, "reused": true}));
            }
            std::fs::remove_file(&target).map_err(|_| {
                "[google-drive-download-stale-remove-failed] 손상된 다운로드 임시 파일을 정리하지 못했습니다.".to_string()
            })?;
        }
        let temporary = asset_dir.join(format!("{target_file_name}.part"));
        if temporary.exists() {
            let _ = std::fs::remove_file(&temporary);
        }
        if let Err(error) = download_to_file(&client, state, &token, &remote, &temporary).await {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        let (size, sha) = inspect_file(&temporary)?;
        if size != expected_size || sha != expected_sha {
            let _ = std::fs::remove_file(&temporary);
            return Err("[google-drive-download-integrity-mismatch] 다운로드 파일의 크기 또는 해시가 manifest와 다릅니다.".into());
        }
        std::fs::rename(&temporary, &target).map_err(|_| {
            let _ = std::fs::remove_file(&temporary);
            "[google-drive-download-commit-failed] 검증된 다운로드 파일을 임시 저장소에 확정하지 못했습니다.".to_string()
        })?;
        Ok(json!({"relativePath": relative_path, "contentSha256": sha, "byteSize": size, "reused": false}))
    }

    pub async fn list_sync_objects(state: &GoogleDriveAuthState) -> Result<Value, String> {
        let client = drive_client()?;
        let token = access_token(state).await?;
        let mut objects = Vec::new();
        let mut page_token = String::new();
        for _ in 0..10_000 {
            let mut url = Url::parse(DRIVE_LIST_URL).map_err(|_| {
                "[google-drive-list-url-invalid] Google Drive 동기화 조회 주소를 만들지 못했습니다.".to_string()
            })?;
            url.query_pairs_mut()
                .append_pair("spaces", "appDataFolder")
                .append_pair("pageSize", "1000")
                .append_pair("orderBy", "createdTime asc")
                .append_pair("q", "trashed=false")
                .append_pair("fields", "nextPageToken,files(id,size,appProperties)");
            if !page_token.is_empty() {
                url.query_pairs_mut().append_pair("pageToken", &page_token);
            }
            let response = client
                .get(url)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .send()
                .await
                .map_err(|_| "[google-drive-sync-list-network-failed] Google Drive 동기화 목록을 불러오지 못했습니다.".to_string())?;
            if !response.status().is_success() {
                return Err(drive_error(state, response.status(), "sync-list"));
            }
            let bytes = response.bytes().await.map_err(|_| {
                "[google-drive-sync-list-read-failed] Google Drive 동기화 목록을 읽지 못했습니다.".to_string()
            })?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
                "[google-drive-sync-list-invalid] Google Drive 동기화 목록 응답이 올바르지 않습니다.".to_string()
            })?;
            for file in value.get("files").and_then(Value::as_array).into_iter().flatten() {
                let properties = match file.get("appProperties").and_then(Value::as_object) {
                    Some(value) => value,
                    None => continue,
                };
                let object_key = properties.get("hamboardObjectKey").and_then(Value::as_str).unwrap_or("");
                if properties.get("hamboardKind").and_then(Value::as_str) != Some("sync")
                    || !object_key.starts_with("sync/")
                {
                    continue;
                }
                let remote = match remote_from_file(file) {
                    Some(value) if value.byte_size > 0 && value.byte_size <= MAX_SYNC_OBJECT_BYTES => value,
                    _ => continue,
                };
                objects.push(json!({
                    "remoteObjectId": remote.id,
                    "objectKey": remote.object_key,
                    "contentSha256": remote.content_sha256,
                    "byteSize": remote.byte_size,
                    "syncType": properties.get("hamboardSyncType").and_then(Value::as_str).unwrap_or(""),
                    "revision": properties.get("hamboardRevision").and_then(Value::as_str).unwrap_or(""),
                    "baseRevision": properties.get("hamboardBaseRevision").and_then(Value::as_str).unwrap_or(""),
                    "deviceId": properties.get("hamboardDeviceId").and_then(Value::as_str).unwrap_or(""),
                    "displayName": properties.get("hamboardDisplayName").and_then(Value::as_str).unwrap_or(""),
                    "clientProfile": properties.get("hamboardClientProfile").and_then(Value::as_str).unwrap_or(""),
                    "createdAtMs": properties.get("hamboardCreatedAtMs").and_then(Value::as_str).unwrap_or("0"),
                    "expiresAtMs": properties.get("hamboardExpiresAtMs").and_then(Value::as_str).unwrap_or("0"),
                    "assetId": properties.get("hamboardAssetId").and_then(Value::as_str).unwrap_or(""),
                    "quality": properties.get("hamboardQuality").and_then(Value::as_str).unwrap_or("")
                }));
                if objects.len() >= MAX_SYNC_OBJECTS {
                    return Ok(json!({"objects": objects, "truncated": true}));
                }
            }
            page_token = value.get("nextPageToken").and_then(Value::as_str).unwrap_or("").to_string();
            if page_token.is_empty() {
                return Ok(json!({"objects": objects, "truncated": false}));
            }
        }
        Err("[google-drive-list-page-limit] Google Drive 동기화 목록이 허용 페이지 수를 넘었습니다.".into())
    }

    pub async fn get_sync_object(state: &GoogleDriveAuthState, request: Value) -> Result<Value, String> {
        let object_key = required_string(&request, "objectKey", "google-drive-object-key-missing")?;
        validate_object_key(&object_key)?;
        if !object_key.starts_with("sync/") {
            return Err("[google-drive-sync-object-key-invalid] 동기화 객체 키가 올바르지 않습니다.".into());
        }
        let remote_id = required_string(&request, "remoteObjectId", "google-drive-remote-id-missing")?;
        if remote_id.len() > 200
            || !remote_id.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
        {
            return Err("[google-drive-remote-id-invalid] Google Drive 파일 ID가 올바르지 않습니다.".into());
        }
        let expected_sha = required_string(&request, "contentSha256", "google-drive-content-hash-missing")?.to_ascii_lowercase();
        let expected_size = request
            .get("byteSize")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0 && *value <= MAX_SYNC_OBJECT_BYTES)
            .ok_or_else(|| "[google-drive-sync-size-invalid] 동기화 객체 크기가 올바르지 않습니다.".to_string())?;
        if !is_sha256(&expected_sha) {
            return Err("[google-drive-content-hash-invalid] 동기화 객체 해시가 올바르지 않습니다.".into());
        }
        let remote = RemoteDriveObject {
            id: remote_id,
            object_key,
            content_sha256: expected_sha.clone(),
            byte_size: expected_size,
        };
        let client = drive_client()?;
        let token = access_token(state).await?;
        let bytes = download_bytes(&client, state, &token, &remote).await?;
        if bytes.len() as u64 != expected_size || sha256_hex(&bytes) != expected_sha {
            return Err("[google-drive-download-integrity-mismatch] 동기화 객체의 크기 또는 해시가 Drive 정보와 다릅니다.".into());
        }
        let content = String::from_utf8(bytes).map_err(|_| {
            "[google-drive-sync-text-invalid] 동기화 객체가 UTF-8 JSON이 아닙니다.".to_string()
        })?;
        Ok(json!({"objectKey": remote.object_key, "content": content, "contentSha256": expected_sha, "byteSize": expected_size}))
    }

    pub async fn delete_sync_object(state: &GoogleDriveAuthState, request: Value) -> Result<Value, String> {
        let object_key = required_string(&request, "objectKey", "google-drive-object-key-missing")?;
        validate_object_key(&object_key)?;
        if !object_key.starts_with("sync/leases/") {
            return Err("[google-drive-sync-delete-target-invalid] 만료된 동기화 lease만 정리할 수 있습니다.".into());
        }
        let expected_sha = required_string(&request, "contentSha256", "google-drive-content-hash-missing")?.to_ascii_lowercase();
        let expected_size = request
            .get("byteSize")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or_else(|| "[google-drive-content-size-missing] 동기화 lease 크기가 없습니다.".to_string())?;
        let client = drive_client()?;
        let token = access_token(state).await?;
        let remote = find_remote_object(&client, state, &token, &object_key, &expected_sha, expected_size).await?;
        let response = client
            .delete(file_url(&remote.id)?)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await
            .map_err(|_| "[google-drive-sync-delete-network-failed] 만료된 동기화 lease를 정리하지 못했습니다.".to_string())?;
        if !response.status().is_success() {
            return Err(drive_error(state, response.status(), "sync-delete"));
        }
        if let Ok(mut index) = state.object_index.lock() {
            if let Some(index) = index.as_mut() {
                index.entries.remove(&object_key);
            }
        }
        Ok(json!({"objectKey": object_key, "deleted": true}))
    }

    pub async fn delete_backup_manifest(
        state: &GoogleDriveAuthState,
        request: Value,
    ) -> Result<Value, String> {
        let object_key = required_string(
            &request,
            "objectKey",
            "google-drive-object-key-missing",
        )?;
        validate_object_key(&object_key)?;
        if !object_key.starts_with("backups/") || !object_key.ends_with("/manifest.json") {
            return Err("[google-drive-replace-target-invalid] 백업 manifest만 교체할 수 있습니다.".into());
        }
        let expected_sha = required_string(
            &request,
            "contentSha256",
            "google-drive-content-hash-missing",
        )?
        .to_ascii_lowercase();
        if !is_sha256(&expected_sha) {
            return Err("[google-drive-content-hash-invalid] 백업 manifest 해시가 올바르지 않습니다.".into());
        }
        let expected_size = request
            .get("byteSize")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                "[google-drive-content-size-missing] 백업 manifest 크기가 없습니다.".to_string()
            })?;
        let client = drive_client()?;
        let token = access_token(state).await?;
        let remote = find_remote_object(
            &client,
            state,
            &token,
            &object_key,
            &expected_sha,
            expected_size,
        )
        .await?;
        let response = client
            .delete(file_url(&remote.id)?)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .send()
            .await
            .map_err(|_| {
                "[google-drive-backup-replace-network-failed] 선택한 Google Drive 백업을 교체하지 못했습니다."
                    .to_string()
            })?;
        if !response.status().is_success() {
            return Err(drive_error(state, response.status(), "backup-replace"));
        }
        let mut index = state.object_index.lock().map_err(|_| {
            "[google-drive-index-lock-failed] 교체한 백업 목록을 반영하지 못했습니다."
                .to_string()
        })?;
        if let Some(index) = index.as_mut() {
            index.entries.remove(&object_key);
        }
        Ok(json!({
            "objectKey": object_key,
            "remoteObjectId": remote.id,
            "deleted": true
        }))
    }

    async fn find_existing(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
        object_key: &str,
        expected_sha: &str,
        byte_size: u64,
    ) -> Result<Option<String>, String> {
        let needs_reload = {
            let index = state.object_index.lock().map_err(|_| {
                "[google-drive-index-lock-failed] Google Drive 파일 목록을 읽지 못했습니다."
                    .to_string()
            })?;
            index
                .as_ref()
                .map(|value| value.loaded_at_ms.saturating_add(OBJECT_INDEX_TTL_MS) <= now_ms())
                .unwrap_or(true)
        };
        if needs_reload {
            let entries = load_object_index(client, state, token).await?;
            let mut index = state.object_index.lock().map_err(|_| {
                "[google-drive-index-lock-failed] Google Drive 파일 목록을 저장하지 못했습니다."
                    .to_string()
            })?;
            *index = Some(CachedObjectIndex {
                loaded_at_ms: now_ms(),
                entries,
            });
        }
        let index = state.object_index.lock().map_err(|_| {
            "[google-drive-index-lock-failed] Google Drive 파일 목록을 읽지 못했습니다."
                .to_string()
        })?;
        let existing = index.as_ref().and_then(|value| value.entries.get(object_key));
        if let Some(existing) = existing {
            if existing.content_sha256 == expected_sha && existing.byte_size == byte_size {
                return Ok(Some(existing.id.clone()));
            }
            return Err("[google-drive-object-key-collision] 같은 백업 키에 다른 내용이 있어 덮어쓰지 않았습니다.".into());
        }
        Ok(None)
    }

    fn drive_client() -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| "[google-drive-http-client-failed] Google Drive 요청을 준비하지 못했습니다.".to_string())
    }

    async fn list_manifest_objects(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
    ) -> Result<Vec<RemoteDriveObject>, String> {
        let mut result = Vec::new();
        let mut page_token = String::new();
        for _ in 0..10_000 {
            let mut url = Url::parse(DRIVE_LIST_URL).map_err(|_| {
                "[google-drive-list-url-invalid] Google Drive 조회 주소를 만들지 못했습니다.".to_string()
            })?;
            url.query_pairs_mut()
                .append_pair("spaces", "appDataFolder")
                .append_pair("pageSize", "1000")
                .append_pair("orderBy", "modifiedTime desc")
                .append_pair("q", "trashed=false")
                .append_pair("fields", "nextPageToken,files(id,size,appProperties)");
            if !page_token.is_empty() {
                url.query_pairs_mut().append_pair("pageToken", &page_token);
            }
            let response = client.get(url).header(AUTHORIZATION, format!("Bearer {token}")).send().await.map_err(|_| {
                "[google-drive-backup-list-network-failed] Google Drive 백업 목록을 불러오지 못했습니다.".to_string()
            })?;
            if !response.status().is_success() {
                return Err(drive_error(state, response.status(), "backup-list"));
            }
            let bytes = response.bytes().await.map_err(|_| {
                "[google-drive-backup-list-read-failed] Google Drive 백업 목록을 읽지 못했습니다.".to_string()
            })?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
                "[google-drive-backup-list-invalid] Google Drive 백업 목록 응답이 올바르지 않습니다.".to_string()
            })?;
            for file in value.get("files").and_then(Value::as_array).into_iter().flatten() {
                if is_manifest_file(file) {
                    if let Some(remote) = remote_from_file(file) {
                        result.push(remote);
                        if result.len() >= MAX_BACKUP_LIST {
                            return merge_cached_manifest_objects(state, result);
                        }
                    }
                }
            }
            page_token = value.get("nextPageToken").and_then(Value::as_str).unwrap_or("").to_string();
            if page_token.is_empty() {
                return merge_cached_manifest_objects(state, result);
            }
        }
        Err("[google-drive-list-page-limit] Google Drive 백업 목록이 허용 페이지 수를 넘었습니다.".into())
    }

    fn is_manifest_file(file: &Value) -> bool {
        let properties = match file.get("appProperties").and_then(Value::as_object) {
            Some(value) => value,
            None => return false,
        };
        let kind = properties
            .get("hamboardKind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let object_key = properties
            .get("hamboardObjectKey")
            .and_then(Value::as_str)
            .unwrap_or("");
        kind == "manifest"
            || (object_key.starts_with("backups/") && object_key.ends_with("/manifest.json"))
    }

    fn merge_cached_manifest_objects(
        state: &GoogleDriveAuthState,
        mut result: Vec<RemoteDriveObject>,
    ) -> Result<Vec<RemoteDriveObject>, String> {
        let index = state.object_index.lock().map_err(|_| {
            "[google-drive-index-lock-failed] 최근 업로드한 백업 목록을 읽지 못했습니다."
                .to_string()
        })?;
        if let Some(index) = index.as_ref() {
            for remote in index.entries.values() {
                if result.len() >= MAX_BACKUP_LIST {
                    break;
                }
                if !remote.object_key.starts_with("backups/")
                    || !remote.object_key.ends_with("/manifest.json")
                    || result.iter().any(|item| item.id == remote.id)
                {
                    continue;
                }
                result.push(remote.clone());
            }
        }
        Ok(result)
    }

    fn remote_from_file(file: &Value) -> Option<RemoteDriveObject> {
        let properties = file.get("appProperties")?.as_object()?;
        let object_key = properties.get("hamboardObjectKey")?.as_str()?;
        let content_sha256 = properties.get("hamboardContentSha256")?.as_str()?.to_ascii_lowercase();
        let byte_size = properties.get("hamboardByteSize")?.as_str()?.parse::<u64>().ok()?;
        let id = file.get("id")?.as_str()?;
        if object_key.is_empty() || id.is_empty() || !is_sha256(&content_sha256) {
            return None;
        }
        Some(RemoteDriveObject {
            id: id.to_string(),
            object_key: object_key.to_string(),
            content_sha256,
            byte_size,
        })
    }

    async fn find_remote_object(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
        object_key: &str,
        expected_sha: &str,
        expected_size: u64,
    ) -> Result<RemoteDriveObject, String> {
        let needs_reload = {
            let index = state.object_index.lock().map_err(|_| {
                "[google-drive-index-lock-failed] Google Drive 파일 목록을 읽지 못했습니다.".to_string()
            })?;
            index.as_ref().map(|value| value.loaded_at_ms.saturating_add(OBJECT_INDEX_TTL_MS) <= now_ms()).unwrap_or(true)
        };
        if needs_reload {
            let entries = load_object_index(client, state, token).await?;
            let mut index = state.object_index.lock().map_err(|_| {
                "[google-drive-index-lock-failed] Google Drive 파일 목록을 저장하지 못했습니다.".to_string()
            })?;
            *index = Some(CachedObjectIndex { loaded_at_ms: now_ms(), entries });
        }
        let remote = state.object_index.lock().map_err(|_| {
            "[google-drive-index-lock-failed] Google Drive 파일 목록을 읽지 못했습니다.".to_string()
        })?.as_ref().and_then(|value| value.entries.get(object_key)).cloned().ok_or_else(|| {
            "[google-drive-object-not-found] manifest가 가리키는 Drive 파일을 찾지 못했습니다.".to_string()
        })?;
        if remote.content_sha256 != expected_sha || remote.byte_size != expected_size {
            return Err("[google-drive-object-metadata-mismatch] Drive 파일 정보가 manifest와 다릅니다.".into());
        }
        Ok(remote)
    }

    fn file_url(id: &str) -> Result<Url, String> {
        let mut url = Url::parse("https://www.googleapis.com").map_err(|_| {
            "[google-drive-download-url-invalid] Google Drive 다운로드 주소를 만들지 못했습니다.".to_string()
        })?;
        {
            let mut segments = url.path_segments_mut().map_err(|_| {
                "[google-drive-download-url-invalid] Google Drive 다운로드 주소를 만들지 못했습니다.".to_string()
            })?;
            segments
                .clear()
                .push("drive")
                .push("v3")
                .push("files")
                .push(id);
        }
        Ok(url)
    }

    fn media_url(id: &str) -> Result<Url, String> {
        let mut url = file_url(id)?;
        url.query_pairs_mut().append_pair("alt", "media");
        Ok(url)
    }

    async fn download_bytes(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
        remote: &RemoteDriveObject,
    ) -> Result<Vec<u8>, String> {
        let response = client.get(media_url(&remote.id)?).header(AUTHORIZATION, format!("Bearer {token}")).send().await.map_err(|_| {
            "[google-drive-download-network-failed] Google Drive 파일 다운로드가 중단되었습니다.".to_string()
        })?;
        if !response.status().is_success() {
            return Err(drive_error(state, response.status(), "download"));
        }
        let bytes = response.bytes().await.map_err(|_| {
            "[google-drive-download-read-failed] Google Drive 파일을 읽지 못했습니다.".to_string()
        })?.to_vec();
        if bytes.len() as u64 != remote.byte_size || sha256_hex(&bytes) != remote.content_sha256 {
            return Err("[google-drive-download-integrity-mismatch] 다운로드 파일의 크기 또는 해시가 Drive 정보와 다릅니다.".into());
        }
        Ok(bytes)
    }

    async fn download_to_file(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
        remote: &RemoteDriveObject,
        path: &Path,
    ) -> Result<(), String> {
        let mut response = client.get(media_url(&remote.id)?).header(AUTHORIZATION, format!("Bearer {token}")).send().await.map_err(|_| {
            "[google-drive-download-network-failed] Google Drive 파일 다운로드가 중단되었습니다.".to_string()
        })?;
        if !response.status().is_success() {
            return Err(drive_error(state, response.status(), "download"));
        }
        let mut file = File::create(path).map_err(|_| {
            "[google-drive-download-stage-create-failed] 다운로드 임시 파일을 만들지 못했습니다.".to_string()
        })?;
        let mut received = 0_u64;
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            "[google-drive-download-read-failed] Google Drive 파일을 읽지 못했습니다.".to_string()
        })? {
            received = received.saturating_add(chunk.len() as u64);
            if received > remote.byte_size {
                let _ = std::fs::remove_file(path);
                return Err("[google-drive-download-size-exceeded] 다운로드 파일이 manifest 크기를 넘었습니다.".into());
            }
            file.write_all(&chunk).map_err(|_| {
                "[google-drive-download-stage-write-failed] 다운로드 임시 파일에 저장하지 못했습니다.".to_string()
            })?;
        }
        file.flush().map_err(|_| {
            "[google-drive-download-stage-write-failed] 다운로드 임시 파일을 확정하지 못했습니다.".to_string()
        })?;
        Ok(())
    }

    fn validate_download_file_name(value: &str, expected_sha: &str) -> Result<(), String> {
        if value != format!("cloud-download-{expected_sha}.bin") {
            return Err("[google-drive-target-invalid] 다운로드 임시 파일 이름이 허용되지 않습니다.".into());
        }
        Ok(())
    }

    async fn load_object_index(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        token: &str,
    ) -> Result<std::collections::HashMap<String, RemoteDriveObject>, String> {
        let mut entries = std::collections::HashMap::new();
        let mut page_token = String::new();
        for _ in 0..10_000 {
            let mut url = Url::parse(DRIVE_LIST_URL).map_err(|_| {
                "[google-drive-list-url-invalid] Google Drive 조회 주소를 만들지 못했습니다."
                    .to_string()
            })?;
            url.query_pairs_mut()
                .append_pair("spaces", "appDataFolder")
                .append_pair("pageSize", "1000")
                .append_pair(
                    "fields",
                    "nextPageToken,files(id,size,appProperties)",
                );
            if !page_token.is_empty() {
                url.query_pairs_mut().append_pair("pageToken", &page_token);
            }
            let response = client
                .get(url)
                .header(AUTHORIZATION, format!("Bearer {token}"))
                .send()
                .await
                .map_err(|_| {
                    "[google-drive-list-network-failed] Google Drive 기존 파일을 확인하지 못했습니다."
                        .to_string()
                })?;
            if !response.status().is_success() {
                return Err(drive_error(state, response.status(), "list"));
            }
            let bytes = response.bytes().await.map_err(|_| {
                "[google-drive-list-read-failed] Google Drive 기존 파일 정보를 읽지 못했습니다."
                    .to_string()
            })?;
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
                "[google-drive-list-response-invalid] Google Drive 기존 파일 응답이 올바르지 않습니다."
                    .to_string()
            })?;
            for file in value
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let properties = file.get("appProperties").and_then(Value::as_object);
                let object_key = properties
                    .and_then(|value| value.get("hamboardObjectKey"))
                    .and_then(Value::as_str);
                let content_sha256 = properties
                    .and_then(|value| value.get("hamboardContentSha256"))
                    .and_then(Value::as_str);
                let byte_size = properties
                    .and_then(|value| value.get("hamboardByteSize"))
                    .and_then(Value::as_str)
                    .and_then(|value| value.parse::<u64>().ok());
                let id = file.get("id").and_then(Value::as_str);
                if let (Some(object_key), Some(content_sha256), Some(byte_size), Some(id)) =
                    (object_key, content_sha256, byte_size, id)
                {
                    if !object_key.is_empty()
                        && !id.is_empty()
                        && is_sha256(content_sha256)
                    {
                        entries.insert(
                            object_key.to_string(),
                            RemoteDriveObject {
                                id: id.to_string(),
                                object_key: object_key.to_string(),
                                content_sha256: content_sha256.to_string(),
                                byte_size,
                            },
                        );
                    }
                }
            }
            page_token = value
                .get("nextPageToken")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if page_token.is_empty() {
                return Ok(entries);
            }
        }
        Err("[google-drive-list-page-limit] Google Drive 파일 목록이 허용 페이지 수를 넘었습니다.".into())
    }

    fn remember_uploaded(
        state: &GoogleDriveAuthState,
        object_key: &str,
        id: &str,
        content_sha256: &str,
        byte_size: u64,
    ) -> Result<(), String> {
        let mut index = state.object_index.lock().map_err(|_| {
            "[google-drive-index-lock-failed] Google Drive 업로드 결과를 기록하지 못했습니다."
                .to_string()
        })?;
        if let Some(index) = index.as_mut() {
            index.entries.insert(
                object_key.to_string(),
                RemoteDriveObject {
                    id: id.to_string(),
                    object_key: object_key.to_string(),
                    content_sha256: content_sha256.to_string(),
                    byte_size,
                },
            );
        }
        Ok(())
    }

    async fn upload_chunks(
        client: &reqwest::Client,
        state: &GoogleDriveAuthState,
        session_url: &str,
        source: &UploadSource,
        total: u64,
        mime_type: &str,
    ) -> Result<Value, String> {
        let mut offset = 0_u64;
        while offset < total {
            let length = usize::try_from((total - offset).min(CHUNK_SIZE as u64)).map_err(|_| {
                "[google-drive-upload-range-invalid] 업로드 파일 범위가 올바르지 않습니다."
                    .to_string()
            })?;
            let bytes = source.read_chunk(offset, length).await?;
            let end = offset + length as u64 - 1;
            let response = client
                .put(session_url)
                .header(CONTENT_TYPE, mime_type)
                .header(CONTENT_LENGTH, length.to_string())
                .header(CONTENT_RANGE, format!("bytes {offset}-{end}/{total}"))
                .body(bytes)
                .send()
                .await
                .map_err(|_| {
                    "[google-drive-upload-chunk-network-failed] Google Drive 파일 전송이 중단되었습니다."
                        .to_string()
                })?;
            let status = response.status();
            if status.as_u16() == 308 {
                let received_end = response
                    .headers()
                    .get(RANGE)
                    .and_then(|value| value.to_str().ok())
                    .and_then(parse_received_end)
                    .ok_or_else(|| {
                        "[google-drive-upload-range-missing] Google Drive가 받은 파일 범위를 확인하지 못했습니다."
                            .to_string()
                    })?;
                let next = received_end.saturating_add(1);
                if next <= offset || next > total {
                    return Err("[google-drive-upload-range-invalid] Google Drive가 반환한 파일 범위가 올바르지 않습니다.".into());
                }
                offset = next;
                continue;
            }
            if status.is_success() {
                let body = response.bytes().await.map_err(|_| {
                    "[google-drive-upload-response-read-failed] Google Drive 업로드 결과를 읽지 못했습니다."
                        .to_string()
                })?;
                return serde_json::from_slice(&body).map_err(|_| {
                    "[google-drive-upload-response-invalid] Google Drive 업로드 결과 형식이 올바르지 않습니다."
                        .to_string()
                });
            }
            return Err(drive_error(state, status, "upload-chunk"));
        }
        Err("[google-drive-upload-incomplete] Google Drive 업로드가 완료되지 않았습니다.".into())
    }

    fn resolve_upload_path(app: &tauri::AppHandle, relative_path: &str) -> Result<PathBuf, String> {
        let relative = Path::new(relative_path);
        let components: Vec<_> = relative.components().collect();
        if components.len() != 2
            || components
                .iter()
                .any(|component| !matches!(component, Component::Normal(_)))
            || components[0].as_os_str() != "assets"
        {
            return Err("[google-drive-source-path-invalid] 업로드 파일 경로가 허용 범위를 벗어났습니다.".into());
        }
        let file_name = components[1].as_os_str().to_string_lossy();
        if !((file_name.starts_with("asset-") && file_name.ends_with(".bin"))
            || file_name == STAGING_FILE)
        {
            return Err("[google-drive-source-path-invalid] 업로드 파일 이름이 허용되지 않습니다.".into());
        }
        let app_data = app.path().app_local_data_dir().map_err(|_| {
            "[google-drive-app-data-unavailable] 앱 데이터 폴더를 찾지 못했습니다."
                .to_string()
        })?;
        let base = app_data.join("assets").canonicalize().map_err(|_| {
            "[google-drive-app-data-unavailable] Asset 폴더를 확인하지 못했습니다."
                .to_string()
        })?;
        let path = app_data.join(relative).canonicalize().map_err(|_| {
            "[google-drive-source-missing] 업로드할 로컬 파일이 없습니다.".to_string()
        })?;
        if !path.starts_with(&base) {
            return Err("[google-drive-source-path-invalid] 업로드 파일 경로가 허용 범위를 벗어났습니다.".into());
        }
        Ok(path)
    }

    fn inspect_file(path: &Path) -> Result<(u64, String), String> {
        let mut file = File::open(path).map_err(|_| {
            "[google-drive-source-open-failed] 업로드할 파일을 열지 못했습니다.".to_string()
        })?;
        let size = file.metadata().map_err(|_| {
            "[google-drive-source-metadata-failed] 업로드할 파일 크기를 확인하지 못했습니다."
                .to_string()
        })?.len();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; CHUNK_SIZE];
        loop {
            let read = file.read(&mut buffer).map_err(|_| {
                "[google-drive-source-read-failed] 업로드할 파일을 검사하지 못했습니다."
                    .to_string()
            })?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok((size, format!("{:x}", hasher.finalize())))
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn required_string(value: &Value, key: &str, code: &str) -> Result<String, String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("[{code}] Google Drive 업로드 요청 값이 없습니다."))
    }

    fn validate_object_key(value: &str) -> Result<(), String> {
        if value.len() > 100
            || !value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/'))
        {
            return Err("[google-drive-object-key-invalid] 백업 객체 키가 올바르지 않습니다.".into());
        }
        Ok(())
    }

    fn is_sha256(value: &str) -> bool {
        value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
    }

    fn drive_name(kind: &str, backup_id: &str, sha256: &str) -> String {
        if kind == "manifest" {
            let safe: String = backup_id
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
                .take(100)
                .collect();
            format!("hamboard-backup-{}.json", if safe.is_empty() { "snapshot" } else { &safe })
        } else if kind == "sync" {
            format!("hamboard-sync-{}.json", &sha256[..24])
        } else {
            format!("hamboard-object-{}.bin", &sha256[..24])
        }
    }

    fn parse_received_end(value: &str) -> Option<u64> {
        value.strip_prefix("bytes=")?.split('-').nth(1)?.parse().ok()
    }

    fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn drive_error(
        state: &GoogleDriveAuthState,
        status: reqwest::StatusCode,
        stage: &str,
    ) -> String {
        if status.as_u16() == 401 {
            clear_cached_access_token(state);
            return format!(
                "[google-drive-auth-rejected] Google Drive 인증이 만료되었습니다 ({stage}, HTTP 401)."
            );
        }
        let code = match status.as_u16() {
            403 => "google-drive-quota-or-permission",
            429 => "google-drive-rate-limited",
            500..=599 => "google-drive-server-unavailable",
            _ => "google-drive-request-failed",
        };
        format!(
            "[{code}] Google Drive 요청을 완료하지 못했습니다 ({stage}, HTTP {}).",
            status.as_u16()
        )
    }

    #[cfg(test)]
    mod tests {
        use super::{file_url, media_url};

        #[test]
        fn file_url_has_single_files_separator() {
            let url = file_url("drive-file_id").expect("file URL");
            assert_eq!(
                url.as_str(),
                "https://www.googleapis.com/drive/v3/files/drive-file_id"
            );
        }

        #[test]
        fn media_url_has_single_files_separator() {
            let url = media_url("drive-file_id").expect("media URL");
            assert_eq!(
                url.as_str(),
                "https://www.googleapis.com/drive/v3/files/drive-file_id?alt=media"
            );
        }
    }
}

#[cfg(target_os = "windows")]
mod credential_store {
    use std::{ffi::c_void, ptr};

    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1_168;
    const TARGET: &str = "Hamboard/GoogleDrive/RefreshToken";

    #[repr(C)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        credential_type: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        credential_blob_size: u32,
        credential_blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(
            target: *const u16,
            credential_type: u32,
            flags: u32,
            credential: *mut *mut CredentialW,
        ) -> i32;
        fn CredDeleteW(target: *const u16, credential_type: u32, flags: u32) -> i32;
        fn CredFree(buffer: *const c_void);
    }

    struct CredentialGuard(*mut CredentialW);

    impl Drop for CredentialGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CredFree(self.0.cast()) };
            }
        }
    }

    pub fn write_refresh_token(token: &str) -> Result<(), String> {
        let bytes = token.as_bytes();
        if bytes.is_empty() || bytes.len() > 2_560 {
            return Err("[google-credential-token-size-invalid] Google 인증 토큰 크기가 올바르지 않습니다.".into());
        }
        let mut target = wide(TARGET);
        let mut user_name = wide("Hamboard Google Drive");
        let credential = CredentialW {
            flags: 0,
            credential_type: CRED_TYPE_GENERIC,
            target_name: target.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime {
                low_date_time: 0,
                high_date_time: 0,
            },
            credential_blob_size: bytes.len() as u32,
            credential_blob: bytes.as_ptr() as *mut u8,
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            target_alias: ptr::null_mut(),
            user_name: user_name.as_mut_ptr(),
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(format!(
                "[google-credential-write-failed] Windows 자격 증명 저장소에 Google 연결 정보를 저장하지 못했습니다 (OS {}).",
                last_error_code()
            ));
        }
        Ok(())
    }

    pub fn read_refresh_token() -> Result<Option<String>, String> {
        let target = wide(TARGET);
        let mut pointer: *mut CredentialW = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) } == 0 {
            let code = last_error_code();
            if code == ERROR_NOT_FOUND {
                return Ok(None);
            }
            return Err(format!(
                "[google-credential-read-failed] Windows 자격 증명 저장소에서 Google 연결 정보를 읽지 못했습니다 (OS {code})."
            ));
        }
        let guard = CredentialGuard(pointer);
        let credential = unsafe { &*guard.0 };
        if credential.credential_blob.is_null() || credential.credential_blob_size == 0 {
            return Err("[google-credential-empty] 저장된 Google 연결 정보가 비어 있습니다.".into());
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(
                credential.credential_blob,
                credential.credential_blob_size as usize,
            )
        };
        let token = std::str::from_utf8(bytes)
            .map_err(|_| "[google-credential-invalid] 저장된 Google 연결 정보를 읽을 수 없습니다.".to_string())?
            .to_string();
        Ok(Some(token))
    }

    pub fn delete_refresh_token() -> Result<(), String> {
        let target = wide(TARGET);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0 {
            let code = last_error_code();
            if code != ERROR_NOT_FOUND {
                return Err(format!(
                    "[google-credential-delete-failed] Windows 자격 증명 저장소의 Google 연결 정보를 지우지 못했습니다 (OS {code})."
                ));
            }
        }
        Ok(())
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn last_error_code() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(-1)
    }
}
