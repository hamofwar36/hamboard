$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this check on Windows with Rust and the Tauri build prerequisites installed.' }
$nativeProject = Join-Path $PSScriptRoot '..\src-tauri'
Push-Location $nativeProject
try {
    cargo check --locked --all-targets
    if ($LASTEXITCODE -ne 0) { throw 'cargo check failed' }
    cargo test --locked --lib
    if ($LASTEXITCODE -ne 0) { throw 'cargo test failed' }
} finally {
    Pop-Location
}
