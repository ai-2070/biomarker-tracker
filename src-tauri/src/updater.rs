// Updates. A little after it opens, and then every few hours, the app asks GitHub whether a newer
// release is out (latest.json, made by .github/workflows/desktop.yml). When one is, it asks you before
// installing it, because installing restarts the app and its server. The question is a native dialog:
// the page has no part in it (there is no Tauri IPC).
//
// Updates are signed: the app only installs a download whose signature matches the public key in
// tauri.conf.json (plugins.updater.pubkey). docs/desktop.md says where the private key lives.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Not right at start: the server and the page come first.
const FIRST_CHECK: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const TITLE: &str = "Blacksite";

pub fn start(app: &AppHandle) {
    if let Some(why) = off_because() {
        return note(app, &format!("updates are off: {why}"));
    }
    let app = app.clone();
    thread::spawn(move || {
        // a version you said "Later" to isn't asked about again until the app opens next time
        let mut later: Option<String> = None;
        thread::sleep(FIRST_CHECK);
        loop {
            if let Err(e) = tauri::async_runtime::block_on(check(&app, &mut later)) {
                note(&app, &e);
            }
            thread::sleep(CHECK_EVERY);
        }
    });
}

fn off_because() -> Option<&'static str> {
    if cfg!(debug_assertions) {
        return Some("this is a development build");
    }
    if std::env::var_os("DASH_NO_UPDATES").is_some() {
        return Some("DASH_NO_UPDATES is set");
    }
    None
}

async fn check(app: &AppHandle, later: &mut Option<String>) -> Result<(), String> {
    let found = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("could not look for an update: {e}"))?;
    let Some(update) = found else { return Ok(()) };
    if later.as_deref() == Some(update.version.as_str()) {
        return Ok(());
    }
    note(
        app,
        &format!("found {} (this is {})", update.version, update.current_version),
    );
    if !ask(app, &update) {
        *later = Some(update.version.clone());
        return Ok(());
    }
    install(app, &update).await
}

fn ask(app: &AppHandle, update: &Update) -> bool {
    app.dialog()
        .message(format!(
            "Blacksite {} is ready to install. You have {}.\n\nInstalling it restarts the app. Agents that are working stop, and pick up again when you write to them.",
            update.version, update.current_version
        ))
        .title("Update Blacksite")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Install and restart".into(),
            "Later".into(),
        ))
        .blocking_show()
}

async fn install(app: &AppHandle, update: &Update) -> Result<(), String> {
    let window = app.get_webview_window(crate::MAIN);
    let title = |t: &str| {
        if let Some(w) = &window {
            let _ = w.set_title(t);
        }
    };
    // the dashboard keeps working while it downloads; the window's title shows how far it got
    let mut got: u64 = 0;
    let mut shown: Option<u64> = None;
    title(&format!("{TITLE} (downloading the update)"));
    let downloaded = update
        .download(
            |chunk, total| {
                got += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (got * 100 / total).min(100);
                    if shown != Some(percent) {
                        shown = Some(percent);
                        title(&format!("{TITLE} (downloading the update: {percent}%)"));
                    }
                }
            },
            || {},
        )
        .await;
    let bytes = match downloaded {
        Ok(b) => b,
        Err(e) => {
            title(TITLE);
            tell(
                app,
                "The update could not be downloaded",
                &format!("{e}\n\nBlacksite will try again later."),
            );
            return Err(format!("download failed: {e}"));
        }
    };

    // The server runs from the app's own folder, which the update replaces (and on Windows the
    // installer can't replace a bun.exe that is running): stop it first.
    crate::show_message(app, "Installing the update…", "Blacksite opens again in a moment.");
    // no "Try again" restart may start a server while the update replaces its files
    let server = app.state::<crate::Server>();
    let restarting = server.restarting.lock().unwrap_or_else(|e| e.into_inner());
    crate::stop_server(app);
    if let Err(e) = update.install(&bytes) {
        title(TITLE);
        crate::start_server(app);
        drop(restarting);
        tell(
            app,
            "The update could not be installed",
            &format!("{e}\n\nBlacksite keeps running the version you have."),
        );
        return Err(format!("install failed: {e}"));
    }
    // (on Windows the app has already quit: the installer opens it again when it is done)
    note(app, &format!("installed {}, restarting", update.version));
    app.request_restart();
    Ok(())
}

fn tell(app: &AppHandle, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();
}

/// What the updater did, in updater.log next to the server's log (a window app has no console).
fn note(app: &AppHandle, line: &str) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = fs::create_dir_all(&dir);
    let file = dir.join("updater.log");
    // a few lines a day, but don't let it grow forever
    if fs::metadata(&file).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
        let _ = fs::rename(&file, file.with_extension("old.log"));
    }
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&file) {
        let _ = writeln!(f, "[{secs}] {line}");
    }
}
