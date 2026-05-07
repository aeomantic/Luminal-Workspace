use futures_util::StreamExt;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::Emitter;

// ── PTY state ─────────────────────────────────────────────────────────────────

struct PtyHandles {
    writer: Option<Box<dyn Write + Send>>,
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
    _slave: Option<Box<dyn portable_pty::SlavePty + Send>>,
    _child: Option<Box<dyn portable_pty::Child + Send>>,
}

pub struct AppState {
    pty: Mutex<PtyHandles>,
}

// ── PTY commands ──────────────────────────────────────────────────────────────

#[tauri::command]
fn pty_create(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell: &str = if cfg!(target_os = "windows") {
        "powershell.exe"
    } else if std::path::Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };

    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child      = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let writer     = pair.master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    {
        let mut pty = state.pty.lock().map_err(|e| e.to_string())?;
        pty.writer  = Some(writer);
        pty.master  = Some(pair.master);
        pty._slave  = Some(pair.slave);
        pty._child  = Some(child);
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => { app_handle.emit("pty-output", String::from_utf8_lossy(&buf[..n]).to_string()).ok(); }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn pty_write(state: tauri::State<AppState>, data: String) -> Result<(), String> {
    let mut pty = state.pty.lock().map_err(|e| e.to_string())?;
    if let Some(w) = pty.writer.as_mut() { w.write_all(data.as_bytes()).map_err(|e| e.to_string())? }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: tauri::State<AppState>, cols: u16, rows: u16) -> Result<(), String> {
    let pty = state.pty.lock().map_err(|e| e.to_string())?;
    if let Some(m) = pty.master.as_ref() {
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_close(state: tauri::State<AppState>) -> Result<(), String> {
    let mut pty = state.pty.lock().map_err(|e| e.to_string())?;
    pty.writer = None; pty.master = None; pty._slave = None; pty._child = None;
    Ok(())
}

// ── AI config helpers ─────────────────────────────────────────────────────────

fn config_path() -> Result<std::path::PathBuf, String> {
    dirs::home_dir()
        .ok_or_else(|| "Cannot find home directory".to_string())
        .map(|h| h.join(".luminal").join("config.json"))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AiConfig {
    provider: String,
    api_key:  String,
    model:    String,
}

fn read_ai_config() -> Result<AiConfig, String> {
    let path = config_path()?;
    if !path.exists() { return Err("No config".to_string()); }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn write_ai_config(cfg: &AiConfig) -> Result<(), String> {
    let path = config_path()?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

// ── AI commands ───────────────────────────────────────────────────────────────

#[tauri::command]
fn ai_has_key() -> bool { read_ai_config().is_ok() }

#[derive(serde::Serialize)]
struct AiConfigPublic { provider: String, model: String }

#[tauri::command]
fn ai_get_config() -> Option<AiConfigPublic> {
    read_ai_config().ok().map(|c| AiConfigPublic { provider: c.provider, model: c.model })
}

#[tauri::command]
fn ai_set_config(provider: String, api_key: String, model: String) -> Result<(), String> {
    write_ai_config(&AiConfig { provider, api_key, model })
}

#[derive(serde::Deserialize)]
struct ChatMessage { role: String, content: String }

/// Stream AI responses. Routes to Anthropic or the OpenAI-compatible endpoint
/// (OpenAI / Groq / GitHub Models) based on the stored provider config.
#[tauri::command]
async fn ai_chat(
    app: tauri::AppHandle,
    messages: Vec<ChatMessage>,
    context: Option<String>,
) -> Result<(), String> {
    let cfg = read_ai_config()?;

    let system = match context.as_deref() {
        Some(ctx) if !ctx.trim().is_empty() =>
            format!("You are a helpful coding assistant.\n\nCode context:\n```\n{}\n```", ctx),
        _ =>
            "You are a helpful coding assistant. Answer concisely and accurately.".to_string(),
    };

    let api_messages: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();

    match cfg.provider.as_str() {
        "anthropic" => stream_anthropic(&app, &cfg.api_key, &cfg.model, &api_messages, &system).await,
        "openai"    => stream_openai_compat(&app, "https://api.openai.com/v1/chat/completions",              &cfg.api_key, &cfg.model, &api_messages, &system).await,
        "groq"      => stream_openai_compat(&app, "https://api.groq.com/openai/v1/chat/completions",         &cfg.api_key, &cfg.model, &api_messages, &system).await,
        "github"    => stream_openai_compat(&app, "https://models.inference.ai.azure.com/chat/completions",  &cfg.api_key, &cfg.model, &api_messages, &system).await,
        other       => Err(format!("Unknown provider: {}", other)),
    }
}

// ── Streaming implementations ─────────────────────────────────────────────────

async fn stream_anthropic(
    app: &tauri::AppHandle,
    key: &str,
    model: &str,
    messages: &[serde_json::Value],
    system: &str,
) -> Result<(), String> {
    let body = serde_json::json!({
        "model": model, "max_tokens": 4096, "stream": true,
        "system": system, "messages": messages,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Anthropic API error {}: {}", status, resp.text().await.unwrap_or_default()));
    }

    drain_sse(app, resp, |json| {
        if json["type"] == "content_block_delta" && json["delta"]["type"] == "text_delta" {
            json["delta"]["text"].as_str().map(|s| s.to_string())
        } else { None }
    }).await
}

async fn stream_openai_compat(
    app: &tauri::AppHandle,
    url: &str,
    key: &str,
    model: &str,
    messages: &[serde_json::Value],
    system: &str,
) -> Result<(), String> {
    let mut msgs = vec![serde_json::json!({"role":"system","content": system})];
    msgs.extend_from_slice(messages);

    let body = serde_json::json!({
        "model": model, "stream": true, "max_tokens": 4096, "messages": msgs,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(url)
        .header("Authorization", format!("Bearer {}", key))
        .header("content-type", "application/json")
        .json(&body)
        .send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("API error {}: {}", status, resp.text().await.unwrap_or_default()));
    }

    drain_sse(app, resp, |json| {
        json["choices"][0]["delta"]["content"].as_str().map(|s| s.to_string())
    }).await
}

/// Read an SSE response, extract text chunks via `extractor`, emit `ai-stream` events.
async fn drain_sse(
    app: &tauri::AppHandle,
    resp: reqwest::Response,
    extractor: impl Fn(&serde_json::Value) -> Option<String>,
) -> Result<(), String> {
    let mut stream = resp.bytes_stream();
    let mut buf    = String::new();

    while let Some(chunk) = stream.next().await {
        buf.push_str(&String::from_utf8_lossy(&chunk.map_err(|e| e.to_string())?));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim_end_matches('\r').to_string();
            buf = buf[pos + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" { break; }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(text) = extractor(&json) {
                        app.emit("ai-stream", text).ok();
                    }
                }
            }
        }
    }

    app.emit("ai-stream-done", ()).ok();
    Ok(())
}

// ── Git helpers ───────────────────────────────────────────────────────────────

fn git_run(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .args(args).current_dir(repo_path).output()
        .map_err(|e| format!("git not found: {}", e))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(serde::Serialize)]
struct GitFile { path: String, status: String }

#[derive(serde::Serialize)]
struct GitStatus { branch: String, staged: Vec<GitFile>, unstaged: Vec<GitFile>, untracked: Vec<GitFile> }

#[tauri::command]
fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let branch = git_run(&repo_path, &["branch", "--show-current"])
        .unwrap_or_else(|_| "HEAD\n".to_string()).trim().to_string();
    let porcelain = git_run(&repo_path, &["status", "--porcelain"])?;

    let mut staged = Vec::new(); let mut unstaged = Vec::new(); let mut untracked = Vec::new();
    for line in porcelain.lines() {
        if line.len() < 3 { continue; }
        let x = line.chars().next().unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let path = line[3..].to_string();
        if x == '?' && y == '?' { untracked.push(GitFile { path, status: "?".to_string() }); }
        else {
            if x != ' ' { staged.push(GitFile { path: path.clone(), status: x.to_string() }); }
            if y != ' ' { unstaged.push(GitFile { path: path.clone(), status: y.to_string() }); }
        }
    }
    Ok(GitStatus { branch, staged, unstaged, untracked })
}

#[tauri::command]
fn git_stage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let out = std::process::Command::new("git").args(["add","--"]).args(&paths).current_dir(&repo_path)
        .output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).trim().to_string()); }
    Ok(())
}

#[tauri::command]
fn git_unstage(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    let out = std::process::Command::new("git").args(["restore","--staged","--"]).args(&paths).current_dir(&repo_path)
        .output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let out2 = std::process::Command::new("git").args(["reset","HEAD","--"]).args(&paths).current_dir(&repo_path)
            .output().map_err(|e| e.to_string())?;
        if !out2.status.success() { return Err(String::from_utf8_lossy(&out2.stderr).trim().to_string()); }
    }
    Ok(())
}

#[tauri::command]
fn git_commit(repo_path: String, message: String) -> Result<(), String> { git_run(&repo_path, &["commit","-m",&message])?; Ok(()) }

#[tauri::command]
fn git_push(repo_path: String) -> Result<(), String> { git_run(&repo_path, &["push"])?; Ok(()) }

#[tauri::command]
fn git_pull(repo_path: String) -> Result<(), String> { git_run(&repo_path, &["pull"])?; Ok(()) }

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            pty: Mutex::new(PtyHandles { writer: None, master: None, _slave: None, _child: None }),
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty_create, pty_write, pty_resize, pty_close,
            ai_has_key, ai_get_config, ai_set_config, ai_chat,
            git_status, git_stage, git_unstage, git_commit, git_push, git_pull,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
