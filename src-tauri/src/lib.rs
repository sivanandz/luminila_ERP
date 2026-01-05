use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_shell::process::CommandChild;

static SIDECAR_RUNNING: AtomicBool = AtomicBool::new(false);

/// Check if WPPConnect sidecar is healthy
async fn check_sidecar_health() -> bool {
    match reqwest::get("http://127.0.0.1:21465/health").await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Start the WPPConnect sidecar process
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

/// Tauri command to get sidecar status
#[tauri::command]
async fn get_sidecar_status() -> Result<serde_json::Value, String> {
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

/// Tauri command to restart sidecar
#[tauri::command]
async fn restart_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    SIDECAR_RUNNING.store(false, Ordering::SeqCst);
    
    // Give it a moment to stop
    tokio::time::sleep(Duration::from_secs(2)).await;
    
    match start_sidecar(&app) {
        Ok(_) => Ok("Sidecar restarted".to_string()),
        Err(e) => Err(e),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Setup logging
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            
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
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_status,
            restart_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

