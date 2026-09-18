mod google_drive;
mod work_tracker;

use serde_json::{json, Value};
use sqlx::Acquire;
use std::{
    fs,
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    path::BaseDirectory,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

#[cfg(target_os = "windows")]
use std::process::Command;

#[cfg(target_os = "windows")]
#[link(name = "winmm")]
extern "system" {
    fn PlaySoundW(psz_sound: *const u16, hmod: *mut std::ffi::c_void, flags: u32) -> i32;
}

struct UtilityTimerService {
    state: Arc<Mutex<Value>>,
    stopping: Arc<AtomicBool>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl UtilityTimerService {
    fn start(app: tauri::AppHandle) -> Self {
        let state = Arc::new(Mutex::new(json!({})));
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_state = Arc::clone(&state);
        let worker_stopping = Arc::clone(&stopping);
        let worker = thread::spawn(move || {
            while !worker_stopping.load(Ordering::Relaxed) {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let mut fired: Vec<(Value, String, String, Option<String>)> = Vec::new();

                if let Ok(mut utilities) = worker_state.lock() {
                    let countdown_sound = utilities
                        .get("countdownSound")
                        .and_then(Value::as_str)
                        .unwrap_or("new-stage")
                        .to_string();
                    let reminder_sound = utilities
                        .get("reminderSound")
                        .and_then(Value::as_str)
                        .unwrap_or("new-stage")
                        .to_string();
                    let pomodoro_sound = utilities
                        .get("pomodoroSound")
                        .and_then(Value::as_str)
                        .unwrap_or("new-stage")
                        .to_string();
                    if let Some(pomodoro) =
                        utilities.get_mut("pomodoro").and_then(Value::as_object_mut)
                    {
                        let running = pomodoro
                            .get("running")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        let end_at = pomodoro.get("endAt").and_then(Value::as_u64).unwrap_or(0);
                        if running && end_at > 0 && end_at <= now {
                            let finished_mode = pomodoro
                                .get("mode")
                                .and_then(Value::as_str)
                                .unwrap_or("focus")
                                .to_string();
                            let focus_minutes = pomodoro
                                .get("focusMinutes")
                                .and_then(Value::as_u64)
                                .unwrap_or(25)
                                .max(1);
                            let break_minutes = pomodoro
                                .get("breakMinutes")
                                .and_then(Value::as_u64)
                                .unwrap_or(5)
                                .max(1);
                            let long_break_minutes = pomodoro
                                .get("longBreakMinutes")
                                .and_then(Value::as_u64)
                                .unwrap_or(30)
                                .max(1);
                            let long_break_interval = pomodoro
                                .get("longBreakInterval")
                                .and_then(Value::as_u64)
                                .unwrap_or(4)
                                .clamp(1, 12);
                            let mut completed = pomodoro
                                .get("completedPomodoros")
                                .and_then(Value::as_u64)
                                .unwrap_or(0)
                                .min(long_break_interval);

                            let (next_mode, next_minutes, title, body) = if finished_mode == "focus" {
                                completed = completed.saturating_add(1).min(long_break_interval);
                                if completed >= long_break_interval {
                                    (
                                        "longBreak",
                                        long_break_minutes,
                                        "집중 시간이 끝났습니다",
                                        "긴 휴식을 시작합니다.",
                                    )
                                } else {
                                    (
                                        "shortBreak",
                                        break_minutes,
                                        "집중 시간이 끝났습니다",
                                        "짧은 휴식을 시작합니다.",
                                    )
                                }
                            } else {
                                if finished_mode == "longBreak" {
                                    completed = 0;
                                }
                                (
                                    "focus",
                                    focus_minutes,
                                    "휴식 시간이 끝났습니다",
                                    "다음 집중 시간을 시작합니다.",
                                )
                            };
                            let remaining_seconds = next_minutes.saturating_mul(60);
                            let next_end_at = now.saturating_add(remaining_seconds.saturating_mul(1000));
                            pomodoro.insert("running".into(), Value::Bool(true));
                            pomodoro.insert("endAt".into(), Value::from(next_end_at));
                            pomodoro.insert("mode".into(), Value::from(next_mode));
                            pomodoro.insert("completedPomodoros".into(), Value::from(completed));
                            pomodoro
                                .insert("remainingSeconds".into(), Value::from(remaining_seconds));
                            fired.push((
                                json!({
                                    "kind": "pomodoro",
                                    "finishedMode": finished_mode,
                                    "mode": next_mode,
                                    "completedPomodoros": completed,
                                    "remainingSeconds": remaining_seconds,
                                    "running": true,
                                    "endAt": next_end_at
                                }),
                                title.to_string(),
                                body.to_string(),
                                Some(pomodoro_sound.clone()),
                            ));
                        }
                    }

                    if let Some(countdowns) = utilities
                        .get_mut("countdowns")
                        .and_then(Value::as_array_mut)
                    {
                        countdowns.retain(|timer| {
                            let running = timer
                                .get("running")
                                .and_then(Value::as_bool)
                                .unwrap_or(false);
                            let end_at = timer.get("endAt").and_then(Value::as_u64).unwrap_or(0);
                            if running && end_at > 0 && end_at <= now {
                                let id = timer
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string();
                                let title = timer
                                    .get("title")
                                    .and_then(Value::as_str)
                                    .unwrap_or("알림")
                                    .to_string();
                                fired.push((
                                    json!({"kind": "countdown", "id": id, "title": title.clone()}),
                                    "알림".to_string(),
                                    title,
                                    Some(countdown_sound.clone()),
                                ));
                                false
                            } else {
                                true
                            }
                        });
                    }

                    if let Some(reminders) =
                        utilities.get_mut("reminders").and_then(Value::as_array_mut)
                    {
                        for reminder in reminders {
                            let enabled = reminder
                                .get("enabled")
                                .and_then(Value::as_bool)
                                .unwrap_or(false);
                            let next_at =
                                reminder.get("nextAt").and_then(Value::as_u64).unwrap_or(0);
                            if !enabled || next_at == 0 || next_at > now {
                                continue;
                            }
                            let interval_seconds = reminder
                                .get("intervalSeconds")
                                .and_then(Value::as_u64)
                                .or_else(|| {
                                    reminder
                                        .get("intervalMinutes")
                                        .and_then(Value::as_u64)
                                        .map(|minutes| minutes.saturating_mul(60))
                                })
                                .unwrap_or(3600)
                                .max(1);
                            let next = now.saturating_add(interval_seconds.saturating_mul(1_000));
                            if let Some(object) = reminder.as_object_mut() {
                                object.insert("nextAt".into(), Value::from(next));
                            }
                            let id = reminder
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let title = reminder
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or("반복 알림")
                                .to_string();
                            fired.push((
                                json!({
                                    "kind": "reminder",
                                    "id": id,
                                    "title": title.clone(),
                                    "nextAt": next
                                }),
                                "반복 알림".to_string(),
                                title,
                                Some(reminder_sound.clone()),
                            ));
                        }
                    }

                    if let Some(calendar_reminders) = utilities
                        .get_mut("calendarReminders")
                        .and_then(Value::as_array_mut)
                    {
                        calendar_reminders.retain(|reminder| {
                            let fire_at = reminder
                                .get("fireAt")
                                .and_then(Value::as_u64)
                                .unwrap_or(0);
                            if fire_at == 0 || fire_at > now {
                                return true;
                            }
                            let id = reminder
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let event_id = reminder
                                .get("eventId")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let occurrence_date = reminder
                                .get("occurrenceDate")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .to_string();
                            let reminder_minutes_before = reminder
                                .get("reminderMinutesBefore")
                                .and_then(Value::as_u64)
                                .unwrap_or(0);
                            let title = reminder
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or("일정")
                                .to_string();
                            let body = reminder
                                .get("body")
                                .and_then(Value::as_str)
                                .unwrap_or("일정 시간이 다가왔습니다.")
                                .to_string();
                            fired.push((
                                json!({
                                    "kind": "calendar",
                                    "id": id,
                                    "eventId": event_id,
                                    "occurrenceDate": occurrence_date,
                                    "fireAt": fire_at,
                                    "reminderMinutesBefore": reminder_minutes_before
                                }),
                                "햄보드 일정".to_string(),
                                body,
                                None,
                            ));
                            false
                        });
                    }
                }

                for (payload, title, body, sound) in fired {
                    if let Some(sound) = sound {
                        if let Err(error) = play_notification_sound_key(app.clone(), &sound) {
                            eprintln!("알림음 재생 실패: {error}");
                            let _ = app.emit(
                                "hamboard-utility-timer-diagnostic",
                                json!({"stage": "notification-sound", "message": error}),
                            );
                        }
                    }
                    if let Err(error) = app.notification().builder().title(title).body(body).show()
                    {
                        eprintln!("Windows 알림 전송 실패: {error}");
                        let _ = app.emit(
                            "hamboard-utility-timer-diagnostic",
                            json!({"stage": "windows-notification", "message": error.to_string()}),
                        );
                    }
                    if let Err(error) = app.emit("hamboard-utility-timer-fired", payload) {
                        eprintln!("유틸리티 타이머 이벤트 전송 실패: {error}");
                        let _ = app.emit(
                            "hamboard-utility-timer-diagnostic",
                            json!({"stage": "timer-event-emit", "message": error.to_string()}),
                        );
                    }
                }

                thread::sleep(Duration::from_millis(250));
            }
        });

        Self {
            state,
            stopping,
            worker: Mutex::new(Some(worker)),
        }
    }

    fn sync(&self, utilities: Value) -> Result<(), String> {
        let mut current = self
            .state
            .lock()
            .map_err(|_| "유틸리티 타이머 상태 잠금에 실패했습니다.".to_string())?;
        *current = utilities;
        Ok(())
    }

    fn shutdown(&self) {
        self.stopping.store(true, Ordering::Relaxed);
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
    }
}

#[tauri::command]
async fn install_sound_pack(
    app: tauri::AppHandle,
    pack_id: String,
    manifest_url: String,
    metadata_only: Option<bool>,
) -> Result<Value, String> {
    let pack_id = pack_id.trim().to_ascii_lowercase();
    if pack_id.is_empty()
        || pack_id.len() > 48
        || !pack_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("sound-pack-id-invalid".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let manifest_url = url::Url::parse(manifest_url.trim())
            .map_err(|error| format!("sound-pack-manifest-url-invalid: {error}"))?;
        if manifest_url.scheme() != "https" {
            return Err("sound-pack-manifest-url-not-https".to_string());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(90))
            .user_agent("Hamboard/1.0.11 sound-pack")
            .build()
            .map_err(|error| format!("sound-pack-client-build-failed: {error}"))?;

        let response = client
            .get(manifest_url)
            .send()
            .await
            .map_err(|error| format!("sound-pack-manifest-request-failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("sound-pack-manifest-http-failed: {status}"));
        }
        let body = response
            .text()
            .await
            .map_err(|error| format!("sound-pack-manifest-body-failed: {error}"))?;
        let manifest: Value = serde_json::from_str(&body)
            .map_err(|error| format!("sound-pack-manifest-json-failed: {error}"))?;
        let tracks = manifest
            .get("tracks")
            .and_then(Value::as_array)
            .ok_or_else(|| "sound-pack-manifest-tracks-missing".to_string())?;

        let allowed_extensions = ["mp3", "wav", "ogg", "m4a", "aac", "flac", "webm"];
        let safe_track_name = |track: &Value, index: usize| -> Result<String, String> {
            let fallback_name = format!("track-{}.mp3", index + 1);
            let raw_name = track
                .get("file")
                .or_else(|| track.get("fileName"))
                .or_else(|| track.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(&fallback_name);
            let leaf_name = raw_name
                .rsplit(|ch| ch == '/' || ch == '\\')
                .next()
                .unwrap_or("")
                .trim();
            let safe_name: String = leaf_name
                .chars()
                .map(|ch| {
                    if ch.is_ascii_alphanumeric()
                        || matches!(ch, '.' | '_' | '-' | ' ')
                        || ('가'..='힣').contains(&ch)
                    {
                        ch
                    } else {
                        '_'
                    }
                })
                .collect();
            let extension = safe_name
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase();
            if safe_name.is_empty() || !allowed_extensions.contains(&extension.as_str()) {
                return Err(format!("sound-pack-track-name-invalid[{index}]"));
            }
            Ok(safe_name)
        };
        let track_metadata = tracks
            .iter()
            .enumerate()
            .filter_map(|(index, track)| {
                let title = track.get("title").and_then(Value::as_str).unwrap_or("").trim();
                if title.is_empty() {
                    return None;
                }
                safe_track_name(track, index)
                    .ok()
                    .map(|file_name| json!({"fileName": file_name, "title": title}))
            })
            .collect::<Vec<_>>();
        if metadata_only.unwrap_or(false) {
            return Ok(json!({
                "packId": pack_id.as_str(),
                "trackCount": tracks.len(),
                "tracks": [],
                "trackMetadata": track_metadata,
            }));
        }

        let app_data = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("sound-pack-app-data-path-failed: {error}"))?;
        let root = app_data.join("sound-packs");
        fs::create_dir_all(&root)
            .map_err(|error| format!("sound-pack-root-create-failed: {error}"))?;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let temp_dir = root.join(format!(".install-{pack_id}-{stamp}"));
        let backup_dir = root.join(format!(".backup-{pack_id}-{stamp}"));
        let final_dir = root.join(&pack_id);
        if temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        fs::create_dir_all(&temp_dir)
            .map_err(|error| format!("sound-pack-temp-create-failed: {error}"))?;

        let total_tracks = tracks.len();
        let _ = app.emit(
            "hamboard-sound-pack-progress",
            json!({"packId": pack_id.as_str(), "done": 0, "total": total_tracks, "percent": 0}),
        );
        let download_result: Result<Vec<String>, String> = async {
            let mut downloaded = Vec::new();
            for (index, track) in tracks.iter().enumerate() {
                let track_url = track
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim();
                let track_url = url::Url::parse(track_url).map_err(|error| {
                    format!("sound-pack-track-url-invalid[{index}]: {error}")
                })?;
                if track_url.scheme() != "https" {
                    return Err(format!("sound-pack-track-url-not-https[{index}]"));
                }

                let safe_name = safe_track_name(track, index)?;

                let response = client
                    .get(track_url)
                    .send()
                    .await
                    .map_err(|error| format!("sound-pack-track-request-failed[{index}]: {error}"))?;
                let status = response.status();
                if !status.is_success() {
                    return Err(format!("sound-pack-track-http-failed[{index}]: {status}"));
                }
                let bytes = response
                    .bytes()
                    .await
                    .map_err(|error| format!("sound-pack-track-body-failed[{index}]: {error}"))?;
                if bytes.is_empty() {
                    return Err(format!("sound-pack-track-empty[{index}]"));
                }
                fs::write(temp_dir.join(&safe_name), &bytes)
                    .map_err(|error| format!("sound-pack-track-write-failed[{index}]: {error}"))?;
                downloaded.push(safe_name);
                let done = downloaded.len();
                let percent = if total_tracks > 0 {
                    ((done as f64 / total_tracks as f64) * 100.0).round() as u64
                } else {
                    100
                };
                let _ = app.emit(
                    "hamboard-sound-pack-progress",
                    json!({"packId": pack_id.as_str(), "done": done, "total": total_tracks, "percent": percent}),
                );
            }
            if downloaded.is_empty() {
                return Err("sound-pack-manifest-empty".to_string());
            }
            Ok(downloaded)
        }
        .await;

        let downloaded = match download_result {
            Ok(downloaded) => downloaded,
            Err(error) => {
                let _ = fs::remove_dir_all(&temp_dir);
                return Err(error);
            }
        };

        let had_existing = final_dir.exists();
        if had_existing {
            fs::rename(&final_dir, &backup_dir)
                .map_err(|error| format!("sound-pack-backup-existing-failed: {error}"))?;
        }
        if let Err(error) = fs::rename(&temp_dir, &final_dir) {
            if had_existing && backup_dir.exists() {
                let _ = fs::rename(&backup_dir, &final_dir);
            }
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(format!("sound-pack-activate-failed: {error}"));
        }
        if backup_dir.exists() {
            let _ = fs::remove_dir_all(&backup_dir);
        }

        return Ok(json!({
            "packId": pack_id,
            "trackCount": downloaded.len(),
            "tracks": downloaded,
            "trackMetadata": track_metadata,
        }));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, manifest_url, metadata_only);
        Err("sound-pack-download-unsupported-platform".to_string())
    }
}

#[tauri::command]
async fn list_public_holidays(year: i32, country_code: String) -> Result<Vec<Value>, String> {
    if !(1900..=2200).contains(&year) {
        return Err("holiday-year-out-of-range".to_string());
    }
    let country = country_code.trim().to_ascii_uppercase();
    if country.len() != 2 || !country.chars().all(|ch| ch.is_ascii_alphabetic()) {
        return Err("holiday-country-invalid".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Hamboard/1.0.11 holiday-calendar")
            .build()
            .map_err(|error| format!("holiday-client-build-failed: {error}"))?;

        if country == "KR" {
            let url = format!("https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/{year}.json");
            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|error| format!("holiday-korea-request-failed: {error}"))?;
            let status = response.status();
            if !status.is_success() {
                return Err(format!("holiday-korea-http-failed: {status}"));
            }
            let body = response
                .text()
                .await
                .map_err(|error| format!("holiday-korea-body-failed: {error}"))?;
            let payload: Value = serde_json::from_str(&body)
                .map_err(|error| format!("holiday-korea-json-failed: {error}"))?;
            let mut rows = Vec::new();
            if let Some(object) = payload.as_object() {
                let mut dates: Vec<_> = object.keys().cloned().collect();
                dates.sort();
                for date in dates {
                    let Some(value) = object.get(&date) else { continue };
                    match value {
                        Value::Array(names) => {
                            for name in names.iter().filter_map(Value::as_str) {
                                if !name.trim().is_empty() {
                                    rows.push(json!({"date": date.clone(), "name": name.trim()}));
                                }
                            }
                        }
                        Value::String(name) if !name.trim().is_empty() => {
                            rows.push(json!({"date": date.clone(), "name": name.trim()}));
                        }
                        _ => {}
                    }
                }
            }
            return Ok(rows);
        }

        let url = format!("https://date.nager.at/api/v3/PublicHolidays/{year}/{country}");
        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|error| format!("holiday-global-request-failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("holiday-global-http-failed: {status}"));
        }
        let body = response
            .text()
            .await
            .map_err(|error| format!("holiday-global-body-failed: {error}"))?;
        let payload: Value = serde_json::from_str(&body)
            .map_err(|error| format!("holiday-global-json-failed: {error}"))?;
        let rows = payload
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let date = item.get("date")?.as_str()?.trim();
                        let local_name = item
                            .get("localName")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim();
                        let name = if local_name.is_empty() {
                            item.get("name").and_then(Value::as_str).unwrap_or("").trim()
                        } else {
                            local_name
                        };
                        if date.is_empty() || name.is_empty() {
                            None
                        } else {
                            Some(json!({"date": date, "name": name}))
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(rows)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = year;
        let _ = country;
        Ok(Vec::new())
    }
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let script = r#"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop; $collection = New-Object System.Drawing.Text.InstalledFontCollection; $collection.Families | ForEach-Object { $_.Name } | Where-Object { $_ -and $_.Trim() } | Sort-Object -Unique } catch { $paths = @('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts','Registry::HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'); $names = foreach ($path in $paths) { if (Test-Path $path) { (Get-ItemProperty -Path $path).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { $_.Name -replace '\s*\((TrueType|OpenType|All res)\)\s*$','' } } }; $names | Where-Object { $_ -and $_.Trim() } | Sort-Object -Unique }"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .map_err(|error| format!("system-font-command-start-failed: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("system-font-command-failed: {stderr}"));
        }
        let stdout = String::from_utf8(output.stdout)
            .map_err(|error| format!("system-font-output-decode-failed: {error}"))?;
        let mut fonts: Vec<String> = stdout
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        fonts.sort_by_key(|name| name.to_lowercase());
        fonts.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        Ok(fonts)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
fn utility_timer_sync(
    service: tauri::State<'_, UtilityTimerService>,
    utilities: Value,
) -> Result<(), String> {
    service.sync(utilities)
}

fn notification_sound_file(sound: &str) -> Option<&'static str> {
    match sound {
        "silent" => None,
        "long-bell" => Some("notification-long-bell.wav"),
        "trumpets" => Some("notification-trumpets.wav"),
        "one-up" => Some("notification-one-up.wav"),
        "clock" => Some("notification-clock.wav"),
        "shine" => Some("notification-shine.wav"),
        _ => Some("notification-new-stage.wav"),
    }
}

fn play_notification_sound_key(app: tauri::AppHandle, sound: &str) -> Result<(), String> {
    let Some(file_name) = notification_sound_file(sound) else {
        return Ok(());
    };

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;

        const SND_ASYNC: u32 = 0x0001;
        const SND_NODEFAULT: u32 = 0x0002;
        const SND_FILENAME: u32 = 0x0002_0000;

        let path = app
            .path()
            .resolve(file_name, BaseDirectory::Resource)
            .map_err(|error| format!("알림음 리소스 경로 확인 실패: {error}"))?;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let played = unsafe {
            PlaySoundW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                SND_FILENAME | SND_ASYNC | SND_NODEFAULT,
            )
        };
        if played == 0 {
            return Err(format!(
                "Windows가 알림음을 재생하지 못했습니다: {}",
                path.display()
            ));
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (app, file_name);

    Ok(())
}

#[tauri::command]
fn play_notification_sound(
    app: tauri::AppHandle,
    sound: Option<String>,
) -> Result<(), String> {
    play_notification_sound_key(app, sound.as_deref().unwrap_or("new-stage"))
}

#[tauri::command]
fn app_exit_after_flush(
    app: tauri::AppHandle,
    tracker: tauri::State<'_, work_tracker::WorkTracker>,
    utility_timers: tauri::State<'_, UtilityTimerService>,
) -> Result<(), String> {
    tracker.flush()?;
    utility_timers.shutdown();
    app.exit(0);
    Ok(())
}

fn restore_text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("복원 데이터의 {key} 값이 올바르지 않습니다."))
}

fn restore_i64(value: &Value, key: &str) -> Result<i64, String> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("복원 데이터의 {key} 값이 올바르지 않습니다."))
}

const MAIN_STATE_KEY: &str = "hamboard.state.v1";
const RESTORE_MARKER_STATE_KEY: &str = "hamboard.restore.marker";
const RESTORE_JOURNAL_FILE: &str = "backup-restore-journal.json";
const RESTORE_JOURNAL_TEMP_FILE: &str = "backup-restore-journal.tmp";
const RESTORE_ROLLBACK_DIRECTORY: &str = "assets-restore-rollback";

fn valid_sync_text(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value.chars().all(|character| !character.is_control())
}

fn valid_sync_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn sync_optional_text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

#[tauri::command]
async fn sync_replace_outbox(
    instances: tauri::State<'_, DbInstances>,
    expected_state_sequence: i64,
    base_revision: String,
    changes: Vec<Value>,
) -> Result<Value, String> {
    if expected_state_sequence < 0 || base_revision.len() > 200 || changes.len() > 50_000 {
        return Err("[sync-outbox-request-invalid] 동기화 변경 목록 요청이 올바르지 않습니다.".into());
    }
    let database = {
        let databases = instances.0.read().await;
        match databases.get("sqlite:hamboard.db") {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("[sync-database-unavailable] Hamboard SQLite 연결을 찾지 못했습니다.".into()),
        }
    };
    let mut transaction = database
        .begin()
        .await
        .map_err(|error| format!("[sync-outbox-transaction-failed] 동기화 변경 목록 transaction을 시작하지 못했습니다: {error}"))?;
    let current_state_sequence: Option<i64> =
        sqlx::query_scalar("SELECT state_change_sequence FROM sync_runtime_state WHERE singleton = 1")
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| format!("[sync-state-read-failed] 현재 상태 기준을 확인하지 못했습니다: {error}"))?;
    if current_state_sequence != Some(expected_state_sequence) {
        return Err("[sync-state-changed-during-prepare] 동기화 변경 목록을 준비하는 동안 상태가 다시 변경되었습니다.".into());
    }
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-outbox-clear-failed] 이전 동기화 변경 목록을 정리하지 못했습니다: {error}"))?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    for change in &changes {
        let change_id = change.get("changeId").and_then(Value::as_str).unwrap_or("");
        let entity_type = change.get("entityType").and_then(Value::as_str).unwrap_or("");
        let entity_id = change.get("entityId").and_then(Value::as_str).unwrap_or("");
        let operation = change.get("operation").and_then(Value::as_str).unwrap_or("");
        let payload_json = sync_optional_text(change, "payloadJson");
        let payload_sha256 = sync_optional_text(change, "payloadSha256");
        let base_payload_json = sync_optional_text(change, "basePayloadJson");
        let base_sha256 = sync_optional_text(change, "baseSha256");
        if !valid_sync_text(change_id, 160)
            || !valid_sync_text(entity_type, 48)
            || !valid_sync_text(entity_id, 240)
            || !matches!(
                entity_type,
                "folder"
                    | "project"
                    | "mindmap"
                    | "note"
                    | "character"
                    | "character-field-template"
                    | "trash"
                    | "story-template"
                    | "calendar-event"
                    | "quick-memo"
                    | "user-library"
                    | "work-tracking"
            )
            || !matches!(operation, "upsert" | "delete")
            || payload_sha256.is_some_and(|hash| !valid_sync_hash(hash))
            || base_sha256.is_some_and(|hash| !valid_sync_hash(hash))
            || base_payload_json.is_some() != base_sha256.is_some()
            || operation == "upsert" && (payload_json.is_none() || payload_sha256.is_none())
            || operation == "delete" && (payload_json.is_some() || payload_sha256.is_some())
        {
            return Err("[sync-outbox-change-invalid] 동기화 변경 항목이 올바르지 않습니다.".into());
        }
        if let Some(payload) = payload_json {
            serde_json::from_str::<Value>(payload)
                .map_err(|_| "[sync-outbox-payload-invalid] 동기화 변경 데이터가 올바른 JSON이 아닙니다.".to_string())?;
        }
        if let Some(payload) = base_payload_json {
            serde_json::from_str::<Value>(payload)
                .map_err(|_| "[sync-outbox-base-invalid] 동기화 기준 데이터가 올바른 JSON이 아닙니다.".to_string())?;
        }
        sqlx::query("INSERT INTO sync_outbox (change_id, entity_type, entity_id, operation, payload_json, payload_sha256, base_payload_json, base_sha256, base_revision, state_change_sequence, status, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?11)")
            .bind(change_id)
            .bind(entity_type)
            .bind(entity_id)
            .bind(operation)
            .bind(payload_json)
            .bind(payload_sha256)
            .bind(base_payload_json)
            .bind(base_sha256)
            .bind(&base_revision)
            .bind(expected_state_sequence)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("[sync-outbox-insert-failed] 동기화 변경 항목을 저장하지 못했습니다: {error}"))?;
    }
    sqlx::query("INSERT INTO sync_runtime_state (singleton, base_revision, base_state_json, state_change_sequence, prepared_state_sequence, dirty_state_updated_at_ms, requires_rebaseline, last_sync_at_ms, updated_at_ms) VALUES (1, '', NULL, ?1, ?1, 0, 1, NULL, ?2) ON CONFLICT(singleton) DO UPDATE SET prepared_state_sequence = excluded.prepared_state_sequence, updated_at_ms = excluded.updated_at_ms")
        .bind(expected_state_sequence)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-runtime-update-failed] 동기화 준비 상태를 저장하지 못했습니다: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("[sync-outbox-commit-failed] 동기화 변경 목록을 확정하지 못했습니다: {error}"))?;
    Ok(json!({
        "preparedStateSequence": expected_state_sequence,
        "changes": changes.len(),
    }))
}

#[tauri::command]
async fn sync_accept_baseline(
    instances: tauri::State<'_, DbInstances>,
    expected_state_sequence: i64,
    revision: String,
    base_state_json: String,
) -> Result<Value, String> {
    if expected_state_sequence < 0
        || !valid_sync_text(&revision, 200)
        || base_state_json.len() > 64 * 1024 * 1024
    {
        return Err("[sync-baseline-request-invalid] 동기화 기준점 요청이 올바르지 않습니다.".into());
    }
    let parsed: Value = serde_json::from_str(&base_state_json)
        .map_err(|_| "[sync-baseline-json-invalid] 동기화 기준 상태가 올바른 JSON이 아닙니다.".to_string())?;
    if parsed.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        return Err("[sync-baseline-schema-invalid] 동기화 기준 상태의 schema가 호환되지 않습니다.".into());
    }
    let database = {
        let databases = instances.0.read().await;
        match databases.get("sqlite:hamboard.db") {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("[sync-database-unavailable] Hamboard SQLite 연결을 찾지 못했습니다.".into()),
        }
    };
    let mut transaction = database.begin().await.map_err(|error| {
        format!("[sync-baseline-transaction-failed] 동기화 기준점 transaction을 시작하지 못했습니다: {error}")
    })?;
    let current_sequence: i64 = sqlx::query_scalar(
        "SELECT state_change_sequence FROM sync_runtime_state WHERE singleton = 1",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("[sync-state-read-failed] 현재 상태 순번을 읽지 못했습니다: {error}"))?;
    let stale = current_sequence != expected_state_sequence;
    if stale {
        return Ok(json!({"revision": revision, "stateSequence": current_sequence, "stale": true}));
    }
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-outbox-clear-failed] 동기화 대기 목록을 초기화하지 못했습니다: {error}"))?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    sqlx::query("UPDATE sync_runtime_state SET base_revision = ?1, base_state_json = ?2, prepared_state_sequence = ?3, requires_rebaseline = 0, last_sync_at_ms = ?4, updated_at_ms = ?4 WHERE singleton = 1")
        .bind(&revision)
        .bind(&base_state_json)
        .bind(expected_state_sequence)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-baseline-update-failed] 동기화 기준점을 저장하지 못했습니다: {error}"))?;
    transaction.commit().await.map_err(|error| {
        format!("[sync-baseline-commit-failed] 동기화 기준점을 확정하지 못했습니다: {error}")
    })?;
    Ok(json!({"revision": revision, "stateSequence": current_sequence, "stale": stale}))
}

#[tauri::command]
async fn sync_apply_remote_state(
    instances: tauri::State<'_, DbInstances>,
    expected_state_sequence: i64,
    revision: String,
    state_json: String,
    base_state_json: String,
) -> Result<Value, String> {
    if expected_state_sequence < 0
        || !valid_sync_text(&revision, 200)
        || state_json.len() > 64 * 1024 * 1024
        || base_state_json.len() > 64 * 1024 * 1024
    {
        return Err("[sync-remote-state-request-invalid] 원격 동기화 상태 요청이 올바르지 않습니다.".into());
    }
    let parsed: Value = serde_json::from_str(&state_json)
        .map_err(|_| "[sync-remote-state-json-invalid] 원격 동기화 상태가 올바른 JSON이 아닙니다.".to_string())?;
    if parsed.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        return Err("[sync-remote-state-schema-invalid] 원격 동기화 상태의 schema가 호환되지 않습니다.".into());
    }
    let parsed_base: Value = serde_json::from_str(&base_state_json)
        .map_err(|_| "[sync-remote-base-json-invalid] 원격 동기화 기준 상태가 올바른 JSON이 아닙니다.".to_string())?;
    if parsed_base.get("schemaVersion").and_then(Value::as_i64) != Some(1) {
        return Err("[sync-remote-base-schema-invalid] 원격 동기화 기준 상태의 schema가 호환되지 않습니다.".into());
    }
    let needs_outbox_rebuild = state_json != base_state_json;
    let database = {
        let databases = instances.0.read().await;
        match databases.get("sqlite:hamboard.db") {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("[sync-database-unavailable] Hamboard SQLite 연결을 찾지 못했습니다.".into()),
        }
    };
    let mut transaction = database.begin().await.map_err(|error| {
        format!("[sync-remote-state-transaction-failed] 원격 상태 적용 transaction을 시작하지 못했습니다: {error}")
    })?;
    let current_sequence: i64 = sqlx::query_scalar(
        "SELECT state_change_sequence FROM sync_runtime_state WHERE singleton = 1",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("[sync-state-read-failed] 현재 상태 순번을 읽지 못했습니다: {error}"))?;
    if current_sequence != expected_state_sequence {
        return Err("[sync-local-state-changed-before-apply] 원격 상태를 적용하기 전에 로컬 상태가 변경되었습니다.".into());
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    sqlx::query("UPDATE app_state SET state_json = ?1, updated_at = ?2 WHERE state_key = ?3")
        .bind(&state_json)
        .bind(now)
        .bind(MAIN_STATE_KEY)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-remote-state-write-failed] 원격 상태를 로컬 저장소에 적용하지 못했습니다: {error}"))?;
    let applied_sequence: i64 = sqlx::query_scalar(
        "SELECT state_change_sequence FROM sync_runtime_state WHERE singleton = 1",
    )
    .fetch_one(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-state-read-failed] 적용 후 상태 순번을 읽지 못했습니다: {error}"))?;
    let prepared_sequence = if needs_outbox_rebuild {
        applied_sequence.saturating_sub(1)
    } else {
        applied_sequence
    };
    sqlx::query("DELETE FROM sync_outbox")
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-outbox-clear-failed] 적용 전 동기화 대기 목록을 정리하지 못했습니다: {error}"))?;
    sqlx::query("UPDATE sync_runtime_state SET base_revision = ?1, base_state_json = ?2, prepared_state_sequence = ?3, requires_rebaseline = 0, last_sync_at_ms = ?4, updated_at_ms = ?4 WHERE singleton = 1")
        .bind(&revision)
        .bind(&base_state_json)
        .bind(prepared_sequence)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("[sync-runtime-update-failed] 적용한 원격 기준점을 저장하지 못했습니다: {error}"))?;
    transaction.commit().await.map_err(|error| {
        format!("[sync-remote-state-commit-failed] 원격 상태 적용을 확정하지 못했습니다: {error}")
    })?;
    Ok(json!({
        "revision": revision,
        "stateSequence": applied_sequence,
        "needsOutboxRebuild": needs_outbox_rebuild,
    }))
}

fn valid_restore_staging_prefix(name: &str) -> bool {
    name.starts_with("restore-staging-")
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

fn remove_restore_directory(path: &std::path::Path, label: &str) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| format!("{label}: {error}"))?;
    }
    Ok(())
}

fn cleanup_restore_staging_files(
    assets_path: &std::path::Path,
    staging_prefix: Option<&str>,
) -> Result<(), String> {
    if !assets_path.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(assets_path)
        .map_err(|error| format!("복원 임시 파일 목록을 읽지 못했습니다: {error}"))?
    {
        let entry = entry.map_err(|error| format!("복원 임시 파일을 확인하지 못했습니다: {error}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let matches = staging_prefix
            .map(|prefix| name.starts_with(prefix))
            .unwrap_or_else(|| name.starts_with("restore-staging-"));
        if matches
            && entry
                .file_type()
                .map_err(|error| format!("복원 임시 파일 종류를 확인하지 못했습니다: {error}"))?
                .is_file()
        {
            fs::remove_file(entry.path())
                .map_err(|error| format!("남은 복원 임시 파일을 정리하지 못했습니다: {error}"))?;
        }
    }
    Ok(())
}

fn write_restore_journal(
    app_data: &std::path::Path,
    marker: i64,
    had_assets: bool,
    staging_prefix: &str,
) -> Result<(), String> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE);
    let temporary_path = app_data.join(RESTORE_JOURNAL_TEMP_FILE);
    if temporary_path.exists() {
        fs::remove_file(&temporary_path)
            .map_err(|error| format!("이전 복원 기록 임시 파일을 정리하지 못했습니다: {error}"))?;
    }
    let contents = serde_json::to_vec(&json!({
        "marker": marker,
        "hadAssets": had_assets,
        "stagingPrefix": staging_prefix,
    }))
    .map_err(|error| format!("복원 기록을 만들지 못했습니다: {error}"))?;
    let mut file = fs::File::create(&temporary_path)
        .map_err(|error| format!("복원 기록 임시 파일을 만들지 못했습니다: {error}"))?;
    file.write_all(&contents)
        .map_err(|error| format!("복원 기록을 쓰지 못했습니다: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("복원 기록을 디스크에 확정하지 못했습니다: {error}"))?;
    drop(file);
    fs::rename(&temporary_path, &journal_path)
        .map_err(|error| format!("복원 기록을 적용하지 못했습니다: {error}"))?;
    Ok(())
}

fn recover_restore_files(
    app_data: &std::path::Path,
    committed: bool,
    had_assets: bool,
    staging_prefix: &str,
) -> Result<(), String> {
    let assets_path = app_data.join("assets");
    let rollback_path = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    if committed {
        if !assets_path.exists() {
            return Err("확정된 복원 이미지 폴더를 찾지 못해 이전 폴더를 보존했습니다.".into());
        }
        remove_restore_directory(&rollback_path, "복원 전 이미지 폴더를 정리하지 못했습니다")?;
    } else {
        if rollback_path.is_dir() {
            remove_restore_directory(&assets_path, "완료되지 않은 복원 이미지 폴더를 제거하지 못했습니다")?;
            fs::rename(&rollback_path, &assets_path)
                .map_err(|error| format!("기존 이미지 폴더를 복구하지 못했습니다: {error}"))?;
        } else if !had_assets {
            remove_restore_directory(&assets_path, "완료되지 않은 복원 이미지 폴더를 제거하지 못했습니다")?;
        }
        cleanup_restore_staging_files(&assets_path, Some(staging_prefix))?;
    }
    Ok(())
}

async fn clear_restore_marker(database: &sqlx::SqlitePool) {
    let _ = sqlx::query("DELETE FROM app_state WHERE state_key = ?1")
        .bind(RESTORE_MARKER_STATE_KEY)
        .execute(database)
        .await;
}

async fn recover_interrupted_backup_restore(
    app_data: &std::path::Path,
    database: &sqlx::SqlitePool,
) -> Result<bool, String> {
    let journal_path = app_data.join(RESTORE_JOURNAL_FILE);
    let temporary_path = app_data.join(RESTORE_JOURNAL_TEMP_FILE);
    if !journal_path.is_file() {
        if temporary_path.exists() {
            let _ = fs::remove_file(&temporary_path);
        }
        clear_restore_marker(database).await;
        return Ok(false);
    }
    let journal: Value = serde_json::from_slice(
        &fs::read(&journal_path)
            .map_err(|error| format!("중단된 복원 기록을 읽지 못했습니다: {error}"))?,
    )
    .map_err(|error| format!("중단된 복원 기록이 손상되었습니다: {error}"))?;
    let marker = restore_i64(&journal, "marker")?;
    let had_assets = journal
        .get("hadAssets")
        .and_then(Value::as_bool)
        .ok_or_else(|| "중단된 복원 기록의 hadAssets 값이 올바르지 않습니다.".to_string())?;
    let staging_prefix = restore_text(&journal, "stagingPrefix")?;
    if !valid_restore_staging_prefix(staging_prefix) {
        return Err("중단된 복원 기록의 임시 파일 접두사가 올바르지 않습니다.".into());
    }
    let committed_marker: Option<i64> =
        sqlx::query_scalar("SELECT updated_at FROM app_state WHERE state_key = ?1")
            .bind(RESTORE_MARKER_STATE_KEY)
            .fetch_optional(database)
            .await
            .map_err(|error| format!("복원 확정 상태를 확인하지 못했습니다: {error}"))?;
    recover_restore_files(
        app_data,
        committed_marker == Some(marker),
        had_assets,
        staging_prefix,
    )?;
    fs::remove_file(&journal_path)
        .map_err(|error| format!("완료된 복원 기록을 정리하지 못했습니다: {error}"))?;
    if temporary_path.exists() {
        let _ = fs::remove_file(&temporary_path);
    }
    clear_restore_marker(database).await;
    Ok(true)
}

#[tauri::command]
async fn restore_backup_atomic(
    app: tauri::AppHandle,
    instances: tauri::State<'_, DbInstances>,
    staging_prefix: String,
    state_json: String,
    versions: Vec<Value>,
    assets: Vec<Value>,
    work_programs: Vec<Value>,
    work_daily: Vec<Value>,
) -> Result<Value, String> {
    if !valid_restore_staging_prefix(&staging_prefix) {
        return Err("복원용 임시 파일 접두사가 올바르지 않습니다.".into());
    }

    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("앱 데이터 폴더를 찾지 못했습니다: {error}"))?;
    let database = {
        let databases = instances.0.read().await;
        match databases.get("sqlite:hamboard.db") {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("Hamboard SQLite 연결을 찾지 못했습니다.".into()),
        }
    };

    recover_interrupted_backup_restore(&app_data, &database).await?;
    let assets_path = app_data.join("assets");
    let rollback_path = app_data.join(RESTORE_ROLLBACK_DIRECTORY);
    if !assets_path.is_dir() {
        return Err("이미지 저장 폴더가 없습니다.".into());
    }
    if rollback_path.exists() {
        remove_restore_directory(&rollback_path, "이전 복원 임시 폴더를 정리하지 못했습니다")?;
    }
    let mut restore_file_names = Vec::with_capacity(assets.len());
    for record in &assets {
        let relative_path = restore_text(record, "relativePath")?;
        let file_name = relative_path
            .strip_prefix("assets/")
            .ok_or_else(|| "복원 이미지 경로가 올바르지 않습니다.".to_string())?;
        if file_name.is_empty()
            || file_name.contains('/')
            || file_name.contains('\\')
            || file_name.contains("..")
        {
            return Err("복원 이미지 경로가 올바르지 않습니다.".into());
        }
        if !assets_path
            .join(format!("{staging_prefix}{file_name}"))
            .is_file()
        {
            return Err(format!("복원용 임시 이미지 파일이 없습니다: {file_name}"));
        }
        restore_file_names.push(file_name.to_string());
    }
    let had_assets = assets_path.exists();
    let restore_marker = i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    )
    .unwrap_or(i64::MAX);
    write_restore_journal(
        &app_data,
        restore_marker,
        had_assets,
        &staging_prefix,
    )?;
    if had_assets {
        if let Err(error) = fs::rename(&assets_path, &rollback_path) {
            let recovery = recover_interrupted_backup_restore(&app_data, &database).await;
            return Err(match recovery {
                Ok(_) => format!("기존 이미지 폴더를 보존하지 못했습니다: {error}"),
                Err(recovery_error) => format!("기존 이미지 폴더를 보존하지 못했습니다: {error}; 자동 복구에도 실패했습니다: {recovery_error}"),
            });
        }
    }
    if let Err(error) = fs::create_dir_all(&assets_path) {
        let recovery = recover_interrupted_backup_restore(&app_data, &database).await;
        return Err(match recovery {
            Ok(_) => format!("복원 이미지 폴더를 만들지 못했습니다: {error}"),
            Err(recovery_error) => format!("복원 이미지 폴더를 만들지 못했습니다: {error}; 자동 복구에도 실패했습니다: {recovery_error}"),
        });
    }
    for file_name in &restore_file_names {
        let staged_path = rollback_path.join(format!("{staging_prefix}{file_name}"));
        let destination_path = assets_path.join(file_name);
        if let Err(error) = fs::rename(&staged_path, &destination_path) {
            let recovery = recover_interrupted_backup_restore(&app_data, &database).await;
            return Err(match recovery {
                Ok(_) => format!("복원 이미지 파일을 적용하지 못했습니다: {error}"),
                Err(recovery_error) => format!("복원 이미지 파일을 적용하지 못했습니다: {error}; 자동 복구에도 실패했습니다: {recovery_error}"),
            });
        }
    }

    let operation: Result<(), String> = async {
        let mut transaction = database
            .begin()
            .await
            .map_err(|error| format!("복원 transaction을 시작하지 못했습니다: {error}"))?;
        sqlx::query("INSERT INTO app_state (state_key, state_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at")
            .bind(MAIN_STATE_KEY)
            .bind(&state_json)
            .bind(restore_marker)
            .execute(&mut *transaction).await.map_err(|error| format!("상태 복원에 실패했습니다: {error}"))?;
        sqlx::query("INSERT INTO app_state (state_key, state_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at")
            .bind(RESTORE_MARKER_STATE_KEY)
            .bind(restore_marker.to_string())
            .bind(restore_marker)
            .execute(&mut *transaction).await.map_err(|error| format!("복원 확정 표지를 저장하지 못했습니다: {error}"))?;
        sqlx::query("DELETE FROM version_records").execute(&mut *transaction).await.map_err(|error| format!("버전 기록 초기화에 실패했습니다: {error}"))?;
        for record in &versions {
            let id = restore_text(record, "id")?;
            let owner_key = restore_text(record, "ownerKey")?;
            let at_ms = record.get("atMs").and_then(Value::as_i64).unwrap_or(0);
            let record_json = serde_json::to_string(record).map_err(|error| format!("버전 기록 직렬화에 실패했습니다: {error}"))?;
            sqlx::query("INSERT INTO version_records (id, owner_key, at_ms, record_json) VALUES (?1, ?2, ?3, ?4)").bind(id).bind(owner_key).bind(at_ms).bind(record_json).execute(&mut *transaction).await.map_err(|error| format!("버전 기록 복원에 실패했습니다: {error}"))?;
        }
        sqlx::query("DELETE FROM asset_content_metadata").execute(&mut *transaction).await.map_err(|error| format!("이미지 내용 메타데이터 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM asset_records").execute(&mut *transaction).await.map_err(|error| format!("이미지 메타데이터 초기화에 실패했습니다: {error}"))?;
        for record in &assets {
            let relative_path = restore_text(record, "relativePath")?;
            let file_name = relative_path.strip_prefix("assets/").ok_or_else(|| "복원 이미지 경로가 올바르지 않습니다.".to_string())?;
            if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
                return Err("복원 이미지 경로가 올바르지 않습니다.".into());
            }
            sqlx::query("INSERT INTO asset_records (id, owner_id, mime_type, byte_size, relative_path) VALUES (?1, ?2, ?3, ?4, ?5)")
                .bind(restore_text(record, "id")?).bind(restore_text(record, "ownerId")?).bind(restore_text(record, "mimeType")?).bind(restore_i64(record, "byteSize")?).bind(relative_path).execute(&mut *transaction).await.map_err(|error| format!("이미지 메타데이터 복원에 실패했습니다: {error}"))?;
        }
        sqlx::query("DELETE FROM cloud_backup_items").execute(&mut *transaction).await.map_err(|error| format!("클라우드 백업 작업 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM cloud_backup_runs").execute(&mut *transaction).await.map_err(|error| format!("클라우드 백업 실행 기록 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM sync_outbox").execute(&mut *transaction).await.map_err(|error| format!("동기화 대기 목록 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM sync_asset_transfers").execute(&mut *transaction).await.map_err(|error| format!("Asset 동기화 대기 목록 초기화에 실패했습니다: {error}"))?;
        sqlx::query("UPDATE sync_conflicts SET status = 'archived', resolution = 'backup-restore', resolved_at_ms = ?1 WHERE status = 'unresolved'").bind(restore_marker).execute(&mut *transaction).await.map_err(|error| format!("동기화 충돌 기록 보존 처리에 실패했습니다: {error}"))?;
        sqlx::query("INSERT INTO sync_runtime_state (singleton, base_revision, base_state_json, state_change_sequence, prepared_state_sequence, dirty_state_updated_at_ms, requires_rebaseline, last_sync_at_ms, updated_at_ms) VALUES (1, '', NULL, 1, 0, ?1, 1, NULL, ?1) ON CONFLICT(singleton) DO UPDATE SET base_revision = '', base_state_json = NULL, prepared_state_sequence = 0, dirty_state_updated_at_ms = excluded.dirty_state_updated_at_ms, requires_rebaseline = 1, last_sync_at_ms = NULL, updated_at_ms = excluded.updated_at_ms").bind(restore_marker).execute(&mut *transaction).await.map_err(|error| format!("복원 후 동기화 기준 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM work_tracker_daily").execute(&mut *transaction).await.map_err(|error| format!("작업 기록 초기화에 실패했습니다: {error}"))?;
        sqlx::query("DELETE FROM work_tracker_programs").execute(&mut *transaction).await.map_err(|error| format!("프로그램 기록 초기화에 실패했습니다: {error}"))?;
        for record in &work_programs {
            sqlx::query("INSERT INTO work_tracker_programs (id, display_name, executable_path, executable_name, created_at_ms, updated_at_ms, archived_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
                .bind(restore_text(record, "id")?).bind(restore_text(record, "display_name")?).bind(restore_text(record, "executable_path")?).bind(restore_text(record, "executable_name")?).bind(restore_i64(record, "created_at_ms")?).bind(restore_i64(record, "updated_at_ms")?).bind(record.get("archived_at_ms").and_then(Value::as_i64)).execute(&mut *transaction).await.map_err(|error| format!("프로그램 기록 복원에 실패했습니다: {error}"))?;
        }
        for record in &work_daily {
            sqlx::query("INSERT INTO work_tracker_daily (program_id, work_date, seconds, updated_at_ms) VALUES (?1, ?2, ?3, ?4)")
                .bind(restore_text(record, "program_id")?).bind(restore_text(record, "work_date")?).bind(restore_i64(record, "seconds")?).bind(restore_i64(record, "updated_at_ms")?).execute(&mut *transaction).await.map_err(|error| format!("일별 작업 기록 복원에 실패했습니다: {error}"))?;
        }
        transaction.commit().await.map_err(|error| format!("복원 transaction 확정에 실패했습니다: {error}"))?;
        Ok(())
    }.await;

    if let Err(error) = operation {
        return Err(match recover_interrupted_backup_restore(&app_data, &database).await {
            Ok(_) => error,
            Err(recovery_error) => format!("{error}; 자동 복구에도 실패했습니다: {recovery_error}"),
        });
    }
    match recover_interrupted_backup_restore(&app_data, &database).await {
        Ok(_) => Ok(json!({"cleanupPending": false})),
        Err(cleanup_error) => Ok(json!({
            "cleanupPending": true,
            "warning": cleanup_error,
        })),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_app_state_table",
            sql: "CREATE TABLE IF NOT EXISTS app_state (state_key TEXT PRIMARY KEY NOT NULL, state_json TEXT NOT NULL, updated_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_version_records_table",
            sql: "CREATE TABLE IF NOT EXISTS version_records (id TEXT PRIMARY KEY NOT NULL, owner_key TEXT NOT NULL, at_ms INTEGER NOT NULL, record_json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_version_records_owner_at_ms ON version_records (owner_key, at_ms DESC);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_asset_records_table",
            sql: "CREATE TABLE IF NOT EXISTS asset_records (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, relative_path TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_asset_records_owner_id ON asset_records (owner_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_work_tracker_tables",
            sql: "CREATE TABLE IF NOT EXISTS work_tracker_programs (id TEXT PRIMARY KEY NOT NULL, display_name TEXT NOT NULL, executable_path TEXT NOT NULL COLLATE NOCASE UNIQUE, executable_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, archived_at_ms INTEGER); CREATE TABLE IF NOT EXISTS work_tracker_daily (program_id TEXT NOT NULL, work_date TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0 CHECK(seconds >= 0), updated_at_ms INTEGER NOT NULL, PRIMARY KEY (program_id, work_date)); CREATE INDEX IF NOT EXISTS idx_work_tracker_daily_date ON work_tracker_daily (work_date);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_sync_foundation",
            sql: "CREATE TABLE IF NOT EXISTS sync_device_state (singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1), device_id TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sync_runtime_state (singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton = 1), base_revision TEXT NOT NULL DEFAULT '', base_state_json TEXT, state_change_sequence INTEGER NOT NULL DEFAULT 0 CHECK(state_change_sequence >= 0), prepared_state_sequence INTEGER NOT NULL DEFAULT 0 CHECK(prepared_state_sequence >= 0), dirty_state_updated_at_ms INTEGER NOT NULL DEFAULT 0, requires_rebaseline INTEGER NOT NULL DEFAULT 1 CHECK(requires_rebaseline IN (0, 1)), last_sync_at_ms INTEGER, updated_at_ms INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS sync_outbox (change_id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('upsert', 'delete')), payload_json TEXT, payload_sha256 TEXT CHECK(payload_sha256 IS NULL OR (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*')), base_payload_json TEXT, base_sha256 TEXT CHECK(base_sha256 IS NULL OR (length(base_sha256) = 64 AND base_sha256 NOT GLOB '*[^0-9a-f]*')), base_revision TEXT NOT NULL DEFAULT '', state_change_sequence INTEGER NOT NULL CHECK(state_change_sequence >= 0), status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploading', 'uploaded', 'failed')), created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, CHECK((operation = 'upsert' AND payload_json IS NOT NULL AND payload_sha256 IS NOT NULL) OR (operation = 'delete' AND payload_json IS NULL AND payload_sha256 IS NULL))); CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox (entity_type, entity_id); CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox (status, updated_at_ms); CREATE TABLE IF NOT EXISTS sync_conflicts (id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, base_revision TEXT NOT NULL DEFAULT '', remote_revision TEXT NOT NULL DEFAULT '', local_device_id TEXT NOT NULL, remote_device_id TEXT NOT NULL, base_json TEXT, local_json TEXT, remote_json TEXT, status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved', 'resolved', 'archived')), resolution TEXT NOT NULL DEFAULT '', created_at_ms INTEGER NOT NULL, resolved_at_ms INTEGER); CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status_created ON sync_conflicts (status, created_at_ms DESC); CREATE TRIGGER IF NOT EXISTS trg_sync_mark_app_state_insert AFTER INSERT ON app_state WHEN NEW.state_key = 'hamboard.state.v1' BEGIN INSERT INTO sync_runtime_state (singleton, base_revision, base_state_json, state_change_sequence, prepared_state_sequence, dirty_state_updated_at_ms, requires_rebaseline, last_sync_at_ms, updated_at_ms) VALUES (1, '', NULL, 1, 0, NEW.updated_at, 1, NULL, NEW.updated_at) ON CONFLICT(singleton) DO UPDATE SET state_change_sequence = state_change_sequence + 1, dirty_state_updated_at_ms = NEW.updated_at, updated_at_ms = NEW.updated_at; END; CREATE TRIGGER IF NOT EXISTS trg_sync_mark_app_state_update AFTER UPDATE OF state_json, updated_at ON app_state WHEN NEW.state_key = 'hamboard.state.v1' BEGIN INSERT INTO sync_runtime_state (singleton, base_revision, base_state_json, state_change_sequence, prepared_state_sequence, dirty_state_updated_at_ms, requires_rebaseline, last_sync_at_ms, updated_at_ms) VALUES (1, '', NULL, 1, 0, NEW.updated_at, 1, NULL, NEW.updated_at) ON CONFLICT(singleton) DO UPDATE SET state_change_sequence = state_change_sequence + 1, dirty_state_updated_at_ms = NEW.updated_at, updated_at_ms = NEW.updated_at; END;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_sync_asset_transfer_queue",
            sql: "CREATE TABLE IF NOT EXISTS sync_asset_transfers (asset_id TEXT NOT NULL, quality TEXT NOT NULL CHECK(quality IN ('storage-saver', 'balanced', 'original')), source_sha256 TEXT NOT NULL CHECK(length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'), descriptor_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploading', 'uploaded', 'failed')), attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0), next_attempt_at_ms INTEGER NOT NULL DEFAULT 0, remote_descriptor_id TEXT, last_error TEXT NOT NULL DEFAULT '', updated_at_ms INTEGER NOT NULL, PRIMARY KEY (asset_id, quality)); CREATE INDEX IF NOT EXISTS idx_sync_asset_transfers_retry ON sync_asset_transfers (status, next_attempt_at_ms);",
            kind: MigrationKind::Up,
        },
    ];

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == "--hamboard-autostart") {
                return;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--hamboard-autostart")
                .app_name("햄보드")
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:hamboard.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            google_drive::google_drive_status,
            google_drive::google_drive_connect,
            google_drive::google_drive_disconnect,
            google_drive::google_drive_put_object,
            google_drive::google_drive_list_backups,
            google_drive::google_drive_get_object,
            google_drive::google_drive_delete_backup_manifest,
            google_drive::google_drive_list_sync_objects,
            google_drive::google_drive_get_sync_object,
            google_drive::google_drive_delete_sync_object,
            work_tracker::work_tracker_status,
            work_tracker::work_tracker_inspect_program_path,
            work_tracker::work_tracker_running_programs,
            work_tracker::work_tracker_reload_programs,
            work_tracker::work_tracker_set_enabled,
            work_tracker::work_tracker_reset_records,
            work_tracker::work_tracker_flush,
            utility_timer_sync,
            play_notification_sound,
            app_exit_after_flush,
            sync_replace_outbox,
            sync_accept_baseline,
            sync_apply_remote_state,
            restore_backup_atomic,
            list_system_fonts,
            install_sound_pack,
            list_public_holidays,
        ])
        .setup(|app| {
            let launched_from_autostart =
                std::env::args().any(|arg| arg == "--hamboard-autostart");
            if launched_from_autostart {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            let instances = app.state::<DbInstances>();
            let pool = tauri::async_runtime::block_on(async {
                let databases = instances.0.read().await;
                match databases.get("sqlite:hamboard.db") {
                    Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
                    _ => Err("미리 로드된 Hamboard SQLite 연결을 찾지 못했습니다.".to_string()),
                }
            })?;
            let app_data = app
                .path()
                .app_local_data_dir()
                .map_err(|error| format!("앱 데이터 폴더를 찾지 못했습니다: {error}"))?;
            tauri::async_runtime::block_on(recover_interrupted_backup_restore(
                &app_data,
                &pool,
            ))?;
            cleanup_restore_staging_files(&app_data.join("assets"), None)?;
            let tracker = tauri::async_runtime::block_on(work_tracker::WorkTracker::start(pool))?;
            app.manage(tracker);
            app.manage(UtilityTimerService::start(app.handle().clone()));
            app.manage(google_drive::GoogleDriveAuthState::default());

            let open_item = MenuItem::with_id(app, "open", "햄보드 열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .tooltip("햄보드")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = app.emit("hamboard-tray-exit-requested", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Hamboard");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            if let Some(tracker) = app_handle.try_state::<work_tracker::WorkTracker>() {
                if let Err(error) = tracker.flush() {
                    eprintln!("작업 기록 종료 저장 실패: {error}");
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(tracker) = app_handle.try_state::<work_tracker::WorkTracker>() {
                tracker.shutdown();
            }
            if let Some(utility_timers) = app_handle.try_state::<UtilityTimerService>() {
                utility_timers.shutdown();
            }
        }
        _ => {}
    });
}
