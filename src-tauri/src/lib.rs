use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read as _;
use std::path::PathBuf;
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
#[serde(rename_all = "camelCase")]
struct Conversation {
    #[serde(default)]
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    entries: Vec<ConvEntry>,
    #[serde(default, alias = "created_at")]
    created_at: u64,
    #[serde(default, alias = "updated_at")]
    updated_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct TrashMeta {
    moved_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TrashItem {
    id: String,
    title: String,
    image_count: u32,
    created_at: u64,
    updated_at: u64,
    moved_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BatchTaskEntry {
    #[serde(default)]
    id: u32,
    #[serde(default)]
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConvEntry {
    #[serde(default)]
    id: String,
    #[serde(default, rename = "type")]
    entry_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ref_images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
    #[serde(default)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    context_image_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    batch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    batch_total: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    batch_images: Option<Vec<BatchTaskEntry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    batch_errors: Option<u32>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ModelEntry {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pricing: Option<ModelPricing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owned_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ModelPricing {
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub pricing: Option<String>,
    pub resolution: Option<String>,
}

fn is_image_model(id: &str) -> bool {
    let lower = id.to_lowercase();
    let image_keywords = [
        "image", "dall-e", "dalle", "gpt-image", "flux", "stable-diffusion",
        "sdxl", "midjourney", "kandinsky", "playground", "kolors", "cogview",
        "wan", "ideogram", "recraft", "black-forest-labs", "stability",
        "seedream", "jimeng", "qwen-image", "tongyi-wanxiang", "minimax-image",
    ];
    image_keywords.iter().any(|kw| lower.contains(kw))
}

fn detect_resolution(id: &str) -> Option<String> {
    let lower = id.to_lowercase();
    if lower.contains("4k") || lower.contains("2048") || lower.contains("ultra") || lower.contains("max") {
        Some("4K".to_string())
    } else if lower.contains("2k") || lower.contains("1024") || lower.contains("hd") || lower.contains("high") || lower.contains("pro") {
        Some("2K".to_string())
    } else {
        Some("1K".to_string())
    }
}

// ──────────────────────────── Disk Operations ─────────────────────────────

fn app_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

fn conv_dir(app: &tauri::AppHandle, conv_id: &str) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("conversations").join(conv_id))
}

fn images_dir(app: &tauri::AppHandle, conv_id: &str) -> Option<PathBuf> {
    conv_dir(app, conv_id).map(|p| p.join("images"))
}

fn trash_root(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("trash"))
}

fn trash_dir(app: &tauri::AppHandle, conv_id: &str) -> Option<PathBuf> {
    trash_root(app).map(|p| p.join(conv_id))
}

fn load_conversation(app: &tauri::AppHandle, conv_id: &str) -> Option<Conversation> {
    let path = conv_dir(app, conv_id)?.join("meta.json");
    if !path.exists() { return None; }
    let json = fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&json) {
        Ok(c) => Some(c),
        Err(err) => {
            eprintln!("[conv] Failed to parse {}: {}", conv_id, err);
            Some(Conversation {
                id: conv_id.to_string(),
                title: format!("[加载失败] {}", conv_id),
                entries: vec![],
                created_at: 0,
                updated_at: 0,
            })
        }
    }
}

fn load_all_conversations(app: &tauri::AppHandle) -> Vec<Conversation> {
    let base = match app_data_dir(app) {
        Some(p) => p.join("conversations"),
        None => return vec![],
    };
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| load_conversation(app, &e.file_name().to_string_lossy()))
        .collect()
}

fn save_conv_to_disk(app: &tauri::AppHandle, conv: &Conversation) {
    let dir = match conv_dir(app, &conv.id) {
        Some(p) => p,
        None => return,
    };
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("meta.json");
    if let Ok(json) = serde_json::to_string_pretty(conv) {
        let _ = fs::write(path, json);
    }
}

// ──────────────────────────── Helpers ────────────────────────────────────

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
async fn fetch_models(api_key: String, api_url: String) -> Result<Vec<ModelInfo>, String> {
    let base = if api_url.contains("/images/generations") {
        api_url.replace("/images/generations", "").replace("/image_generation", "")
    } else if api_url.contains("/image_generation") {
        api_url.replace("/image_generation", "")
    } else if api_url.ends_with("/v1") || api_url.ends_with("/v4") || api_url.ends_with("/api") {
        api_url
    } else if api_url.contains("/v1/") || api_url.contains("/v4/") {
        api_url.rsplit_once("/v1/").map(|(s, _)| format!("{}/v1", s))
            .or_else(|| api_url.rsplit_once("/v4/").map(|(s, _)| format!("{}/v4", s)))
            .unwrap_or_else(|| api_url.clone())
    } else {
        api_url.trim_end_matches('/').to_string()
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

    let models: Vec<ModelInfo> = parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .filter(|m| is_image_model(&m.id))
        .map(|m| {
            let pricing = m.pricing.and_then(|p| {
                p.image
                    .or(p.output)
                    .or(p.input)
                    .map(|v| {
                        let val: f64 = v.parse().unwrap_or(0.0);
                        if val > 0.0 { format!("${:.4}", val) } else { String::new() }
                    })
                    .filter(|s| !s.is_empty())
            });
            let resolution = detect_resolution(&m.id);
            ModelInfo { id: m.id, pricing, resolution }
        })
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
    let conv = inner.conversations.last().unwrap().clone();
    save_conv_to_disk(&app, &conv);
    id
}

#[tauri::command]
async fn save_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
    title: String,
    entries: Vec<ConvEntry>,
) -> Result<(), String> {
    let (conv_id_for_extract, conv_entries_for_extract) = {
        let mut inner = state.0.lock().unwrap();
        let conv = match inner.conversations.iter_mut().find(|c| c.id == conversation_id) {
            Some(c) => {
                c.title = title;
                c.entries = entries;
                c.updated_at = now_ms();
                c.clone()
            }
            None => {
                let c = Conversation {
                    id: conversation_id.clone(),
                    title,
                    entries,
                    created_at: now_ms(),
                    updated_at: now_ms(),
                };
                inner.conversations.push(c.clone());
                c
            }
        };
        (conv.id.clone(), conv.entries.clone())
    };

    let processed_entries = save_and_extract_images(&app, &conv_id_for_extract, &conv_entries_for_extract).await;

    {
        let mut inner = state.0.lock().unwrap();
        if let Some(c) = inner.conversations.iter_mut().find(|c| c.id == conversation_id) {
            c.entries = processed_entries;
        }
        let conv_to_save = inner.conversations.iter().find(|c| c.id == conversation_id).cloned();
        if let Some(c) = conv_to_save {
            save_conv_to_disk(&app, &c);
        }
    }
    Ok(())
}

#[tauri::command]
fn list_conversations(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Vec<Conversation> {
    let convs = load_all_conversations(&app);
    let mut inner = state.0.lock().unwrap();
    inner.conversations = convs.clone();
    convs
}

#[tauri::command]
fn delete_conversation(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) {
    let mut inner = state.0.lock().unwrap();
    inner.conversations.retain(|c| c.id != conversation_id);
    if let (Some(src), Some(dst)) = (conv_dir(&app, &conversation_id), trash_dir(&app, &conversation_id)) {
        if src.exists() {
            let _ = fs::create_dir_all(dst.parent().unwrap());
            let _ = fs::rename(&src, &dst);
            let meta = TrashMeta { moved_at: now_ms() };
            if let Ok(json) = serde_json::to_string(&meta) {
                let _ = fs::write(dst.join("trash_meta.json"), json);
            }
        }
    }
}

#[tauri::command]
fn list_trash(app: tauri::AppHandle) -> Vec<TrashItem> {
    let base = match trash_root(&app) {
        Some(p) => p,
        None => return vec![],
    };
    if !base.exists() {
        return vec![];
    }
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let dir = e.path();
            let id = e.file_name().to_string_lossy().to_string();
            let meta_path = dir.join("meta.json");
            let conv_json = fs::read_to_string(&meta_path).ok()?;
            let conv: Conversation = serde_json::from_str(&conv_json).ok()?;
            let tm_path = dir.join("trash_meta.json");
            let tm_json = fs::read_to_string(&tm_path).ok()?;
            let tm: TrashMeta = serde_json::from_str(&tm_json).ok()?;
            let image_count: u32 = conv.entries.iter()
                .map(|ent| ent.image_count.unwrap_or(0))
                .sum();
            Some(TrashItem {
                id,
                title: conv.title,
                image_count,
                created_at: conv.created_at,
                updated_at: conv.updated_at,
                moved_at: tm.moved_at,
            })
        })
        .collect()
}

#[tauri::command]
fn restore_trash(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conversation_id: String,
) {
    let (src, dst) = match (trash_dir(&app, &conversation_id), conv_dir(&app, &conversation_id)) {
        (Some(s), Some(d)) => (s, d),
        _ => return,
    };
    if !src.exists() {
        return;
    }
    let _ = fs::create_dir_all(dst.parent().unwrap());
    let _ = fs::rename(&src, &dst);
    if let Ok(json) = fs::read_to_string(dst.join("meta.json")) {
        if let Ok(conv) = serde_json::from_str::<Conversation>(&json) {
            let mut inner = state.0.lock().unwrap();
            if !inner.conversations.iter().any(|c| c.id == conversation_id) {
                inner.conversations.push(conv);
            }
        }
    }
}

#[tauri::command]
fn permanent_delete_trash(
    app: tauri::AppHandle,
    conversation_id: String,
) {
    if let Some(dir) = trash_dir(&app, &conversation_id) {
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

#[tauri::command]
fn permanent_delete_all_trash(
    app: tauri::AppHandle,
) {
    if let Some(base) = trash_root(&app) {
        if base.exists() {
            let _ = fs::remove_dir_all(&base);
            let _ = fs::create_dir_all(&base);
        }
    }
}

fn cleanup_expired_trash(app: &tauri::AppHandle) {
    let base = match trash_root(app) {
        Some(p) => p,
        None => return,
    };
    if !base.exists() {
        return;
    }
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return,
    };
    let now = now_ms();
    let seven_days_ms: u64 = 7 * 24 * 60 * 60 * 1000;
    for entry in entries.filter_map(|e| e.ok()) {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let tm_path = dir.join("trash_meta.json");
        if let Ok(json) = fs::read_to_string(&tm_path) {
            if let Ok(tm) = serde_json::from_str::<TrashMeta>(&json) {
                if now.saturating_sub(tm.moved_at) >= seven_days_ms {
                    let _ = fs::remove_dir_all(&dir);
                }
            }
        }
    }
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
        save_conv_to_disk(&app, c);
    }
}

#[tauri::command]
fn save_open_windows(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    windows: Vec<String>,
) {
    let mut inner = state.0.lock().unwrap();
    inner.open_windows = windows.clone();
    save_open_windows_json(&app, &windows);
}

#[tauri::command]
#[allow(dead_code)]
fn get_open_windows(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.0.lock().unwrap().open_windows.clone()
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
        save_open_windows_json(&app, &inner.open_windows);
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

fn save_open_windows_json(app: &tauri::AppHandle, windows: &[String]) {
    let path = match app_data_dir(app) {
        Some(p) => p.join("open_windows.json"),
        None => return,
    };
    if let Ok(json) = serde_json::to_string(windows) {
        let _ = fs::create_dir_all(path.parent().unwrap());
        let _ = fs::write(&path, json);
    }
}

fn load_open_windows_json(app: &tauri::AppHandle) -> Vec<String> {
    let path = match app_data_dir(app) {
        Some(p) => p.join("open_windows.json"),
        None => return vec![],
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn migrate_old_conversations(app: &tauri::AppHandle) {
    let old_file = match app_data_dir(app) {
        Some(p) => p.join("conversations.json"),
        None => return,
    };
    if !old_file.exists() {
        return;
    }
    let json = match fs::read_to_string(&old_file) {
        Ok(j) => j,
        Err(_) => return,
    };
    let convs: Vec<Conversation> = match serde_json::from_str(&json) {
        Ok(c) => c,
        Err(_) => return,
    };
    for conv in &convs {
        save_conv_to_disk(app, conv);
    }
    let _ = fs::remove_file(old_file);
}

#[tauri::command]
async fn read_image_base64(path: String) -> Result<String, String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File not found: {}", path));
    }
    if !path_buf.is_file() {
        return Err(format!("Not a file: {}", path));
    }
    let mut file = std::fs::File::open(&path_buf).map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| format!("Failed to read '{}': {}", path, e))?;
    if buf.is_empty() {
        return Err(format!("File is empty: {}", path));
    }
    let ext = path_buf.extension().and_then(|e| e.to_str()).unwrap_or("unknown");
    let mime = match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:{};base64,{}", mime, b64))
}

async fn save_and_extract_images(app: &tauri::AppHandle, conv_id: &str, entries: &[ConvEntry]) -> Vec<ConvEntry> {
    let img_base = match images_dir(app, conv_id) {
        Some(p) => p,
        None => return entries.to_vec(),
    };
    let _ = fs::create_dir_all(&img_base);
    use base64::Engine as _;
    let decode_b64 = |s: &str| -> Option<Vec<u8>> {
        let data = s.strip_prefix("data:").and_then(|r| r.split_once(",")).map(|(_, d)| d).unwrap_or(s);
        base64::engine::general_purpose::STANDARD.decode(data).ok()
    };
    let save_bytes = |bytes: &[u8], entry_id: &str, idx: usize, suffix: &str| -> Option<String> {
        let fname = format!("{}_{}{}.png", entry_id, suffix, idx);
        let fpath = img_base.join(&fname);
        fs::write(&fpath, bytes).ok()?;
        Some(fpath.to_string_lossy().to_string())
    };
    let mut updated: Vec<ConvEntry> = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.loading == Some(true) {
            updated.push(entry.clone());
            continue;
        }
        let mut new_entry = entry.clone();
        if let Some(ref imgs) = entry.images {
            let mut processed = Vec::new();
            for (i, img) in imgs.iter().enumerate() {
                if img.starts_with("data:") {
                    if let Some(bytes) = decode_b64(img) {
                        if let Some(path) = save_bytes(&bytes, &entry.id, i, "") {
                            processed.push(path);
                            continue;
                        }
                    }
                } else if img.starts_with("http") {
                    if let Some(bytes) = download_url_bytes(img).await {
                        if let Some(path) = save_bytes(&bytes, &entry.id, i, "") {
                            processed.push(path);
                            continue;
                        }
                    }
                }
                processed.push(img.clone());
            }
            new_entry.images = Some(processed);
        }
        if let Some(ref refs) = entry.ref_images {
            let mut processed = Vec::new();
            for (i, img) in refs.iter().enumerate() {
                if img.starts_with("data:") {
                    if let Some(bytes) = decode_b64(img) {
                        if let Some(path) = save_bytes(&bytes, &entry.id, i, "ref_") {
                            processed.push(path);
                            continue;
                        }
                    }
                } else if img.starts_with("http") {
                    if let Some(bytes) = download_url_bytes(img).await {
                        if let Some(path) = save_bytes(&bytes, &entry.id, i, "ref_") {
                            processed.push(path);
                            continue;
                        }
                    }
                }
                processed.push(img.clone());
            }
            new_entry.ref_images = Some(processed);
        }
        updated.push(new_entry);
    }
    updated
}

async fn download_url_bytes(url: &str) -> Option<Vec<u8>> {
    HTTP_CLIENT
        .get(url)
        .send()
        .await
        .ok()?
        .bytes()
        .await
        .ok()
        .map(|b| b.to_vec())
}

// ──────────────────────────── MCP Conversation Commands ─────────────────

fn mcp_conv_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app_data_dir(app).map(|p| p.join("mcp_conversations"))
}

#[allow(dead_code)]
fn load_mcp_conversation(app: &tauri::AppHandle, session_id: &str) -> Option<Conversation> {
    let base = mcp_conv_dir(app)?;
    let path = base.join(session_id).join("meta.json");
    if !path.exists() { return None; }
    let json = fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&json) {
        Ok(c) => Some(c),
        Err(err) => {
            eprintln!("[mcp] Failed to parse session {}: {}", session_id, err);
            Some(Conversation {
                id: session_id.to_string(),
                title: format!("[加载失败] {}", session_id),
                entries: vec![],
                created_at: 0,
                updated_at: 0,
            })
        }
    }
}

fn load_all_mcp_conversations(app: &tauri::AppHandle) -> Vec<Conversation> {
    let base = match mcp_conv_dir(app) {
        Some(p) => p,
        None => return vec![],
    };
    if !base.exists() {
        return vec![];
    }
    let entries = match fs::read_dir(&base) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut convs: Vec<Conversation> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let dir = e.path();
            let dir_name = e.file_name().to_string_lossy().to_string();
            let meta_path = dir.join("meta.json");
            let json = fs::read_to_string(&meta_path).ok()?;
            match serde_json::from_str::<Conversation>(&json) {
                Ok(c) => Some(c),
                Err(err) => {
                    eprintln!("[mcp] Failed to parse {}: {}", dir_name, err);
                    Some(Conversation {
                        id: dir_name.clone(),
                        title: format!("[加载失败] {}", dir_name),
                        entries: vec![],
                        created_at: 0,
                        updated_at: 0,
                    })
                }
            }
        })
        .collect();
    convs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    convs
}

#[tauri::command]
fn list_mcp_conversations(app: tauri::AppHandle) -> Vec<Conversation> {
    load_all_mcp_conversations(&app)
}

#[tauri::command]
fn get_mcp_config_file(app: tauri::AppHandle) -> serde_json::Value {
    let path = match app_data_dir(&app) {
        Some(p) => p.join("mcp_config.json"),
        None => return serde_json::json!({}),
    };
    match fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json).unwrap_or(serde_json::json!({})),
        Err(_) => serde_json::json!({}),
    }
}

#[tauri::command]
fn save_mcp_config_file(
    app: tauri::AppHandle,
    config: serde_json::Value,
) -> Result<(), String> {
    let path = match app_data_dir(&app) {
        Some(p) => p.join("mcp_config.json"),
        None => return Err("Cannot determine app data dir".to_string()),
    };
    let _ = fs::create_dir_all(path.parent().unwrap());
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_mcp_conversation(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let dir = match mcp_conv_dir(&app) {
        Some(p) => p.join(&session_id),
        None => return Err("Cannot determine MCP dir".to_string()),
    };
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_mcp_server_url() -> Result<String, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let local_ip = socket.local_addr().map_err(|e| e.to_string())?.ip().to_string();
    drop(socket);
    Ok(format!("http://{}:3845/mcp", local_ip))
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

            migrate_old_conversations(&app_handle);
            let saved_convs = load_all_conversations(&app_handle);
            let saved_windows = load_open_windows_json(&app_handle);

            {
                let mut inner = state.0.lock().unwrap();
                inner.conversations = saved_convs;
                inner.open_windows = saved_windows;
            }

            let cleanup_app = app_handle.clone();
            std::thread::spawn(move || {
                loop {
                    cleanup_expired_trash(&cleanup_app);
                    std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_image,
            generate_images_parallel,
            fetch_models,
            read_image_base64,
            create_conversation,
            save_conversation,
            list_conversations,
            delete_conversation,
            rename_conversation,
            save_open_windows,
            open_conversation_in_window,
            list_trash,
            restore_trash,
            permanent_delete_trash,
            permanent_delete_all_trash,
            window_close,
            window_minimize,
            window_maximize,
            list_mcp_conversations,
            get_mcp_config_file,
            save_mcp_config_file,
            delete_mcp_conversation,
            get_mcp_server_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
