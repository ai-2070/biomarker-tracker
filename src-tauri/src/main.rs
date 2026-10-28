// Blacksite desktop app. It starts the dashboard's own server (the bundled Bun runtime running
// the bundled server in resources/app), waits for it, and shows it in a window. Nothing else changes:
// the page talks to its server over 127.0.0.1 exactly as it does in a browser, with no Tauri IPC.
//
// Closing the window hides it to the tray (tray.rs); quitting from the tray closes the server's
// stdin, which tells the server to stop (see server/index.ts).
// Updates are looked for and installed from here too (updater.rs).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod updater;

use std::fs::{self, File};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

const MAIN: &str = "main";
/// Far from the browser version's 4800, so the app and a dev server can run side by side. Try the
/// same port each time: X and Reddit sign-in only work at the callback address set up in their apps.
const PREFERRED_PORTS: std::ops::Range<u16> = 14800..14810;
const START_TIMEOUT: Duration = Duration::from_secs(90);
const COULD_NOT_START: &str = "Blacksite could not start";

#[derive(Default)]
struct Server {
    child: Mutex<Option<Child>>,
    port: AtomicU16,
    /// Bumped on every start and stop, so a watcher of an old server stays quiet.
    generation: AtomicU64,
    /// Held while the server is restarted, so two restarts can't each start a server.
    restarting: Mutex<()>,
}

fn main() {
    let app = tauri::Builder::default()
        // a second launch focuses the open window instead of starting a second server
        // (also how to get the window back on a system with no tray)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_window(app)
        }))
        // not whether it was visible: quitting from the tray while it is hidden must not open it hidden
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Server::default())
        .on_window_event(tray::on_window_event)
        .setup(|app| {
            let handle = app.handle().clone();
            build_window(&handle)?;
            tray::start(&handle);
            start_server(&handle);
            updater::start(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Blacksite");

    app.run(|app, event| match event {
        RunEvent::ExitRequested { .. } => tray::quitting(),
        RunEvent::Exit => stop_server(app),
        // clicking the Dock icon while the window is hidden
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => tray::show_window(app),
        _ => {}
    });
}

// ---------- the window ----------

fn build_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let nav_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Blacksite")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .on_navigation(move |url| on_navigation(&nav_app, url))
        // links that open a new tab (target=_blank, window.open) go to the default browser
        .on_new_window(move |url, _features| {
            open_outside(&popup_app, &url);
            NewWindowResponse::Deny
        })
        .on_download(|webview, event| {
            // macOS and Linux show nothing while downloading: show the file when it is done
            #[cfg(not(windows))]
            if let tauri::webview::DownloadEvent::Finished {
                path: Some(path),
                success: true,
                ..
            } = &event
            {
                let _ = webview.app_handle().opener().reveal_item_in_dir(path);
            }
            #[cfg(windows)]
            let _ = (webview, event);
            true
        })
        .build()
}

/// The window only shows the dashboard and the start page. Anything else opens in the browser.
fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    if is_start_page(url) {
        // the start page's "Try again" button
        if url.query() == Some("restart") {
            let app = app.clone();
            thread::spawn(move || restart_server(&app));
        }
        return true;
    }
    if matches!(url.scheme(), "about" | "blob" | "data") {
        return true;
    }
    let port = app.state::<Server>().port.load(Ordering::SeqCst);
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if url.scheme() == "http" && local && url.port() == Some(port) {
        return true;
    }
    open_outside(app, url);
    false
}

fn is_start_page(url: &Url) -> bool {
    // how Tauri serves the files in src-tauri/loading: tauri://localhost, or http://tauri.localhost on Windows
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

fn open_outside(app: &AppHandle, url: &Url) {
    // only web and mail links: never file: or other schemes that could run something
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Puts the start page back with an error and the log's location.
fn show_error(app: &AppHandle, title: &str, message: &str) {
    let log = log_file(app).map(|p| p.display().to_string()).unwrap_or_default();
    show_start_page(app, serde_json::json!({ "title": title, "error": message, "log": log }));
    // the window may be hidden in the tray: don't let the server stop without anyone seeing it
    tray::show_window(app);
}

/// Puts the start page back with a message, while the app works (installing an update).
fn show_message(app: &AppHandle, title: &str, text: &str) {
    show_start_page(app, serde_json::json!({ "title": title, "text": text }));
}

fn show_start_page(app: &AppHandle, info: serde_json::Value) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    // the page decodes it once (decodeURIComponent): a bare % in a path would make that throw
    let payload = encode_uri_component(&info.to_string());
    let base = if cfg!(windows) {
        "http://tauri.localhost/index.html"
    } else {
        "tauri://localhost/index.html"
    };
    if let Ok(mut url) = Url::parse(base) {
        url.set_fragment(Some(&payload));
        let _ = w.navigate(url);
    }
}

/// Like the page's encodeURIComponent: everything but letters, digits and -_.!~*'() as %XX.
fn encode_uri_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ---------- the server ----------

/// The start page's "Try again": a click while a restart is still going does nothing.
fn restart_server(app: &AppHandle) {
    let state = app.state::<Server>();
    let Ok(_restarting) = state.restarting.try_lock() else {
        return;
    };
    stop_server(app);
    start_server(app);
}

fn start_server(app: &AppHandle) {
    let state = app.state::<Server>();
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let port = pick_port();
    state.port.store(port, Ordering::SeqCst);

    let child = match spawn_server(app, port) {
        Ok(c) => c,
        Err(e) => {
            return show_error(
                app,
                COULD_NOT_START,
                &format!("The dashboard's server could not start: {e}"),
            )
        }
    };
    // a server still in the slot would be left running with nothing to stop it
    if let Some(mut old) = state.child.lock().unwrap().replace(child) {
        let _ = old.kill();
        let _ = old.wait();
    }

    let app = app.clone();
    thread::spawn(move || watch_server(app, generation, port));
}

fn spawn_server(app: &AppHandle, port: u16) -> Result<Child, String> {
    let paths = app.path();
    let app_dir = paths.resource_dir().map_err(|e| e.to_string())?.join("app");
    let script = app_dir.join("server").join("index.js");
    if !script.exists() {
        return Err(format!("{} is missing. Reinstall the app.", script.display()));
    }
    let bun = sidecar("bun")?;
    // where chats, agents, keys and settings live; set DASH_DATA to use another folder
    let data = match std::env::var_os("DASH_DATA") {
        // made whole here: it is also the server's working folder, where a relative one would be read again
        Some(d) => std::path::absolute(PathBuf::from(d)).map_err(|e| e.to_string())?,
        None => paths.app_data_dir().map_err(|e| e.to_string())?.join("data"),
    };
    fs::create_dir_all(&data).map_err(|e| format!("could not create {}: {e}", data.display()))?;

    let log = log_file(app).ok_or("no folder for the log")?;
    if let Some(dir) = log.parent() {
        let _ = fs::create_dir_all(dir);
    }
    // keep the last run's log next to this one
    let _ = fs::rename(&log, log.with_extension("old.log"));
    let out = File::create(&log).map_err(|e| format!("could not write {}: {e}", log.display()))?;
    let err = out.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&bun);
    cmd.arg(&script)
        .args(["--port", &port.to_string(), "--no-open"])
        .current_dir(&data)
        .env("DASH_DATA", &data)
        .env("DASH_DESKTOP", "1")
        .stdin(Stdio::piped())
        .stdout(out)
        .stderr(err);
    if let Some(path) = full_path() {
        cmd.env("PATH", path);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("could not run {}: {e}", bun.display()))
}

/// Waits until the server answers, shows it, then reports if it stops on its own.
fn watch_server(app: AppHandle, generation: u64, port: u16) {
    let state = app.state::<Server>();
    let current = || state.generation.load(Ordering::SeqCst) == generation;
    let exited = || -> Option<String> {
        let mut guard = state.child.lock().unwrap();
        match guard.as_mut().map(|c| c.try_wait()) {
            Some(Ok(Some(status))) => Some(status.to_string()),
            Some(Err(e)) => Some(e.to_string()),
            _ => None,
        }
    };
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let started = Instant::now();
    loop {
        if !current() {
            return;
        }
        if let Some(status) = exited() {
            return show_error(
                &app,
                COULD_NOT_START,
                &format!("The dashboard's server stopped while starting ({status})."),
            );
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            break;
        }
        if started.elapsed() > START_TIMEOUT {
            return show_error(&app, COULD_NOT_START, "The dashboard's server did not start in time.");
        }
        thread::sleep(Duration::from_millis(150));
    }
    if let (Some(w), Ok(url)) = (
        app.get_webview_window(MAIN),
        Url::parse(&format!("http://localhost:{port}/")),
    ) {
        let _ = w.navigate(url);
    }
    loop {
        thread::sleep(Duration::from_millis(1000));
        if !current() {
            return;
        }
        if let Some(status) = exited() {
            return show_error(
                &app,
                "Blacksite stopped",
                &format!("The dashboard's server stopped ({status})."),
            );
        }
    }
}

fn stop_server(app: &AppHandle) {
    let state = app.state::<Server>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    let Some(mut child) = state.child.lock().unwrap().take() else {
        return;
    };
    // closing stdin asks it to stop cleanly (it closes its terminals); give it a moment
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn pick_port() -> u16 {
    PREFERRED_PORTS
        .clone()
        .find(|p| TcpListener::bind((Ipv4Addr::LOCALHOST, *p)).is_ok())
        .or_else(|| {
            TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .and_then(|l| l.local_addr())
                .map(|a| a.port())
                .ok()
        })
        .unwrap_or(PREFERRED_PORTS.start)
}

/// Tauri puts sidecars (externalBin) next to the app's own executable.
fn sidecar(name: &str) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("no folder for the app")?;
    let path = dir.join(format!("{name}{}", std::env::consts::EXE_SUFFIX));
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("{} is missing. Reinstall the app.", path.display()))
    }
}

fn log_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|d| d.join("server.log"))
}

/// The PATH that agents' CLIs (claude, codex, gh, ...) are found on.
///
/// Apps started from the Dock, Finder or a Linux app menu get a short PATH without the folders a
/// terminal adds (Homebrew, ~/.local/bin, ~/.bun/bin...), so ask the login shell for its PATH.
#[cfg(unix)]
fn full_path() -> Option<std::ffi::OsString> {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = login_shell_path()
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut extra: Vec<PathBuf> = vec!["/opt/homebrew/bin".into(), "/usr/local/bin".into()];
    if let Some(h) = &home {
        for d in [".local/bin", ".bun/bin", ".cargo/bin", ".npm-global/bin"] {
            extra.push(h.join(d));
        }
    }
    for d in std::env::split_paths(&current).chain(extra.into_iter().filter(|d| d.is_dir())) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    std::env::join_paths(dirs).ok()
}

#[cfg(not(unix))]
fn full_path() -> Option<std::ffi::OsString> {
    // Windows hands apps the user's full PATH
    None
}

#[cfg(unix)]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| std::path::Path::new(s).is_absolute())
        .unwrap_or_else(|| "/bin/sh".into());
    let (tx, rx) = std::sync::mpsc::channel();
    thread::spawn(move || {
        let out = Command::new(shell)
            .args(["-ilc", "printf '\\n__DASH_PATH__%s\\n' \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(out);
    });
    // a shell profile that waits for input must not hold up the app
    let out = rx.recv_timeout(Duration::from_secs(5)).ok()?.ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.strip_prefix("__DASH_PATH__"))
        .map(str::to_owned)
        .filter(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::encode_uri_component;

    #[test]
    fn start_page_payload_survives_one_decode() {
        // a % in a path must come out as %25, so the page's decodeURIComponent gives it back
        let encoded = encode_uri_component(r#"{"log":"C:\data 100%\server.log #1"}"#);
        assert!(encoded.contains("100%25"));
        assert!(!encoded.contains(['#', ' ', '"', '\\']));
        assert_eq!(encode_uri_component("a-b_c.d!e~f*g'h(i)"), "a-b_c.d!e~f*g'h(i)");
        assert_eq!(encode_uri_component("é"), "%C3%A9");
    }
}
