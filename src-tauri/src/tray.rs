// The tray icon. Closing the window hides it instead of quitting, so agents keep working and the
// server keeps running. The icon (or its "Open Blacksite" item) brings the window back, and
// "Quit Blacksite" really quits.
//
// If the tray icon can't be made, closing the window quits as before. (Some Linux desktops make
// it but never show it: there, opening the app again brings the window back.)

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};

static HAS_TRAY: AtomicBool = AtomicBool::new(false);
/// Set once the app is on its way out, so closing the window then isn't turned into hiding it.
static QUITTING: AtomicBool = AtomicBool::new(false);

const OPEN: &str = "open";
const QUIT: &str = "quit";

pub fn start(app: &AppHandle) {
    match build(app) {
        Ok(()) => HAS_TRAY.store(true, Ordering::SeqCst),
        Err(e) => eprintln!("no tray icon, closing the window quits: {e}"),
    }
}

fn build(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, OPEN, "Open Blacksite", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, QUIT, "Quit Blacksite", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Blacksite")
        .menu(&menu)
        // a left click opens the window; the menu is on the right click
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN => show_window(app),
            QUIT => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // (Linux sends no clicks, only the menu)
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Closing the main window hides it while there is a tray icon to bring it back.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == crate::MAIN && HAS_TRAY.load(Ordering::SeqCst) && !QUITTING.load(Ordering::SeqCst) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(crate::MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The app is quitting by some other way (the macOS menu, an update's restart).
pub fn quitting() {
    QUITTING.store(true, Ordering::SeqCst);
}

fn quit(app: &AppHandle) {
    quitting();
    // the server is stopped on RunEvent::Exit, in main.rs
    app.exit(0);
}
