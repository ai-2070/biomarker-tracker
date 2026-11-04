#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

mod updater;

// A stable origin preserves the IndexedDB working copy between launches.
const ORIGIN: &str = "http://127.0.0.1:4821";
/// The main window's label.
pub(crate) const MAIN: &str = "main";

#[derive(Default)]
struct ServerProcess {
    child: Mutex<Option<CommandChild>>,
    stopped: Mutex<Option<mpsc::Receiver<()>>>,
    closing: AtomicBool,
}

impl ServerProcess {
    fn stop(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.write(b"shutdown\n");
            if let Some(stopped) = self.stopped.lock().unwrap().take() {
                let _ = stopped.recv_timeout(Duration::from_secs(5));
            }
            // Also clears any remaining MCP/agent descendants in the process group.
            let _ = child.kill();
        }
    }
}

fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    let data = match std::env::var_os("BT_DATA") {
        Some(directory) => std::path::PathBuf::from(directory),
        None => app.path().app_local_data_dir()?,
    };
    std::fs::create_dir_all(&data)?;
    Ok(data)
}

/// Starts the local server and waits until it is ready. Also used again after a failed update install.
pub(crate) fn start_server(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data = data_dir(app)?;
    let resources = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
    } else {
        app.path().resource_dir()?
    };
    let (mut events, child) = app
        .shell()
        .sidecar("biomarker-server")?
        .env("BT_ROOT", &resources)
        .env("BT_DIST", resources.join("dist"))
        .env("BT_DATA", &data)
        .env("BT_DESKTOP", "1")
        .args(["--port", "4821"])
        .set_process_group(true)
        .kill_on_drop(true)
        .spawn()?;
    let state = app.state::<ServerProcess>();
    state.closing.store(false, Ordering::SeqCst);
    *state.child.lock().unwrap() = Some(child);
    let (ready_tx, ready_rx) = mpsc::channel();
    let (stopped_tx, stopped_rx) = mpsc::channel();
    *state.stopped.lock().unwrap() = Some(stopped_rx);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ready = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    if String::from_utf8_lossy(&line).trim() == format!("BT_READY {ORIGIN}") {
                        ready = true;
                        let _ = ready_tx.send(());
                    }
                }
                CommandEvent::Stderr(line) => eprintln!("{}", String::from_utf8_lossy(&line)),
                CommandEvent::Terminated(_) => break,
                _ => {}
            }
        }
        let _ = stopped_tx.send(());
        if ready
            && !handle
                .state::<ServerProcess>()
                .closing
                .load(Ordering::SeqCst)
        {
            handle.dialog().message("The local server stopped. Close and reopen Biomarker Tracker to continue. Your saved profiles are kept on disk.")
                .title("Biomarker Tracker").blocking_show();
            handle.exit(1);
        }
    });
    // Readiness comes from our child, so an occupied port never loads another server.
    ready_rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|_| {
            std::io::Error::other(
                "The local server could not start. Another program may be using port 4821.",
            )
        })?;
    Ok(())
}

/// Stops the local server (and what it started) on purpose: not reported as a crash.
pub(crate) fn stop_server(app: &AppHandle) {
    app.state::<ServerProcess>().stop();
}

fn start(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let data = data_dir(app.handle())?;
    start_server(app.handle())?;

    let navigation = app.handle().clone();
    let new_window = app.handle().clone();
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::External(ORIGIN.parse()?))
        .title("Biomarker Tracker")
        .inner_size(1280.0, 850.0)
        .min_inner_size(760.0, 600.0)
        .center()
        .data_directory(data.join("webview"))
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if url.origin().ascii_serialization() == ORIGIN {
                return true;
            }
            if matches!(url.scheme(), "http" | "https") {
                let _ = navigation.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_new_window(move |url, _| {
            if matches!(url.scheme(), "http" | "https") {
                let _ = new_window.opener().open_url(url.as_str(), None::<&str>);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    updater::start(app.handle());
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window(MAIN) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(ServerProcess::default())
        .setup(|app| {
            if let Err(error) = start(app) {
                app.state::<ServerProcess>().stop();
                app.dialog()
                    .message(error.to_string())
                    .title("Biomarker Tracker could not start")
                    .blocking_show();
                return Err(error);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize Biomarker Tracker")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app.state::<ServerProcess>().stop();
            }
        });
}
