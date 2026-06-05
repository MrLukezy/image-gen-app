use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::Manager;

// ──────────────────────────── Shared State ────────────────────────────────

#[derive(Default)]
struct Inner {
    conversations: Vec<Conversation>,
    open_windows: Vec<String>,
}

struct AppState(Arc<Mutex<Inner>>);
impl Clone for AppState {
    fn clone(&self) -> Self { Self(self.0.clone()) }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Conversation {
    id: String,
    title: String,
    entries: Vec<ConvEntry>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConvEntry {
    id: String,
    #[serde(rename = "type")]
    entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
    timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_count: Option<u32>,
}

// ──────────────────────────── HTTP Client ─────────────────────────────────

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .connect_timeout(std::time::Duration::from_secs(15))
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .expect("Failed to build HTTP client")
});

async fn send_with_retry(
    request_builder: reqwest::RequestBuilder,
    max_retries: usize,
) -> Result<reqwest::Response, reqwest::Error> {
    let mut last_error = None;
    for attempt in 0..=max_retries {
        if attempt > 0 {
            let delay = std::time::Duration::from_secs(2u64.pow(attempt as u32).min(10));
            tokio::time::sleep(delay).await;
        }
        match request_builder.try_clone().unwrap().send().await {
            Ok(resp) => return Ok(resp),
            Err(e) if e.is_request() || e.is_connect() || e.is_timeout() => {
                last_error = Some(e);
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_error.unwrap())
}

// ──────────────────────────── API Types ───────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct GenRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_images: Option<Vec<String>>,
    size: String,
    n: u32,
    response_format: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GenResponse {
    status: Option<String>,
    result_url: Option<String>,
    fail_reason: Option<String>,
    progress: Option<String>,
    task_id: Option<String>,
    id: Option<serde_json::Value>,
    data: Option<Vec<ImageData>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ImageData {
    b64_json: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ImgResult {
    images: Vec<String>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelsResp {
    data: Option<Vec<ModelEntry>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ModelEntry {
    id: String,
}

// ──────────────────────────── Helpers ─────────────────────────────────────

fn extract_images(data: Vec<ImageData>) -> Vec<String> {
    data.into_iter()
        .filter_map(|item| {
            item.b64_json
                .map(|b64| format!("data:image/png;base64,{}", b64))
                .or(item.url)
        })
        .collect()
}

async fn generate_single(
    api_url: String,
    api_key: String,
    model: String,
    prompt: String,
    size: String,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> ImgResult {
    let payload = GenRequest {
        model: model.clone(),
        prompt: prompt.clone(),
        reference_images: reference_images.filter(|v| !v.is_empty()),
        size: size.clone(),
        n: 1,
        response_format: response_format.clone(),
    };

    let request = HTTP_CLIENT
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload);

    let resp = match send_with_retry(request, 2).await {
        Ok(r) => r,
        Err(e) => {
            let msg = if e.is_timeout() {
                "请求超时，请检查网络连接".to_string()
            } else if e.is_connect() {
                format!("无法连接到服务器: {}", e)
            } else {
                format!("请求失败: {}", e)
            };
            return ImgResult { images: vec![], error: Some(msg) };
        }
    };

    let status = resp.status();
    let body_text = match resp.text().await {
        Ok(t) => t,
        Err(e) => return ImgResult { images: vec![], error: Some(format!("读取响应失败: {}", e)) },
    };

    if !status.is_success() {
        return ImgResult { images: vec![], error: Some(format!("HTTP {}: {}", status, body_text)) };
    }

    let gen_resp: GenResponse = match serde_json::from_str(&body_text) {
        Ok(r) => r,
        Err(e) => {
            return ImgResult {
                images: vec![],
                error: Some(format!("解析响应失败: {} | body: {}", e, &body_text[..body_text.len().min(500)])),
            };
        }
    };

    if let Some(ref s) = gen_resp.status {
        if s == "FAILED" || s == "ERROR" {
            return ImgResult {
                images: vec![],
                error: Some(gen_resp.fail_reason.unwrap_or_else(|| body_text.clone())),
            };
        }
    }

    let mut images = Vec::new();

    if let Some(url) = gen_resp.result_url.filter(|u| !u.is_empty()) {
        images.push(url);
    }

    if images.is_empty() {
        if let Some(data_arr) = gen_resp.data {
            images = extract_images(data_arr);
        }
    }

    if images.is_empty() && gen_resp.task_id.is_some() {
        let task_id = gen_resp.task_id.unwrap();
        let poll_url = format!("{}/{}", api_url.trim_end_matches("/generations"), task_id);

        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            let poll_request = HTTP_CLIENT
                .get(&poll_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .timeout(std::time::Duration::from_secs(30));

            let poll_resp = match send_with_retry(poll_request, 2).await {
                Ok(r) => r,
                Err(e) => return ImgResult { images: vec![], error: Some(format!("轮询失败: {}", e)) },
            };

            let poll_text = match poll_resp.text().await {
                Ok(t) => t,
                Err(e) => return ImgResult { images: vec![], error: Some(format!("读取轮询响应失败: {}", e)) },
            };

            let poll_data: GenResponse = match serde_json::from_str(&poll_text) {
                Ok(d) => d,
                Err(e) => return ImgResult { images: vec![], error: Some(format!("解析轮询响应失败: {}", e)) },
            };

            if let Some(ref s) = poll_data.status {
                if s == "SUCCESS" {
                    if let Some(url) = poll_data.result_url.filter(|u| !u.is_empty()) {
                        images.push(url);
                        break;
                    }
                    if let Some(data_arr) = poll_data.data {
                        images = extract_images(data_arr);
                        break;
                    }
                } else if s == "FAILED" || s == "ERROR" {
                    return ImgResult {
                        images: vec![],
                        error: Some(poll_data.fail_reason.unwrap_or_else(|| "生成失败".to_string())),
                    };
                }
            }
        }

        if images.is_empty() {
            return ImgResult { images: vec![], error: Some("生成超时（5分钟），请稍后重试".to_string()) };
        }
    }

    ImgResult { images, error: None }
}

// ──────────────────────────── Commands ────────────────────────────────────

#[tauri::command]
fn window_close(window: tauri::Window) { let _ = window.close(); }

#[tauri::command]
fn window_minimize(window: tauri::Window) { let _ = window.minimize(); }

#[tauri::command]
fn window_maximize(window: tauri::Window) { let _ = window.maximize(); }

#[tauri::command]
async fn generate_image(
    prompt: String,
    api_key: String,
    api_url: String,
    model: String,
    size: String,
    n: u32,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> Result<ImgResult, String> {
    let payload = GenRequest {
        model: model.clone(),
        prompt: prompt.clone(),
        reference_images: reference_images.filter(|v| !v.is_empty()),
        size: size.clone(),
        n,
        response_format: response_format.clone(),
    };

    let request = HTTP_CLIENT
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload);

    let resp = send_with_retry(request, 2).await.map_err(|e| {
        if e.is_timeout() { "请求超时，请检查网络连接".to_string() }
        else if e.is_connect() { format!("无法连接到服务器: {}", e) }
        else { format!("请求失败: {}", e) }
    })?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Ok(ImgResult { images: vec![], error: Some(format!("HTTP {}: {}", status, body_text)) });
    }

    let gen_resp: GenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析响应失败: {} | body: {}", e, &body_text[..body_text.len().min(500)]))?;

    if let Some(ref s) = gen_resp.status {
        if s == "FAILED" || s == "ERROR" {
            return Ok(ImgResult {
                images: vec![],
                error: Some(gen_resp.fail_reason.unwrap_or_else(|| body_text.clone())),
            });
        }
    }

    let mut images = Vec::new();

    if let Some(url) = gen_resp.result_url.filter(|u| !u.is_empty()) {
        images.push(url);
    }

    if images.is_empty() {
        if let Some(data_arr) = gen_resp.data {
            images = extract_images(data_arr);
        }
    }

    if images.is_empty() && gen_resp.task_id.is_some() {
        let task_id = gen_resp.task_id.unwrap();
        let poll_url = format!("{}/{}", api_url.trim_end_matches("/generations"), task_id);

        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            let poll_request = HTTP_CLIENT
                .get(&poll_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .timeout(std::time::Duration::from_secs(30));

            let poll_resp = send_with_retry(poll_request, 2).await
                .map_err(|e| format!("轮询失败: {}", e))?;
            let poll_text = poll_resp.text().await.map_err(|e| format!("读取轮询响应失败: {}", e))?;
            let poll_data: GenResponse = serde_json::from_str(&poll_text)
                .map_err(|e| format!("解析轮询响应失败: {}", e))?;

            if let Some(ref s) = poll_data.status {
                if s == "SUCCESS" {
                    if let Some(url) = poll_data.result_url.filter(|u| !u.is_empty()) {
                        images.push(url);
                        break;
                    }
                    if let Some(data_arr) = poll_data.data {
                        images = extract_images(data_arr);
                        break;
                    }
                } else if s == "FAILED" || s == "ERROR" {
                    return Ok(ImgResult {
                        images: vec![],
                        error: Some(poll_data.fail_reason.unwrap_or_else(|| "生成失败".to_string())),
                    });
                }
            }
        }

        if images.is_empty() {
            return Ok(ImgResult { images: vec![], error: Some("生成超时（5分钟），请稍后重试".to_string()) });
        }
    }

    Ok(ImgResult { images, error: None })
}

#[tauri::command]
async fn generate_images_parallel(
    prompts: Vec<String>,
    api_key: String,
    api_url: String,
    model: String,
    size: String,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> Result<Vec<ImgResult>, String> {
    let mut handles = Vec::new();
    for prompt in prompts {
        let api_key = api_key.clone();
        let api_url = api_url.clone();
        let model = model.clone();
        let size = size.clone();
        let ref_imgs = reference_images.clone();
        let rf = response_format.clone();
        handles.push(tokio::spawn(async move {
            generate_single(api_url, api_key, model, prompt, size, ref_imgs, rf).await
        }));
    }
    let mut results = Vec::new();
    for h in handles {
        results.push(h.await.unwrap_or(ImgResult {
            images: vec![],
            error: Some("任务执行失败".to_string()),
        }));
    }
    Ok(results)
}

#[tauri::command]
async fn fetch_models(api_key: String, api_url: String) -> Result<Vec<String>, String> {
    let base = if api_url.contains("/images/generations") {
        api_url.replace("/images/generations", "")
    } else if api_url.ends_with("/v1") {
        api_url
    } else {
        format!("{}/v1", api_url.trim_end_matches('/'))
    };
    let url = format!("{}/models", base);

    let resp = HTTP_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("获取模型列表失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("获取模型列表失败: HTTP {}", resp.status()));
    }

    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;
    let parsed: ModelsResp = serde_json::from_str(&body)
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let models: Vec<String> = parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|m| m.id)
        .collect();
    Ok(models)
}

// ──────────────────────────── Conversation Commands ──────────────────────

#[tauri::command]
fn create_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    title: String,
) -> String {
    let id = format!("{}{}", chrono_lite_timestamp(), rand_suffix());
    let mut inner = state.0.lock().unwrap();
    inner.conversations.push(Conversation {
        id: id.clone(),
        title,
        entries: vec![],
        created_at: now_ms(),
        updated_at: now_ms(),
    });
    save_conversations_to_disk(&app, &inner.conversations);
    id
}

#[tauri::command]
fn save_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    title: String,
    entries: Vec<ConvEntry>,
) {
    let mut inner = state.0.lock().unwrap();
    match inner.conversations.iter_mut().find(|c| c.id == conversation_id) {
        Some(c) => {
            c.title = title;
            c.entries = entries;
            c.updated_at = now_ms();
        }
        None => {
            inner.conversations.push(Conversation {
                id: conversation_id,
                title,
                entries,
                created_at: now_ms(),
                updated_at: now_ms(),
            });
        }
    }
    save_conversations_to_disk(&app, &inner.conversations);
}

#[tauri::command]
fn list_conversations(state: tauri::State<'_, AppState>) -> Vec<Conversation> {
    let inner = state.0.lock().unwrap();
    inner.conversations.clone()
}

#[tauri::command]
fn delete_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) {
    let mut inner = state.0.lock().unwrap();
    inner.conversations.retain(|c| c.id != conversation_id);
    save_conversations_to_disk(&app, &inner.conversations);
}

#[tauri::command]
fn rename_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    title: String,
) {
    let mut inner = state.0.lock().unwrap();
    if let Some(c) = inner.conversations.iter_mut().find(|c| c.id == conversation_id) {
        c.title = title;
        c.updated_at = now_ms();
    }
    save_conversations_to_disk(&app, &inner.conversations);
}

#[tauri::command]
fn save_open_windows(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    windows: Vec<String>,
) {
    let mut inner = state.0.lock().unwrap();
    inner.open_windows = windows.clone();
    save_open_windows_to_disk(&app, &windows);
}

#[tauri::command]
fn get_open_windows(state: tauri::State<'_, AppState>) -> Vec<String> {
    let inner = state.0.lock().unwrap();
    inner.open_windows.clone()
}

// ──────────────────────────── Window Commands ─────────────────────────────

#[tauri::command]
async fn open_conversation_in_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conv_id: String,
) -> Result<String, String> {
    let label = format!("conv_{}", &conv_id[..8.min(conv_id.len())]);
    let url = format!("/#?conv={}", conv_id);
    let builder = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title("AI Image Generator")
        .inner_size(900.0, 720.0)
        .resizable(true)
        .decorations(false);
    builder.build().map_err(|e| format!("创建窗口失败: {}", e))?;

    let mut inner = state.0.lock().unwrap();
    if !inner.open_windows.contains(&conv_id) {
        inner.open_windows.push(conv_id);
        save_open_windows_to_disk(&app, &inner.open_windows);
    }
    Ok(label)
}

// ──────────────────────────── Utils ───────────────────────────────────────

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn chrono_lite_timestamp() -> String {
    format!("{}", now_ms())
}

fn rand_suffix() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::time::SystemTime::now().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    format!("{:x}", h.finish())
}

fn get_conversations_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p: std::path::PathBuf| p.join("conversations.json"))
}

fn load_conversations_from_disk(app: &tauri::AppHandle) -> Vec<Conversation> {
    let path = match get_conversations_path(app) {
        Some(p) => p,
        None => return vec![],
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save_conversations_to_disk(app: &tauri::AppHandle, convs: &[Conversation]) {
    let path = match get_conversations_path(app) {
        Some(p) => p,
        None => return,
    };
    if let Ok(json) = serde_json::to_string_pretty(convs) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, json);
    }
}

fn save_open_windows_to_disk(app: &tauri::AppHandle, windows: &[String]) {
    let path = match get_conversations_path(app) {
        Some(p) => p.with_file_name("open_windows.json"),
        None => return,
    };
    if let Ok(json) = serde_json::to_string(windows) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, json);
    }
}

fn load_open_windows_from_disk(app: &tauri::AppHandle) -> Vec<String> {
    let path = match get_conversations_path(app) {
        Some(p) => p.with_file_name("open_windows.json"),
        None => return vec![],
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

// ──────────────────────────── Main ────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-features=TrackingPrevention");
    std::env::set_var("WEBVIEW2_TRACKING_PREVENTION", "0");

    tauri::Builder::default()
        .manage(AppState(Arc::new(Mutex::new(Inner::default()))))
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>().inner().clone();

            let saved_convs = load_conversations_from_disk(&app_handle);
            let saved_windows = load_open_windows_from_disk(&app_handle);

            {
                let mut inner = state.0.lock().unwrap();
                inner.conversations = saved_convs;
                inner.open_windows = saved_windows;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_image,
            generate_images_parallel,
            fetch_models,
            create_conversation,
            save_conversation,
            list_conversations,
            delete_conversation,
            rename_conversation,
            save_open_windows,
            get_open_windows,
            open_conversation_in_window,
            window_close,
            window_minimize,
            window_maximize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
