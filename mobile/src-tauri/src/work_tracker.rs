use serde_json::{json, Value};
use sqlx::{Pool, Row, Sqlite};
use std::{
    collections::HashMap,
    path::Path,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

const IDLE_LIMIT_MS: u64 = 10_000;
const POLL_INTERVAL: Duration = Duration::from_secs(1);
const PERIODIC_FLUSH: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
struct RegisteredProgram {
    id: String,
    display_name: String,
    normalized_path: String,
    normalized_name: String,
}

#[derive(Clone, Debug)]
struct ForegroundProgram {
    executable_path: String,
    executable_name: String,
    display_name: String,
}

#[derive(Clone, Default)]
struct TrackerStatus {
    enabled: bool,
    idle_ms: u64,
    is_idle: bool,
    active_program_id: Option<String>,
    active_program_name: Option<String>,
    last_error: Option<String>,
    work_date: String,
    pending_seconds: HashMap<String, u64>,
    today_seconds: HashMap<String, u64>,
    session_seconds: HashMap<String, u64>,
}

impl TrackerStatus {
    fn as_json(&self) -> Value {
        json!({
            "enabled": self.enabled,
            "idleSeconds": self.idle_ms / 1000,
            "isIdle": self.is_idle,
            "isTracking": self.enabled && self.active_program_id.is_some() && !self.is_idle,
            "programId": self.active_program_id,
            "programName": self.active_program_name,
            "error": self.last_error,
            "workDate": self.work_date,
            "pendingSeconds": self.pending_seconds,
            "todaySeconds": self.today_seconds,
            "sessionSeconds": self.session_seconds,
            "idleLimitSeconds": IDLE_LIMIT_MS / 1000
        })
    }
}

enum ControlMessage {
    ReplacePrograms(Vec<RegisteredProgram>),
    SetEnabled(bool, mpsc::Sender<Result<(), String>>),
    ResetRecords {
        scope: String,
        date: Option<String>,
        program_id: Option<String>,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Flush(mpsc::Sender<Result<(), String>>),
    Stop(mpsc::Sender<Result<(), String>>),
}

pub struct WorkTracker {
    pool: Pool<Sqlite>,
    sender: mpsc::Sender<ControlMessage>,
    status: Arc<Mutex<TrackerStatus>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl WorkTracker {
    pub async fn start(pool: Pool<Sqlite>) -> Result<Self, String> {
        ensure_default_hamboard_program(&pool).await?;
        let programs = load_programs(&pool).await?;
        let (sender, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(TrackerStatus::default()));
        let worker_status = Arc::clone(&status);
        let worker_pool = pool.clone();
        let worker = thread::Builder::new()
            .name("hamboard-work-tracker".into())
            .spawn(move || run_monitor(worker_pool, programs, worker_status, receiver))
            .map_err(|error| format!("작업 기록 감지기를 시작하지 못했습니다: {error}"))?;
        Ok(Self {
            pool,
            sender,
            status,
            worker: Mutex::new(Some(worker)),
        })
    }

    pub fn flush(&self) -> Result<(), String> {
        let (reply_sender, reply_receiver) = mpsc::channel();
        self.sender
            .send(ControlMessage::Flush(reply_sender))
            .map_err(|_| "작업 기록 감지기가 종료되었습니다.".to_string())?;
        reply_receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "작업 기록 저장 응답 시간이 초과되었습니다.".to_string())?
    }

    pub fn shutdown(&self) {
        let mut worker = self
            .worker
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let Some(handle) = worker.take() else { return };
        let (reply_sender, reply_receiver) = mpsc::channel();
        let _ = self.sender.send(ControlMessage::Stop(reply_sender));
        let _ = reply_receiver.recv_timeout(Duration::from_secs(5));
        let _ = handle.join();
    }
}

#[tauri::command]
pub fn work_tracker_status(tracker: State<'_, WorkTracker>) -> Value {
    tracker
        .status
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_json()
}

#[tauri::command]
pub fn work_tracker_inspect_program_path(path: String) -> Result<Value, String> {
    inspect_program_path(&path).map(|program| program_json(&program))
}

#[tauri::command]
pub fn work_tracker_running_programs() -> Result<Vec<Value>, String> {
    running_programs().map(|programs| programs.iter().map(program_json).collect())
}

#[tauri::command]
pub async fn work_tracker_reload_programs(tracker: State<'_, WorkTracker>) -> Result<(), String> {
    let programs = load_programs(&tracker.pool).await?;
    tracker
        .sender
        .send(ControlMessage::ReplacePrograms(programs))
        .map_err(|_| "작업 기록 감지기가 종료되었습니다.".to_string())
}

#[tauri::command]
pub fn work_tracker_set_enabled(
    enabled: bool,
    tracker: State<'_, WorkTracker>,
) -> Result<(), String> {
    let (reply_sender, reply_receiver) = mpsc::channel();
    tracker
        .sender
        .send(ControlMessage::SetEnabled(enabled, reply_sender))
        .map_err(|_| "작업 기록 감지기가 종료되었습니다.".to_string())?;
    reply_receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "작업 기록 설정 응답 시간이 초과되었습니다.".to_string())?
}

#[tauri::command]
pub fn work_tracker_reset_records(
    scope: String,
    date: Option<String>,
    program_id: Option<String>,
    tracker: State<'_, WorkTracker>,
) -> Result<(), String> {
    let (reply_sender, reply_receiver) = mpsc::channel();
    tracker
        .sender
        .send(ControlMessage::ResetRecords {
            scope,
            date,
            program_id,
            reply: reply_sender,
        })
        .map_err(|_| "작업 기록 감지기가 종료되었습니다.".to_string())?;
    reply_receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "작업 기록 초기화 응답 시간이 초과되었습니다.".to_string())?
}

#[tauri::command]
pub fn work_tracker_flush(tracker: State<'_, WorkTracker>) -> Result<(), String> {
    tracker.flush()
}

async fn ensure_default_hamboard_program(pool: &Pool<Sqlite>) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("햄보드 실행 파일 위치를 확인하지 못했습니다: {error}"))?;
    let executable_path = executable.to_string_lossy().into_owned();
    let executable_name = executable
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("hamboard.exe")
        .to_string();
    let normalized_path = normalize_windows_path(&executable_path);
    let rows = sqlx::query(
        "SELECT id, display_name, executable_path, executable_name FROM work_tracker_programs ORDER BY created_at_ms",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("햄보드 기본 작업 프로그램을 확인하지 못했습니다: {error}"))?;

    let mut candidates: Vec<(String, String)> = Vec::new();
    for row in rows {
        let id: String = row.get("id");
        let display_name: String = row.get("display_name");
        let path: String = row.get("executable_path");
        let name: String = row.get("executable_name");
        let same_path = normalize_windows_path(&path) == normalized_path;
        let same_hamboard = display_name.trim() == "햄보드"
            && name.eq_ignore_ascii_case(&executable_name);
        if same_path || same_hamboard {
            candidates.push((id, path));
        }
    }

    if candidates.is_empty() {
        sqlx::query("INSERT INTO work_tracker_programs (id, display_name, executable_path, executable_name, created_at_ms, updated_at_ms, archived_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)")
            .bind(format!("hamboard-{}-{}", epoch_ms(), std::process::id()))
            .bind("햄보드")
            .bind(executable_path)
            .bind(executable_name)
            .bind(epoch_ms())
            .execute(pool)
            .await
            .map_err(|error| format!("햄보드를 기본 작업 프로그램으로 등록하지 못했습니다: {error}"))?;
        return Ok(());
    }

    let keeper_id = candidates
        .iter()
        .find(|(_, path)| normalize_windows_path(path) == normalized_path)
        .map(|(id, _)| id.clone())
        .unwrap_or_else(|| candidates[0].0.clone());
    let now = epoch_ms();
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("햄보드 작업 기록 중복 정리를 시작하지 못했습니다: {error}"))?;

    for (duplicate_id, _) in candidates.iter().filter(|(id, _)| id != &keeper_id) {
        sqlx::query("INSERT INTO work_tracker_daily (program_id, work_date, seconds, updated_at_ms) SELECT ?1, work_date, seconds, updated_at_ms FROM work_tracker_daily WHERE program_id = ?2 ON CONFLICT(program_id, work_date) DO UPDATE SET seconds = work_tracker_daily.seconds + excluded.seconds, updated_at_ms = MAX(work_tracker_daily.updated_at_ms, excluded.updated_at_ms)")
            .bind(&keeper_id)
            .bind(duplicate_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("중복 햄보드 작업 시간을 합치지 못했습니다: {error}"))?;
        sqlx::query("DELETE FROM work_tracker_daily WHERE program_id = ?1")
            .bind(duplicate_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("중복 햄보드 작업 기록을 정리하지 못했습니다: {error}"))?;
        sqlx::query("DELETE FROM work_tracker_programs WHERE id = ?1")
            .bind(duplicate_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("중복 햄보드 프로그램을 정리하지 못했습니다: {error}"))?;
    }

    sqlx::query("UPDATE work_tracker_programs SET display_name = ?1, executable_path = ?2, executable_name = ?3, updated_at_ms = ?4, archived_at_ms = NULL WHERE id = ?5")
        .bind("햄보드")
        .bind(executable_path)
        .bind(executable_name)
        .bind(now)
        .bind(&keeper_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("햄보드 기본 작업 프로그램 정보를 갱신하지 못했습니다: {error}"))?;

    transaction
        .commit()
        .await
        .map_err(|error| format!("햄보드 작업 기록 중복 정리를 저장하지 못했습니다: {error}"))?;
    Ok(())
}

async fn load_programs(pool: &Pool<Sqlite>) -> Result<Vec<RegisteredProgram>, String> {
    let rows = sqlx::query(
        "SELECT id, display_name, executable_path, executable_name FROM work_tracker_programs WHERE archived_at_ms IS NULL ORDER BY created_at_ms",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("작업 프로그램 목록을 읽지 못했습니다: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let executable_path: String = row.get("executable_path");
            let executable_name: String = row.get("executable_name");
            RegisteredProgram {
                id: row.get("id"),
                display_name: row.get("display_name"),
                normalized_path: normalize_windows_path(&executable_path),
                normalized_name: normalize_executable_name(&executable_name),
            }
        })
        .collect())
}

fn run_monitor(
    pool: Pool<Sqlite>,
    mut programs: Vec<RegisteredProgram>,
    status: Arc<Mutex<TrackerStatus>>,
    receiver: mpsc::Receiver<ControlMessage>,
) {
    let mut enabled = false;
    let mut pending_ms: HashMap<(String, String), u64> = HashMap::new();
    let mut today_ms: HashMap<String, u64> = HashMap::new();
    let mut session_ms: HashMap<String, u64> = HashMap::new();
    let mut active_key: Option<(String, String)> = None;
    let mut tracked_date = String::new();
    let mut last_poll = Instant::now();
    let mut last_flush = Instant::now();
    let mut next_poll = Instant::now();

    loop {
        let timeout = next_poll.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(timeout) {
            Ok(ControlMessage::ReplacePrograms(next)) => {
                if let Err(error) = flush_pending(&pool, &mut pending_ms) {
                    set_error(&status, Some(error));
                }
                programs = next;
                let active_program_ids = programs
                    .iter()
                    .map(|program| program.id.as_str())
                    .collect::<std::collections::HashSet<_>>();
                session_ms.retain(|program_id, _| active_program_ids.contains(program_id.as_str()));
                active_key = None;
                if !tracked_date.is_empty() {
                    match load_day_millis_with_pending(&pool, &tracked_date, &pending_ms) {
                        Ok(next_today) => today_ms = next_today,
                        Err(error) => set_error(&status, Some(error)),
                    }
                }
            }
            Ok(ControlMessage::SetEnabled(next_enabled, reply)) => {
                let result = if !next_enabled {
                    flush_pending(&pool, &mut pending_ms)
                } else {
                    Ok(())
                };
                if result.is_ok() {
                    enabled = next_enabled;
                    active_key = None;
                    let mut guard = status.lock().unwrap_or_else(|error| error.into_inner());
                    guard.enabled = enabled;
                    if !enabled {
                        guard.active_program_id = None;
                        guard.active_program_name = None;
                    }
                    guard.pending_seconds = pending_seconds_for_date(&pending_ms, &tracked_date);
                    guard.today_seconds = millis_map_to_seconds(&today_ms);
                    guard.session_seconds = millis_map_to_seconds(&session_ms);
                    guard.last_error = None;
                } else {
                    set_error(&status, result.as_ref().err().cloned());
                }
                let _ = reply.send(result);
            }
            Ok(ControlMessage::ResetRecords {
                scope,
                date,
                program_id,
                reply,
            }) => {
                let result = reset_records(
                    &pool,
                    &scope,
                    date.as_deref(),
                    program_id.as_deref(),
                    &tracked_date,
                    &mut pending_ms,
                    &mut today_ms,
                    &mut session_ms,
                    &mut active_key,
                );
                set_error(&status, result.as_ref().err().cloned());
                if result.is_ok() {
                    let mut guard = status.lock().unwrap_or_else(|error| error.into_inner());
                    guard.pending_seconds = pending_seconds_for_date(&pending_ms, &tracked_date);
                    guard.today_seconds = millis_map_to_seconds(&today_ms);
                    guard.session_seconds = millis_map_to_seconds(&session_ms);
                    if active_key.is_none() {
                        guard.active_program_id = None;
                        guard.active_program_name = None;
                    }
                }
                let _ = reply.send(result);
            }
            Ok(ControlMessage::Flush(reply)) => {
                let result = flush_pending(&pool, &mut pending_ms);
                set_error(&status, result.as_ref().err().cloned());
                if result.is_ok() {
                    let mut guard = status.lock().unwrap_or_else(|error| error.into_inner());
                    guard.pending_seconds = pending_seconds_for_date(&pending_ms, &tracked_date);
                    guard.today_seconds = millis_map_to_seconds(&today_ms);
                    guard.session_seconds = millis_map_to_seconds(&session_ms);
                }
                let _ = reply.send(result);
            }
            Ok(ControlMessage::Stop(reply)) => {
                let result = flush_pending(&pool, &mut pending_ms);
                set_error(&status, result.as_ref().err().cloned());
                let _ = reply.send(result);
                return;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = flush_pending(&pool, &mut pending_ms);
                return;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        let now = Instant::now();
        if now < next_poll {
            continue;
        }
        let elapsed_ms = now.duration_since(last_poll).as_millis().min(1_500) as u64;
        last_poll = now;
        next_poll = now + POLL_INTERVAL;

        let date = local_date_key();
        if tracked_date != date {
            if let Err(error) = flush_pending(&pool, &mut pending_ms) {
                set_error(&status, Some(error));
            }
            tracked_date = date.clone();
            active_key = None;
            match load_day_millis_with_pending(&pool, &tracked_date, &pending_ms) {
                Ok(next_today) => today_ms = next_today,
                Err(error) => {
                    today_ms.clear();
                    set_error(&status, Some(error));
                }
            }
        }

        let idle_ms = system_idle_ms().unwrap_or(IDLE_LIMIT_MS);
        let is_idle = idle_ms >= IDLE_LIMIT_MS;
        let foreground = if enabled {
            current_foreground_program()
        } else {
            None
        };
        let matched = if enabled && !is_idle {
            foreground.as_ref().and_then(|foreground| {
                let normalized = normalize_windows_path(&foreground.executable_path);
                let exact = programs
                    .iter()
                    .find(|program| program.normalized_path == normalized)
                    .cloned();
                exact.or_else(|| {
                    let normalized_name = normalize_executable_name(&foreground.executable_name);
                    if normalized_name.is_empty() {
                        return None;
                    }
                    let mut candidates = programs
                        .iter()
                        .filter(|program| program.normalized_name == normalized_name);
                    let candidate = candidates.next()?.clone();
                    if candidates.next().is_none() {
                        Some(candidate)
                    } else {
                        None
                    }
                })
            })
        } else {
            None
        };
        let next_key = matched
            .as_ref()
            .map(|program| (program.id.clone(), date.clone()));

        if active_key == next_key {
            if let Some(key) = next_key.as_ref() {
                *pending_ms.entry(key.clone()).or_default() += elapsed_ms;
                *today_ms.entry(key.0.clone()).or_default() += elapsed_ms;
                *session_ms.entry(key.0.clone()).or_default() += elapsed_ms;
            }
        } else {
            if let Err(error) = flush_pending(&pool, &mut pending_ms) {
                set_error(&status, Some(error));
            }
            active_key = next_key;
            last_flush = now;
        }

        if now.duration_since(last_flush) >= PERIODIC_FLUSH {
            match flush_pending(&pool, &mut pending_ms) {
                Ok(()) => set_error(&status, None),
                Err(error) => set_error(&status, Some(error)),
            }
            last_flush = now;
        }

        let mut guard = status.lock().unwrap_or_else(|error| error.into_inner());
        guard.enabled = enabled;
        guard.idle_ms = idle_ms;
        guard.is_idle = is_idle;
        guard.active_program_id = matched.as_ref().map(|program| program.id.clone());
        guard.active_program_name = matched.map(|program| program.display_name);
        guard.work_date = date;
        guard.pending_seconds = pending_seconds_for_date(&pending_ms, &tracked_date);
        guard.today_seconds = millis_map_to_seconds(&today_ms);
        guard.session_seconds = millis_map_to_seconds(&session_ms);
    }
}

fn reset_records(
    pool: &Pool<Sqlite>,
    scope: &str,
    date: Option<&str>,
    program_id: Option<&str>,
    tracked_date: &str,
    pending_ms: &mut HashMap<(String, String), u64>,
    today_ms: &mut HashMap<String, u64>,
    session_ms: &mut HashMap<String, u64>,
    active_key: &mut Option<(String, String)>,
) -> Result<(), String> {
    match scope {
        "all" => {
            tauri::async_runtime::block_on(async {
                sqlx::query("DELETE FROM work_tracker_daily")
                    .execute(pool)
                    .await
            })
            .map_err(|error| format!("전체 작업기록을 초기화하지 못했습니다: {error}"))?;
            pending_ms.clear();
            today_ms.clear();
            *active_key = None;
            Ok(())
        }
        "date" => {
            let date = date
                .filter(|value| is_date_key(value))
                .ok_or_else(|| "초기화할 날짜가 올바르지 않습니다.".to_string())?;
            tauri::async_runtime::block_on(async {
                sqlx::query("DELETE FROM work_tracker_daily WHERE work_date = ?1")
                    .bind(date)
                    .execute(pool)
                    .await
            })
            .map_err(|error| format!("선택한 날짜의 작업기록을 초기화하지 못했습니다: {error}"))?;
            pending_ms.retain(|(_, work_date), _| work_date != date);
            if tracked_date == date {
                today_ms.clear();
                *active_key = None;
            }
            Ok(())
        }
        "session" => {
            let program_id = program_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "초기화할 작업 세션을 찾지 못했습니다.".to_string())?;
            session_ms.remove(program_id);
            Ok(())
        }
        "program-date" => {
            let date = date
                .filter(|value| is_date_key(value))
                .ok_or_else(|| "삭제할 기록의 날짜가 올바르지 않습니다.".to_string())?;
            let program_id = program_id
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "삭제할 프로그램 기록을 찾지 못했습니다.".to_string())?;
            tauri::async_runtime::block_on(async {
                sqlx::query(
                    "DELETE FROM work_tracker_daily WHERE program_id = ?1 AND work_date = ?2",
                )
                .bind(program_id)
                .bind(date)
                .execute(pool)
                .await
            })
            .map_err(|error| format!("프로그램 작업기록을 삭제하지 못했습니다: {error}"))?;
            pending_ms.remove(&(program_id.to_string(), date.to_string()));
            if tracked_date == date {
                today_ms.remove(program_id);
                if active_key
                    .as_ref()
                    .map(|(active_program, active_date)| {
                        active_program == program_id && active_date == date
                    })
                    .unwrap_or(false)
                {
                    *active_key = None;
                }
            }
            Ok(())
        }
        _ => Err("지원하지 않는 작업기록 초기화 범위입니다.".to_string()),
    }
}

fn load_day_millis_with_pending(
    pool: &Pool<Sqlite>,
    date: &str,
    pending_ms: &HashMap<(String, String), u64>,
) -> Result<HashMap<String, u64>, String> {
    let rows = tauri::async_runtime::block_on(async {
        sqlx::query("SELECT program_id, seconds FROM work_tracker_daily WHERE work_date = ?1")
            .bind(date)
            .fetch_all(pool)
            .await
    })
    .map_err(|error| format!("당일 작업시간을 읽지 못했습니다: {error}"))?;
    let mut values = HashMap::new();
    for row in rows {
        let program_id: String = row.get("program_id");
        let seconds: i64 = row.get("seconds");
        values.insert(program_id, seconds.max(0) as u64 * 1000);
    }
    for ((program_id, work_date), millis) in pending_ms {
        if work_date == date {
            *values.entry(program_id.clone()).or_default() += *millis;
        }
    }
    Ok(values)
}

fn pending_seconds_for_date(
    pending_ms: &HashMap<(String, String), u64>,
    date: &str,
) -> HashMap<String, u64> {
    pending_ms
        .iter()
        .filter(|((_, work_date), _)| work_date == date)
        .map(|((program_id, _), millis)| (program_id.clone(), millis / 1000))
        .collect()
}

fn millis_map_to_seconds(values: &HashMap<String, u64>) -> HashMap<String, u64> {
    values
        .iter()
        .map(|(program_id, millis)| (program_id.clone(), millis / 1000))
        .collect()
}

fn flush_pending(
    pool: &Pool<Sqlite>,
    pending_ms: &mut HashMap<(String, String), u64>,
) -> Result<(), String> {
    let increments: Vec<_> = pending_ms
        .iter()
        .filter_map(|(key, millis)| {
            let seconds = millis / 1000;
            (seconds > 0).then(|| (key.clone(), seconds))
        })
        .collect();
    if increments.is_empty() {
        return Ok(());
    }
    let result = tauri::async_runtime::block_on(async {
        let mut transaction = pool.begin().await?;
        let updated_at_ms = epoch_ms();
        for ((program_id, work_date), seconds) in &increments {
            sqlx::query("INSERT INTO work_tracker_daily (program_id, work_date, seconds, updated_at_ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(program_id, work_date) DO UPDATE SET seconds = seconds + excluded.seconds, updated_at_ms = excluded.updated_at_ms")
                .bind(program_id)
                .bind(work_date)
                .bind(*seconds as i64)
                .bind(updated_at_ms)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await
    });
    result.map_err(|error| format!("작업시간을 저장하지 못했습니다: {error}"))?;
    for (key, seconds) in increments {
        if let Some(millis) = pending_ms.get_mut(&key) {
            *millis = millis.saturating_sub(seconds * 1000);
        }
    }
    pending_ms.retain(|_, millis| *millis > 0);
    Ok(())
}

fn set_error(status: &Arc<Mutex<TrackerStatus>>, error: Option<String>) {
    status
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .last_error = error;
}

fn epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn program_json(program: &ForegroundProgram) -> Value {
    json!({
        "executablePath": program.executable_path,
        "executableName": program.executable_name,
        "displayName": program.display_name
    })
}

fn inspect_program_path(raw_path: &str) -> Result<ForegroundProgram, String> {
    let path = Path::new(raw_path);
    if !path.is_absolute() || !path.is_file() {
        return Err("실행 파일을 찾을 수 없습니다.".into());
    }
    let executable_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "실행 파일 이름을 읽을 수 없습니다.".to_string())?
        .to_string();
    if !executable_name.to_ascii_lowercase().ends_with(".exe") {
        return Err("Windows 실행 파일(.exe)만 등록할 수 있습니다.".into());
    }
    let display_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(&executable_name)
        .to_string();
    Ok(ForegroundProgram {
        executable_path: raw_path.to_string(),
        executable_name,
        display_name,
    })
}

fn normalize_windows_path(path: &str) -> String {
    path.trim()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_lowercase()
}

fn normalize_executable_name(name: &str) -> String {
    name.trim().to_lowercase()
}

fn is_date_key(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

#[cfg(windows)]
fn current_foreground_program() -> Option<ForegroundProgram> {
    windows_api::current_foreground_program()
}

#[cfg(not(windows))]
fn current_foreground_program() -> Option<ForegroundProgram> {
    None
}

#[cfg(windows)]
fn running_programs() -> Result<Vec<ForegroundProgram>, String> {
    windows_api::running_programs()
}

#[cfg(not(windows))]
fn running_programs() -> Result<Vec<ForegroundProgram>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
fn system_idle_ms() -> Option<u64> {
    windows_api::system_idle_ms()
}

#[cfg(not(windows))]
fn system_idle_ms() -> Option<u64> {
    Some(IDLE_LIMIT_MS)
}

#[cfg(windows)]
fn local_date_key() -> String {
    windows_api::local_date_key()
}

#[cfg(not(windows))]
fn local_date_key() -> String {
    "1970-01-01".into()
}

#[cfg(windows)]
mod windows_api {
    use super::{normalize_windows_path, ForegroundProgram};
    use std::{collections::HashMap, ffi::c_void, mem::size_of, path::Path, ptr};

    type Handle = *mut c_void;
    type Hwnd = *mut c_void;

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const GW_OWNER: u32 = 4;

    #[repr(C)]
    struct LastInputInfo {
        cb_size: u32,
        dw_time: u32,
    }

    #[repr(C)]
    struct SystemTime {
        year: u16,
        month: u16,
        day_of_week: u16,
        day: u16,
        hour: u16,
        minute: u16,
        second: u16,
        milliseconds: u16,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetForegroundWindow() -> Hwnd;
        fn EnumWindows(
            callback: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>,
            l_param: isize,
        ) -> i32;
        fn IsWindowVisible(window: Hwnd) -> i32;
        fn GetWindow(window: Hwnd, command: u32) -> Hwnd;
        fn GetWindowTextLengthW(window: Hwnd) -> i32;
        fn GetWindowThreadProcessId(window: Hwnd, process_id: *mut u32) -> u32;
        fn GetLastInputInfo(info: *mut LastInputInfo) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            executable_name: *mut u16,
            size: *mut u32,
        ) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetTickCount() -> u32;
        fn GetLocalTime(system_time: *mut SystemTime);
    }

    fn program_for_pid(pid: u32) -> Option<ForegroundProgram> {
        unsafe {
            if pid == 0 {
                return None;
            }
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buffer = vec![0u16; 32_768];
            let mut size = buffer.len() as u32;
            let succeeded = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size);
            CloseHandle(process);
            if succeeded == 0 || size == 0 {
                return None;
            }
            let executable_path = String::from_utf16_lossy(&buffer[..size as usize]);
            let path = Path::new(&executable_path);
            let executable_name = path.file_name()?.to_string_lossy().into_owned();
            let display_name = path
                .file_stem()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| executable_name.clone());
            Some(ForegroundProgram {
                executable_path,
                executable_name,
                display_name,
            })
        }
    }

    pub(super) fn current_foreground_program() -> Option<ForegroundProgram> {
        unsafe {
            let window = GetForegroundWindow();
            if window.is_null() {
                return None;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(window, &mut pid);
            program_for_pid(pid)
        }
    }

    unsafe extern "system" fn collect_app_window(window: Hwnd, l_param: isize) -> i32 {
        if IsWindowVisible(window) == 0
            || !GetWindow(window, GW_OWNER).is_null()
            || GetWindowTextLengthW(window) <= 0
        {
            return 1;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(window, &mut pid);
        if let Some(program) = program_for_pid(pid) {
            let programs = &mut *(l_param as *mut HashMap<String, ForegroundProgram>);
            programs
                .entry(normalize_windows_path(&program.executable_path))
                .or_insert(program);
        }
        1
    }

    pub(super) fn running_programs() -> Result<Vec<ForegroundProgram>, String> {
        unsafe {
            let mut by_path: HashMap<String, ForegroundProgram> = HashMap::new();
            if EnumWindows(Some(collect_app_window), &mut by_path as *mut _ as isize) == 0 {
                return Err("현재 실행 중인 앱 목록을 읽지 못했습니다.".to_string());
            }
            let mut programs: Vec<_> = by_path.into_values().collect();
            programs.sort_by(|left, right| {
                left.display_name
                    .to_lowercase()
                    .cmp(&right.display_name.to_lowercase())
                    .then_with(|| {
                        left.executable_name
                            .to_lowercase()
                            .cmp(&right.executable_name.to_lowercase())
                    })
            });
            Ok(programs)
        }
    }

    pub(super) fn system_idle_ms() -> Option<u64> {
        unsafe {
            let mut info = LastInputInfo {
                cb_size: size_of::<LastInputInfo>() as u32,
                dw_time: 0,
            };
            if GetLastInputInfo(&mut info) == 0 {
                return None;
            }
            Some(GetTickCount().wrapping_sub(info.dw_time) as u64)
        }
    }

    pub(super) fn local_date_key() -> String {
        unsafe {
            let mut time: SystemTime = std::mem::zeroed();
            GetLocalTime(ptr::addr_of_mut!(time));
            format!("{:04}-{:02}-{:02}", time.year, time.month, time.day)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    #[test]
    fn windows_paths_are_compared_case_insensitively() {
        assert_eq!(
            normalize_windows_path(r"\\?\C:\Program Files\Editor\Editor.EXE"),
            normalize_windows_path(r"c:/program files/editor/editor.exe")
        );
    }

    #[test]
    fn pending_time_survives_database_reopen() {
        let path = std::env::temp_dir().join(format!(
            "hamboard-work-tracker-{}-{}.db",
            std::process::id(),
            epoch_ms()
        ));
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let pool = tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .unwrap();
            sqlx::query("CREATE TABLE work_tracker_daily (program_id TEXT NOT NULL, work_date TEXT NOT NULL, seconds INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY(program_id, work_date))")
                .execute(&pool)
                .await
                .unwrap();
            pool
        });
        let key = ("editor".to_string(), "2026-08-24".to_string());
        let mut pending = HashMap::from([(key.clone(), 2_450)]);
        flush_pending(&pool, &mut pending).unwrap();
        tauri::async_runtime::block_on(pool.close());
        let reopened = tauri::async_runtime::block_on(async {
            SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(SqliteConnectOptions::new().filename(&path))
                .await
                .unwrap()
        });
        let seconds: i64 = tauri::async_runtime::block_on(async {
            sqlx::query_scalar(
                "SELECT seconds FROM work_tracker_daily WHERE program_id = ?1 AND work_date = ?2",
            )
            .bind(&key.0)
            .bind(&key.1)
            .fetch_one(&reopened)
            .await
            .unwrap()
        });
        assert_eq!(seconds, 2);
        assert_eq!(pending.get(&key), Some(&450));
        tauri::async_runtime::block_on(reopened.close());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn idle_limit_is_fixed_at_ten_seconds() {
        assert_eq!(IDLE_LIMIT_MS, 10_000);
    }

    #[test]
    fn date_key_validation_is_strict() {
        assert!(is_date_key("2026-08-24"));
        assert!(!is_date_key("2026-8-24"));
        assert!(!is_date_key("2026/08/24"));
    }
}
