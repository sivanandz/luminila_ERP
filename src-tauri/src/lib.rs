#[cfg(desktop)]
use std::process::{Child, Command, Stdio};
#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
#[cfg(desktop)]
use std::sync::Mutex;
#[cfg(desktop)]
use std::time::Duration;
#[cfg(desktop)]
use tauri::{Emitter, Manager, RunEvent};
#[cfg(desktop)]
use tauri_plugin_shell::process::CommandChild;

#[cfg(desktop)]
static SIDECAR_RUNNING: AtomicBool = AtomicBool::new(false);

/// Ports the webview probes for PocketBase, in order. Must match
/// `autoDiscoverPocketBase()` in src/lib/pocketbase.ts.
#[cfg(desktop)]
const PB_PORTS: [u16; 3] = [8090, 8091, 8092];

/// Owns the PocketBase child process so the app can stop it on exit.
#[cfg(desktop)]
#[derive(Default)]
struct PocketBaseProcess {
    child: Mutex<Option<Child>>,
    port: AtomicU16,
}

/// Check if WPPConnect sidecar is healthy
#[cfg(desktop)]
async fn check_sidecar_health() -> bool {
    match reqwest::get("http://127.0.0.1:21465/health").await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Start the WPPConnect sidecar process
#[cfg(desktop)]
fn start_sidecar(app: &tauri::AppHandle) -> Result<CommandChild, String> {
    use tauri_plugin_shell::ShellExt;

    let sidecar = app
        .shell()
        .sidecar("wppconnect-server")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Log sidecar output in background
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[WPPConnect] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[WPPConnect] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[WPPConnect] Terminated with code: {:?}", payload.code);
                    SIDECAR_RUNNING.store(false, Ordering::SeqCst);
                }
                _ => {}
            }
        }
    });

    SIDECAR_RUNNING.store(true, Ordering::SeqCst);
    Ok(child)
}

/// Health monitoring loop - restarts sidecar if it crashes
#[cfg(desktop)]
async fn health_monitor_loop(app: tauri::AppHandle) {
    let mut consecutive_failures = 0;

    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;

        if !SIDECAR_RUNNING.load(Ordering::SeqCst) {
            // Sidecar not running, try to start it
            log::info!("Sidecar not running, attempting to start...");
            match start_sidecar(&app) {
                Ok(_) => {
                    log::info!("Sidecar started successfully");
                    consecutive_failures = 0;
                    let _ = app.emit("sidecar-status", "started");
                }
                Err(e) => {
                    log::error!("Failed to start sidecar: {}", e);
                    consecutive_failures += 1;
                    let _ = app.emit("sidecar-status", "error");
                }
            }
            continue;
        }

        // Check health
        if check_sidecar_health().await {
            consecutive_failures = 0;
            let _ = app.emit("sidecar-status", "healthy");
        } else {
            consecutive_failures += 1;
            log::warn!("Sidecar health check failed ({} consecutive)", consecutive_failures);

            if consecutive_failures >= 3 {
                log::error!("Sidecar appears to be dead, marking for restart");
                SIDECAR_RUNNING.store(false, Ordering::SeqCst);
                let _ = app.emit("sidecar-status", "restarting");
            }
        }
    }
}

// ===========================================================================
// PocketBase process supervision
//
// The app used to ship without a database: only the WhatsApp sidecar was
// bundled, so an installed build opened a UI that could not save anything.
// PocketBase is now a bundled resource, started on the first free port the
// webview already probes, and stopped when the app exits.
// ===========================================================================

#[cfg(desktop)]
async fn check_pocketbase_health(port: u16) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(900))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };

    match client
        .get(format!("http://127.0.0.1:{}/api/health", port))
        .send()
        .await
    {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

#[cfg(desktop)]
fn spawn_pocketbase(app: &tauri::AppHandle, port: u16) -> Result<Child, String> {
    use tauri::path::BaseDirectory;

    let exe_name = if cfg!(windows) { "pocketbase.exe" } else { "pocketbase" };
    let exe = app
        .path()
        .resolve(format!("pocketbase/{}", exe_name), BaseDirectory::Resource)
        .map_err(|e| format!("resolve PocketBase binary: {}", e))?;

    if !exe.exists() {
        return Err(format!(
            "PocketBase binary not found at {} (bundle it under src-tauri/resources/pocketbase)",
            exe.display()
        ));
    }

    let migrations = app
        .path()
        .resolve("pocketbase/pb_migrations", BaseDirectory::Resource)
        .map_err(|e| format!("resolve PocketBase migrations: {}", e))?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {}", e))?
        .join("pb_data");
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir: {}", e))?;

    let mut command = Command::new(&exe);
    command
        .arg("serve")
        .arg(format!("--http=127.0.0.1:{}", port))
        .arg(format!("--dir={}", data_dir.display()))
        .arg(format!("--migrationsDir={}", migrations.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|e| format!("spawn PocketBase: {}", e))
}

/// Reuse a healthy instance when one exists (the dev launcher starts one), and
/// otherwise start PocketBase on the first port the frontend will probe.
#[cfg(desktop)]
async fn ensure_pocketbase(app: tauri::AppHandle) {
    for port in PB_PORTS {
        if check_pocketbase_health(port).await {
            if let Some(state) = app.try_state::<PocketBaseProcess>() {
                state.port.store(port, Ordering::SeqCst);
            }
            log::info!("PocketBase already healthy on port {}", port);
            let _ = app.emit("pocketbase-status", "healthy");
            return;
        }
    }

    for port in PB_PORTS {
        match spawn_pocketbase(&app, port) {
            Ok(mut child) => {
                let mut healthy = false;
                for _ in 0..40 {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    if check_pocketbase_health(port).await {
                        healthy = true;
                        break;
                    }
                }

                if healthy {
                    if let Some(state) = app.try_state::<PocketBaseProcess>() {
                        state.port.store(port, Ordering::SeqCst);
                        if let Ok(mut slot) = state.child.lock() {
                            *slot = Some(child);
                        }
                    }
                    log::info!("PocketBase started on port {}", port);
                    let _ = app.emit("pocketbase-status", "started");
                    return;
                }

                log::warn!("PocketBase on port {} did not become healthy", port);
                let _ = child.kill();
            }
            Err(e) => log::warn!("PocketBase could not start on port {}: {}", port, e),
        }
    }

    log::error!("No usable PocketBase port; the app will run without a database");
    let _ = app.emit("pocketbase-status", "error");
}

#[cfg(desktop)]
async fn pocketbase_monitor_loop(app: tauri::AppHandle) {
    let mut failures = 0;

    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;

        let port = match app.try_state::<PocketBaseProcess>() {
            Some(state) => state.port.load(Ordering::SeqCst),
            None => continue,
        };
        if port == 0 {
            continue;
        }

        if check_pocketbase_health(port).await {
            failures = 0;
            continue;
        }

        failures += 1;
        log::warn!("PocketBase health check failed on port {} ({} consecutive)", port, failures);

        if failures >= 3 {
            if let Some(state) = app.try_state::<PocketBaseProcess>() {
                if let Ok(mut slot) = state.child.lock() {
                    if let Some(mut child) = slot.take() {
                        let _ = child.kill();
                    }
                }
                state.port.store(0, Ordering::SeqCst);
            }
            ensure_pocketbase(app.clone()).await;
            failures = 0;
        }
    }
}

#[cfg(desktop)]
fn stop_pocketbase(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<PocketBaseProcess>() {
        if let Ok(mut slot) = state.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
            }
        }
        state.port.store(0, Ordering::SeqCst);
    }
}

/// Tauri command to get sidecar status
#[tauri::command]
async fn get_sidecar_status() -> Result<serde_json::Value, String> {
    #[cfg(mobile)]
    return Ok(serde_json::json!({
        "running": false,
        "healthy": false,
        "is_mobile": true
    }));

    #[cfg(desktop)]
    {
        let is_running = SIDECAR_RUNNING.load(Ordering::SeqCst);
        let is_healthy = if is_running {
            check_sidecar_health().await
        } else {
            false
        };

        Ok(serde_json::json!({
            "running": is_running,
            "healthy": is_healthy
        }))
    }
}

/// Tauri command to restart sidecar
#[tauri::command]
async fn restart_sidecar(_app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(mobile)]
    return Ok("Sidecar is managed by host PC in mobile mode".to_string());

    #[cfg(desktop)]
    {
        SIDECAR_RUNNING.store(false, Ordering::SeqCst);

        // Give it a moment to stop
        tokio::time::sleep(Duration::from_secs(2)).await;

        match start_sidecar(&_app) {
            Ok(_) => Ok("Sidecar restarted".to_string()),
            Err(e) => Err(e),
        }
    }
}

/// Tauri command to report which PocketBase port the app is using, if any.
#[tauri::command]
async fn get_pocketbase_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(mobile)]
    return Ok(serde_json::json!({ "managed": false, "is_mobile": true }));

    #[cfg(desktop)]
    {
        let port = app
            .try_state::<PocketBaseProcess>()
            .map(|state| state.port.load(Ordering::SeqCst))
            .unwrap_or(0);

        Ok(serde_json::json!({
            "managed": true,
            "port": port,
            "healthy": if port == 0 { false } else { check_pocketbase_health(port).await }
        }))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init());

    #[cfg(desktop)]
    let builder = builder.manage(PocketBaseProcess::default());

    let app = builder
        .setup(|app| {
            // Setup logging
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(desktop)]
            {
                // Start sidecar on app launch
                let app_handle = app.handle().clone();
                match start_sidecar(&app_handle) {
                    Ok(_) => log::info!("WPPConnect sidecar started"),
                    Err(e) => log::warn!("Failed to start sidecar: {} (will retry)", e),
                }

                // Start health monitoring loop
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    health_monitor_loop(app_handle).await;
                });

                // Start PocketBase (or reuse the dev instance), then supervise it
                let pb_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    ensure_pocketbase(pb_handle).await;
                });

                let pb_monitor_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    pocketbase_monitor_loop(pb_monitor_handle).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_status,
            restart_sidecar,
            get_pocketbase_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(desktop)]
        if let RunEvent::Exit = event {
            stop_pocketbase(app_handle);
        }
        #[cfg(not(desktop))]
        let _ = (app_handle, event);
    });
}
