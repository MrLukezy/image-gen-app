use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const MCP_PORT: u16 = 3845;

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
    if is_nano_banana_model(&lower) {
        return true;
    }
    let image_keywords = [
        "image", "dall-e", "dalle", "gpt-image", "flux", "stable-diffusion",
        "sdxl", "midjourney", "kandinsky", "playground", "kolors", "cogview",
        "ideogram", "recraft", "black-forest-labs", "stability",
        "seedream", "jimeng", "qwen-image", "tongyi-wanxiang", "minimax-image",
        // "wanx" / 通义万相；避免过短 "wan" 误匹配
        "wanx", "wanxiang",
    ];
    image_keywords.iter().any(|kw| lower.contains(kw))
}

fn is_nano_banana_model(model: &str) -> bool {
    let m = model.to_lowercase().replace('_', "-");
    m.contains("nano-banana")
        || m.contains("nanobanana")
        || (m.contains("gemini") && m.contains("image"))
}

fn gcd_u32(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    a.max(1)
}

fn normalize_aspect_ratio(size: &str) -> String {
    let s = size.trim();
    if s.contains(':') {
        return s.to_string();
    }
    let upper = s.to_uppercase();
    if matches!(upper.as_str(), "512" | "1K" | "2K" | "4K") {
        return "1:1".to_string();
    }
    let lower = s.to_lowercase();
    let parts: Vec<&str> = lower.split('x').collect();
    if parts.len() == 2 {
        if let (Ok(w), Ok(h)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
            if w > 0 && h > 0 {
                return nearest_aspect_ratio(w, h);
            }
        }
    }
    "1:1".to_string()
}

fn nearest_aspect_ratio(w: u32, h: u32) -> String {
    const CANDIDATES: &[(f64, &str)] = &[
        (1.0, "1:1"),
        (2.0 / 3.0, "2:3"),
        (3.0 / 2.0, "3:2"),
        (3.0 / 4.0, "3:4"),
        (4.0 / 3.0, "4:3"),
        (4.0 / 5.0, "4:5"),
        (5.0 / 4.0, "5:4"),
        (9.0 / 16.0, "9:16"),
        (16.0 / 9.0, "16:9"),
        (21.0 / 9.0, "21:9"),
    ];
    let ratio = w as f64 / h as f64;
    let g = gcd_u32(w, h);
    let exact = format!("{}:{}", w / g, h / g);
    if CANDIDATES.iter().any(|(_, r)| *r == exact) {
        return exact;
    }
    CANDIDATES
        .iter()
        .min_by(|a, b| {
            (a.0 - ratio)
                .abs()
                .partial_cmp(&(b.0 - ratio).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(_, r)| (*r).to_string())
        .unwrap_or_else(|| "1:1".to_string())
}

fn normalize_image_size(size: &str) -> String {
    let s = size.trim();
    let upper = s.to_uppercase();
    if matches!(upper.as_str(), "512" | "1K" | "2K" | "4K") {
        return if upper == "512" { "512".into() } else { upper };
    }
    let lower = s.to_lowercase();
    let parts: Vec<&str> = lower.split('x').collect();
    if parts.len() == 2 {
        if let (Ok(w), Ok(h)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
            let long = w.max(h);
            return if long >= 3000 {
                "4K".into()
            } else if long >= 1600 {
                "2K".into()
            } else if long >= 700 {
                "1K".into()
            } else {
                "512".into()
            };
        }
    }
    "1K".into()
}

fn derive_api_origin(api_url: &str) -> String {
    if let Ok(u) = reqwest::Url::parse(api_url) {
        let port = u
            .port()
            .map(|p| format!(":{}", p))
            .unwrap_or_default();
        return format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), port);
    }
    api_url
        .split("/v1/")
        .next()
        .or_else(|| api_url.split("/v1beta/").next())
        .unwrap_or(api_url)
        .trim_end_matches('/')
        .to_string()
}

fn derive_gemini_generate_url(api_url: &str, model: &str) -> String {
    format!(
        "{}/v1beta/models/{}:generateContent",
        derive_api_origin(api_url),
        model
    )
}

fn derive_chat_completions_url(api_url: &str) -> String {
    if api_url.contains("/images/generations") {
        return api_url.replace("/images/generations", "/chat/completions");
    }
    if api_url.contains("/image_generation") {
        return api_url.replace("/image_generation", "/chat/completions");
    }
    format!("{}/v1/chat/completions", derive_api_origin(api_url))
}

fn split_data_uri(data: &str) -> (String, String) {
    if let Some(rest) = data.strip_prefix("data:") {
        if let Some((meta, b64)) = rest.split_once(',') {
            let mime = meta.split(';').next().unwrap_or("image/png");
            return (mime.to_string(), b64.to_string());
        }
    }
    ("image/png".into(), data.to_string())
}

fn clean_base64_payload(raw: &str) -> String {
    let mut s: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '"')
        .collect();
    // 去掉误带的 data-uri / base64: 前缀
    if let Some(idx) = s.find("base64,") {
        s = s[idx + "base64,".len()..].to_string();
    }
    if let Some(rest) = s.strip_prefix("base64:") {
        s = rest.to_string();
    }
    while s.len() % 4 != 0 {
        s.push('=');
    }
    s
}

fn mime_from_path(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

fn file_to_data_uri(path: &std::path::Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("读取参考图失败 {}: {}", path.display(), e))?;
    if bytes.is_empty() {
        return Err(format!("参考图为空文件: {}", path.display()));
    }
    use base64::Engine as _;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime_from_path(path), b64))
}

fn looks_like_local_path(s: &str) -> bool {
    let p = std::path::Path::new(s);
    if p.is_file() {
        return true;
    }
    // Windows / Unix 路径形态（未即时存在时也尽量识别，避免当 base64 发出去）
    if s.len() >= 2 && s.as_bytes()[1] == b':' && s.as_bytes()[0].is_ascii_alphabetic() {
        return true;
    }
    s.starts_with("\\\\")
        || s.starts_with("./")
        || s.starts_with(".\\")
        || s.starts_with('/')
        || s.contains('\\')
}

/// 把参考图统一成 http(s) URL 或标准 data URI（纯 STANDARD base64，带 padding）
fn normalize_ref_image(img: &str) -> Result<String, String> {
    let trimmed = img.trim();
    if trimmed.is_empty() {
        return Err("空的参考图".into());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }
    if trimmed.starts_with("data:") {
        let (mime, b64) = split_data_uri(trimmed);
        let cleaned = clean_base64_payload(&b64);
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD
            .decode(&cleaned)
            .map_err(|e| format!("invalid base64 image data ({e})"))?;
        return Ok(format!("data:{};base64,{}", mime, cleaned));
    }
    if looks_like_local_path(trimmed) {
        let path = std::path::Path::new(trimmed);
        if path.is_file() {
            return file_to_data_uri(path);
        }
        return Err(format!("参考图文件不存在: {}", trimmed));
    }
    // 裸 base64
    let cleaned = clean_base64_payload(trimmed);
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(&cleaned)
        .map_err(|_| {
            format!(
                "无法识别的参考图（既不是 URL/dataURI/本地文件，也不是合法 base64）: {}",
                &trimmed[..trimmed.len().min(60)]
            )
        })?;
    Ok(format!("data:image/png;base64,{}", cleaned))
}

fn normalize_ref_images(refs: Option<Vec<String>>) -> Result<Option<Vec<String>>, String> {
    let Some(list) = refs.filter(|v| !v.is_empty()) else {
        return Ok(None);
    };
    let mut out = Vec::with_capacity(list.len());
    for (i, img) in list.iter().enumerate() {
        out.push(normalize_ref_image(img).map_err(|e| format!("参考图 #{}: {}", i + 1, e))?);
    }
    Ok(Some(out))
}

fn build_gemini_image_payload(
    prompt: &str,
    size: &str,
    reference_images: &Option<Vec<String>>,
) -> serde_json::Value {
    let aspect_ratio = normalize_aspect_ratio(size);
    let image_size = normalize_image_size(size);
    let mut parts: Vec<serde_json::Value> = vec![serde_json::json!({ "text": prompt })];
    if let Some(refs) = reference_images {
        for img in refs {
            if img.starts_with("http://") || img.starts_with("https://") {
                parts.push(serde_json::json!({
                    "fileData": { "fileUri": img, "mimeType": "image/png" }
                }));
            } else {
                let (mime, b64) = split_data_uri(img);
                let cleaned = clean_base64_payload(&b64);
                parts.push(serde_json::json!({
                    "inlineData": { "mimeType": mime, "data": cleaned }
                }));
            }
        }
    }
    serde_json::json!({
        "contents": [{ "role": "user", "parts": parts }],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {
                "aspectRatio": aspect_ratio,
                "imageSize": image_size
            }
        }
    })
}

fn build_openai_banana_payload(
    model: &str,
    prompt: &str,
    size: &str,
    reference_images: &Option<Vec<String>>,
) -> serde_json::Value {
    let aspect_ratio = normalize_aspect_ratio(size);
    let image_size = normalize_image_size(size);
    let mut body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        // 多数中转对 nano-banana 期望 size=宽高比，而不是 1280x720
        "size": aspect_ratio,
        "aspect_ratio": aspect_ratio,
        "image_size": image_size,
        "imageSize": image_size,
        "n": 1,
        // url 比 b64_json 更不容易踩中转 SSE / tool 通道问题
        "response_format": "url",
    });
    if let Some(refs) = reference_images {
        if !refs.is_empty() {
            body["image"] = serde_json::json!(refs);
            body["image_urls"] = serde_json::json!(refs);
            body["reference_images"] = serde_json::json!(refs);
            body["extra_fields"] = serde_json::json!({
                "reference_images": refs,
                "aspect_ratio": aspect_ratio,
                "image_size": image_size
            });
        } else {
            body["extra_fields"] = serde_json::json!({
                "aspect_ratio": aspect_ratio,
                "image_size": image_size
            });
        }
    } else {
        body["extra_fields"] = serde_json::json!({
            "aspect_ratio": aspect_ratio,
            "image_size": image_size
        });
    }
    body
}

fn extract_images_from_json(value: &serde_json::Value) -> Vec<String> {
    let mut images = Vec::new();

    if let Some(url) = value.get("result_url").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        images.push(url.to_string());
    }

    if let Some(arr) = value.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(b64) = item.get("b64_json").and_then(|v| v.as_str()) {
                images.push(format!("data:image/png;base64,{}", b64));
            } else if let Some(url) = item.get("url").and_then(|v| v.as_str()) {
                images.push(url.to_string());
            }
        }
    }

    // Gemini generateContent
    if let Some(candidates) = value.get("candidates").and_then(|v| v.as_array()) {
        for cand in candidates {
            if let Some(parts) = cand
                .pointer("/content/parts")
                .and_then(|v| v.as_array())
            {
                for part in parts {
                    let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
                    if let Some(inline) = inline {
                        if let Some(b64) = inline.get("data").and_then(|v| v.as_str()) {
                            let mime = inline
                                .get("mimeType")
                                .or_else(|| inline.get("mime_type"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("image/png");
                            images.push(format!("data:{};base64,{}", mime, b64));
                        }
                    }
                    if let Some(url) = part
                        .pointer("/fileData/fileUri")
                        .or_else(|| part.pointer("/file_data/file_uri"))
                        .and_then(|v| v.as_str())
                    {
                        images.push(url.to_string());
                    }
                }
            }
        }
    }

    // chat/completions multimodal image replies
    if let Some(choices) = value.get("choices").and_then(|v| v.as_array()) {
        for choice in choices {
            let message = choice.get("message");
            if let Some(msg) = message {
                if let Some(imgs) = msg.get("images").and_then(|v| v.as_array()) {
                    for img in imgs {
                        if let Some(url) = img
                            .pointer("/image_url/url")
                            .or_else(|| img.get("url"))
                            .and_then(|v| v.as_str())
                        {
                            images.push(url.to_string());
                        } else if let Some(b64) = img.get("b64_json").and_then(|v| v.as_str()) {
                            images.push(format!("data:image/png;base64,{}", b64));
                        }
                    }
                }
                match msg.get("content") {
                    Some(serde_json::Value::String(s)) => {
                        // markdown image or bare data uri
                        if s.starts_with("data:image") || s.starts_with("http") {
                            images.push(s.clone());
                        }
                        for cap in s.split("](").skip(1) {
                            if let Some(end) = cap.find(')') {
                                let url = &cap[..end];
                                if url.starts_with("http") || url.starts_with("data:image") {
                                    images.push(url.to_string());
                                }
                            }
                        }
                    }
                    Some(serde_json::Value::Array(parts)) => {
                        for part in parts {
                            if let Some(url) = part
                                .pointer("/image_url/url")
                                .or_else(|| part.pointer("/imageUrl/url"))
                                .and_then(|v| v.as_str())
                            {
                                images.push(url.to_string());
                            }
                            let inline = part.get("inlineData").or_else(|| part.get("inline_data"));
                            if let Some(inline) = inline {
                                if let Some(b64) = inline.get("data").and_then(|v| v.as_str()) {
                                    let mime = inline
                                        .get("mimeType")
                                        .or_else(|| inline.get("mime_type"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("image/png");
                                    images.push(format!("data:{};base64,{}", mime, b64));
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    images
}

fn looks_like_imagen_only_reject(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("only imagen models are supported")
        || lower.contains("not supported model for image generation")
        || lower.contains("convert_request_failed")
}

fn looks_like_account_restricted(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("account access is restricted")
        || lower.contains("access is restricted")
        || lower.contains("permission_denied")
}

fn looks_like_bad_base64(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("invalid base64")
        || lower.contains("incorrect padding")
        || lower.contains("illegal base64")
        || lower.contains("failed to decode base64")
}

fn summarize_nano_banana_failure(
    gemini_err: Option<&str>,
    chat_err: Option<&str>,
    images_err: Option<&str>,
) -> String {
    let all = [gemini_err, chat_err, images_err]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    if all.iter().any(|e| looks_like_account_restricted(e)) {
        return "Nano Banana 上游账号被限制（Account access is restricted）。\n\
这通常是中转站的 Gemini/Banana 渠道被封或未开通，不是本地请求格式错误。\n\
建议：\n\
1. 在中转后台换一条可用的 Gemini 出图渠道 / 分组；\n\
2. 或换一个已开通 nano-banana 的 API Key；\n\
3. 临时改用 gpt-image / dall-e 等 Images 接口模型。"
            .to_string();
    }
    if all.iter().any(|e| looks_like_bad_base64(e)) {
        return format!(
            "参考图 base64 无效（常见原因：传入了本地文件路径，或 dataURI 未正确剥离）。\n\
- Gemini: {}\n- Chat: {}",
            gemini_err.unwrap_or("未尝试"),
            chat_err.unwrap_or("未尝试"),
        );
    }
    if images_err.is_some_and(looks_like_imagen_only_reject)
        && gemini_err.is_some()
        && chat_err.is_some()
    {
        return format!(
            "Nano Banana 生图失败：当前中转的 /images/generations 只支持 Imagen，\
Gemini 路径也失败。\n- Gemini: {}\n- Chat: {}",
            gemini_err.unwrap_or("无图片"),
            chat_err.unwrap_or("无图片"),
        );
    }
    format!(
        "Nano Banana 生图失败\n- Gemini: {}\n- Chat: {}\n- Images: {}",
        gemini_err.unwrap_or("未尝试/无图片"),
        chat_err.unwrap_or("未尝试/无图片"),
        images_err.unwrap_or("未尝试/无图片"),
    )
}

async fn post_json_for_images(
    url: &str,
    api_key: &str,
    body: &serde_json::Value,
    timeout_secs: u64,
) -> Result<(u16, String), String> {
    let request = HTTP_CLIENT
        .post(url)
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(body);

    let resp = send_with_retry(request, 1).await.map_err(|e| {
        if e.is_timeout() {
            "请求超时，请检查网络连接".to_string()
        } else if e.is_connect() {
            format!("无法连接到服务器: {}", e)
        } else {
            format!("请求失败: {}", e)
        }
    })?;

    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    Ok((status, text))
}

async fn poll_task_images(
    api_url: &str,
    api_key: &str,
    task_id: &str,
) -> Result<Vec<String>, String> {
    let poll_url = format!("{}/{}", api_url.trim_end_matches("/generations"), task_id);
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let poll_request = HTTP_CLIENT
            .get(&poll_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .timeout(std::time::Duration::from_secs(30));
        let poll_resp = send_with_retry(poll_request, 2)
            .await
            .map_err(|e| format!("轮询失败: {}", e))?;
        let poll_text = poll_resp
            .text()
            .await
            .map_err(|e| format!("读取轮询响应失败: {}", e))?;
        let poll_data: serde_json::Value = serde_json::from_str(&poll_text)
            .map_err(|e| format!("解析轮询响应失败: {}", e))?;
        let status = poll_data
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status == "SUCCESS" || status == "succeeded" || status == "completed" {
            let images = extract_images_from_json(&poll_data);
            if !images.is_empty() {
                return Ok(images);
            }
        } else if status == "FAILED" || status == "ERROR" || status == "failed" {
            let reason = poll_data
                .get("fail_reason")
                .or_else(|| poll_data.pointer("/error/message"))
                .and_then(|v| v.as_str())
                .unwrap_or("生成失败");
            return Err(reason.to_string());
        }
    }
    Err("生成超时（5分钟），请稍后重试".into())
}

async fn generate_via_openai_images(
    api_url: &str,
    api_key: &str,
    payload: &serde_json::Value,
    timeout_secs: u64,
) -> ImgResult {
    match post_json_for_images(api_url, api_key, payload, timeout_secs).await {
        Ok((status, body_text)) => {
            if !(200..300).contains(&status) {
                return ImgResult {
                    images: vec![],
                    error: Some(format!("HTTP {}: {}", status, body_text)),
                };
            }
            let value: serde_json::Value = match serde_json::from_str(&body_text) {
                Ok(v) => v,
                Err(e) => {
                    return ImgResult {
                        images: vec![],
                        error: Some(format!(
                            "解析响应失败: {} | body: {}",
                            e,
                            &body_text[..body_text.len().min(500)]
                        )),
                    };
                }
            };
            if let Some(s) = value.get("status").and_then(|v| v.as_str()) {
                if s == "FAILED" || s == "ERROR" {
                    return ImgResult {
                        images: vec![],
                        error: Some(
                            value
                                .get("fail_reason")
                                .and_then(|v| v.as_str())
                                .unwrap_or(&body_text)
                                .to_string(),
                        ),
                    };
                }
            }
            let mut images = extract_images_from_json(&value);
            if images.is_empty() {
                if let Some(task_id) = value
                    .get("task_id")
                    .or_else(|| value.get("id"))
                    .and_then(|v| v.as_str())
                {
                    match poll_task_images(api_url, api_key, task_id).await {
                        Ok(imgs) => images = imgs,
                        Err(e) => {
                            return ImgResult {
                                images: vec![],
                                error: Some(e),
                            }
                        }
                    }
                }
            }
            if images.is_empty() {
                ImgResult {
                    images: vec![],
                    error: Some(format!("生图未返回图片: {}", &body_text[..body_text.len().min(300)])),
                }
            } else {
                ImgResult {
                    images,
                    error: None,
                }
            }
        }
        Err(e) => ImgResult {
            images: vec![],
            error: Some(e),
        },
    }
}

async fn generate_via_gemini_native(
    api_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    size: &str,
    reference_images: &Option<Vec<String>>,
) -> ImgResult {
    let url = derive_gemini_generate_url(api_url, model);
    let payload = build_gemini_image_payload(prompt, size, reference_images);
    match post_json_for_images(&url, api_key, &payload, 300).await {
        Ok((status, body_text)) => {
            if !(200..300).contains(&status) {
                return ImgResult {
                    images: vec![],
                    error: Some(format!("Gemini HTTP {}: {}", status, body_text)),
                };
            }
            let value: serde_json::Value = match serde_json::from_str(&body_text) {
                Ok(v) => v,
                Err(e) => {
                    return ImgResult {
                        images: vec![],
                        error: Some(format!(
                            "解析 Gemini 响应失败: {} | body: {}",
                            e,
                            &body_text[..body_text.len().min(500)]
                        )),
                    };
                }
            };
            let images = extract_images_from_json(&value);
            if images.is_empty() {
                // 常见：安全拦截时仍返回 200 + 文本
                let text_hint = value
                    .pointer("/candidates/0/content/parts/0/text")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&body_text[..body_text.len().min(200)]);
                ImgResult {
                    images: vec![],
                    error: Some(format!("Gemini 未返回图片: {}", text_hint)),
                }
            } else {
                ImgResult {
                    images,
                    error: None,
                }
            }
        }
        Err(e) => ImgResult {
            images: vec![],
            error: Some(e),
        },
    }
}

async fn generate_via_chat_modalities(
    api_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    reference_images: &Option<Vec<String>>,
) -> ImgResult {
    let url = derive_chat_completions_url(api_url);
    let mut content: Vec<serde_json::Value> =
        vec![serde_json::json!({ "type": "text", "text": prompt })];
    if let Some(refs) = reference_images {
        for img in refs {
            let url_val = if img.starts_with("http") || img.starts_with("data:") {
                img.clone()
            } else {
                format!("data:image/png;base64,{}", img)
            };
            content.push(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": url_val }
            }));
        }
    }
    let payload = serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [{ "role": "user", "content": content }],
        "modalities": ["text", "image"]
    });
    match post_json_for_images(&url, api_key, &payload, 300).await {
        Ok((status, body_text)) => {
            if !(200..300).contains(&status) {
                return ImgResult {
                    images: vec![],
                    error: Some(format!("Chat HTTP {}: {}", status, body_text)),
                };
            }
            let value: serde_json::Value = match serde_json::from_str(&body_text) {
                Ok(v) => v,
                Err(e) => {
                    return ImgResult {
                        images: vec![],
                        error: Some(format!(
                            "解析 Chat 响应失败: {} | body: {}",
                            e,
                            &body_text[..body_text.len().min(500)]
                        )),
                    };
                }
            };
            let images = extract_images_from_json(&value);
            if images.is_empty() {
                ImgResult {
                    images: vec![],
                    error: Some(format!(
                        "Chat 未返回图片: {}",
                        &body_text[..body_text.len().min(300)]
                    )),
                }
            } else {
                ImgResult {
                    images,
                    error: None,
                }
            }
        }
        Err(e) => ImgResult {
            images: vec![],
            error: Some(e),
        },
    }
}

async fn do_generate_image(
    api_url: String,
    api_key: String,
    model: String,
    prompt: String,
    size: String,
    n: u32,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> ImgResult {
    let refs = match normalize_ref_images(reference_images) {
        Ok(r) => r,
        Err(e) => {
            return ImgResult {
                images: vec![],
                error: Some(e),
            }
        }
    };

    if is_nano_banana_model(&model) {
        // Nano Banana = Gemini 多模态出图，不是 Imagen；new-api 的 /images/generations 通常会直接拒绝。
        // 优先 Gemini 原生，再 Chat；Images 仅作少数兼容站兜底。
        let gemini = generate_via_gemini_native(
            &api_url,
            &api_key,
            &model,
            &prompt,
            &size,
            &refs,
        )
        .await;
        if gemini.error.is_none() && !gemini.images.is_empty() {
            return gemini;
        }

        // 账号受限时无需继续打其它入口，避免叠一堆误导错误
        if gemini
            .error
            .as_deref()
            .is_some_and(looks_like_account_restricted)
        {
            return ImgResult {
                images: vec![],
                error: Some(summarize_nano_banana_failure(
                    gemini.error.as_deref(),
                    None,
                    None,
                )),
            };
        }

        let chat = generate_via_chat_modalities(&api_url, &api_key, &model, &prompt, &refs).await;
        if chat.error.is_none() && !chat.images.is_empty() {
            return chat;
        }
        if chat
            .error
            .as_deref()
            .is_some_and(looks_like_account_restricted)
        {
            return ImgResult {
                images: vec![],
                error: Some(summarize_nano_banana_failure(
                    gemini.error.as_deref(),
                    chat.error.as_deref(),
                    None,
                )),
            };
        }

        // 少数中转仍用 OpenAI Images 包装 banana；若返回 only imagen 则忽略该路径
        let banana_payload = build_openai_banana_payload(&model, &prompt, &size, &refs);
        let openai = generate_via_openai_images(&api_url, &api_key, &banana_payload, 300).await;
        if openai.error.is_none() && !openai.images.is_empty() {
            return openai;
        }
        let images_err = openai.error.as_deref().filter(|e| !looks_like_imagen_only_reject(e));

        return ImgResult {
            images: vec![],
            error: Some(summarize_nano_banana_failure(
                gemini.error.as_deref(),
                chat.error.as_deref(),
                images_err.or(openai.error.as_deref()),
            )),
        };
    }

    // 默认 OpenAI Images 路径
    let payload = GenRequest {
        model: model.clone(),
        prompt: prompt.clone(),
        reference_images: refs,
        size: size.clone(),
        n,
        response_format: response_format.clone(),
    };
    let value = serde_json::to_value(payload).unwrap_or_else(|_| serde_json::json!({}));
    generate_via_openai_images(&api_url, &api_key, &value, 180).await
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

async fn generate_single(
    api_url: String,
    api_key: String,
    model: String,
    prompt: String,
    size: String,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> ImgResult {
    do_generate_image(
        api_url,
        api_key,
        model,
        prompt,
        size,
        1,
        reference_images,
        response_format,
    )
    .await
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
    Ok(do_generate_image(
        api_url,
        api_key,
        model,
        prompt,
        size,
        n,
        reference_images,
        response_format,
    )
    .await)
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

// ──────────────────────────── Video Generation ────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct VideoCreateRequest {
    model: String,
    prompt: String,
    orientation: String,
    duration: i64,
    watermark: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    videos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audios: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    start_image_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end_image_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VideoCreateResponse {
    id: Option<String>,
    task_id: Option<String>,
    status: Option<String>,
    error: Option<serde_json::Value>,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct VideoQueryResponse {
    id: Option<String>,
    status: Option<String>,
    progress: Option<serde_json::Value>,
    video_url: Option<String>,
    url: Option<String>,
    error: Option<serde_json::Value>,
    data: Option<serde_json::Value>,
    result: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct VideoResult {
    video_url: Option<String>,
    thumbnail_url: Option<String>,
    error: Option<String>,
    progress: Option<String>,
}

fn derive_video_base_url(image_api_url: &str) -> String {
    if image_api_url.contains("/images/generations") {
        image_api_url.replace("/images/generations", "")
    } else if image_api_url.contains("/image_generation") {
        image_api_url.replace("/image_generation", "")
    } else if image_api_url.ends_with("/v1") {
        image_api_url.to_string()
    } else if image_api_url.ends_with("/v4") {
        image_api_url.replace("/v4", "/v1")
    } else if image_api_url.contains("/v1/") {
        image_api_url.rsplit_once("/v1/").map(|(s, _)| format!("{}/v1", s))
            .unwrap_or_else(|| image_api_url.trim_end_matches('/').to_string())
    } else {
        image_api_url.trim_end_matches('/').to_string()
    }
}

#[tauri::command]
async fn generate_video(
    prompt: String,
    api_key: String,
    api_url: String,
    model: String,
    orientation: String,
    duration: i64,
    image_urls: Option<Vec<String>>,
    video_urls: Option<Vec<String>>,
    audio_urls: Option<Vec<String>>,
    start_image_url: Option<String>,
    end_image_url: Option<String>,
    sd_size: Option<String>,
) -> Result<VideoResult, String> {
    let video_base = derive_video_base_url(&api_url);
    let create_url = format!("{}/video/create", video_base);

    let mut payload = VideoCreateRequest {
        model: model.clone(),
        prompt: prompt.clone(),
        orientation: orientation.clone(),
        duration,
        watermark: false,
        size: None,
        images: image_urls.filter(|v| !v.is_empty()),
        videos: video_urls.filter(|v| !v.is_empty()),
        audios: audio_urls.filter(|v| !v.is_empty()),
        start_image_url: start_image_url.filter(|s| !s.is_empty()),
        end_image_url: end_image_url.filter(|s| !s.is_empty()),
    };

    if model == "sora-2" {
        payload.size = Some("1080p".to_string());
    } else if let Some(ref sz) = sd_size {
        if !sz.is_empty() {
            payload.size = Some(sz.clone());
        }
    }

    let request = HTTP_CLIENT
        .post(&create_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload);

    let resp = send_with_retry(request, 2).await.map_err(|e| {
        if e.is_timeout() { "视频请求超时，请检查网络".to_string() }
        else { format!("请求失败: {}", e) }
    })?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Ok(VideoResult {
            video_url: None,
            thumbnail_url: None,
            error: Some(format!("HTTP {}: {}", status, &body[..body.len().min(300)])),
            progress: None,
        });
    }

    let create_resp: VideoCreateResponse = serde_json::from_str(&body)
        .map_err(|e| format!("解析响应失败: {} | {}", e, &body[..body.len().min(300)]))?;

    if let Some(ref err) = create_resp.error {
        let msg = err.as_str().unwrap_or("unknown error").to_string();
        return Ok(VideoResult {
            video_url: None,
            thumbnail_url: None,
            error: Some(format!("API错误: {}", msg)),
            progress: None,
        });
    }

    let task_id = create_resp.id
        .or(create_resp.task_id.clone())
        .unwrap_or_default();

    if task_id.is_empty() {
        return Ok(VideoResult {
            video_url: None,
            thumbnail_url: None,
            error: Some("未获取到任务ID".to_string()),
            progress: None,
        });
    }

    let query_url = format!("{}/video/query?id={}", video_base, task_id);

    for _i in 0..180 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        let poll_request = HTTP_CLIENT
            .get(&query_url)
            .header("Authorization", format!("Bearer {}", api_key))
            .timeout(std::time::Duration::from_secs(30));

        let poll_resp = match send_with_retry(poll_request, 1).await {
            Ok(r) => r,
            Err(_) => continue,
        };

        if !poll_resp.status().is_success() {
            continue;
        }

        let poll_body = match poll_resp.text().await {
            Ok(b) => b,
            Err(_) => continue,
        };

        let query: VideoQueryResponse = match serde_json::from_str(&poll_body) {
            Ok(q) => q,
            Err(_) => continue,
        };

        let st = query.status.as_deref().unwrap_or("");

        if st == "completed" || st == "success" || st == "SUCCESS" {
            let video_url = query.video_url
                .or(query.url.clone())
                .or_else(|| {
                    if let Some(ref d) = query.data {
                        d.get("video_url").and_then(|v| v.as_str()).map(|s| s.to_string())
                            .or_else(|| d.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    } else if let Some(ref r) = query.result {
                        r.get("video_url").and_then(|v| v.as_str()).map(|s| s.to_string())
                            .or_else(|| r.get("url").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    } else {
                        None
                    }
                });

            if let Some(url) = video_url {
                return Ok(VideoResult {
                    video_url: Some(url),
                    thumbnail_url: None,
                    error: None,
                    progress: Some("100%".to_string()),
                });
            }
        }

        if st == "failed" || st == "error" || st == "ERROR" || st == "FAILED" {
            let err_msg = query.error
                .and_then(|e| e.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "视频生成失败".to_string());
            return Ok(VideoResult {
                video_url: None,
                thumbnail_url: None,
                error: Some(err_msg),
                progress: None,
            });
        }

        let pct = query.progress
            .and_then(|v| {
                v.as_i64().map(|i| i.to_string())
                    .or_else(|| v.as_str().map(|s| s.to_string()))
            })
            .unwrap_or_default();

        if !pct.is_empty() {
            // continue polling with progress info
            eprintln!("[video] progress: {}%", pct);
        }
    }

    Ok(VideoResult {
        video_url: None,
        thumbnail_url: None,
        error: Some("视频生成超时（15分钟），请稍后重试".to_string()),
        progress: None,
    })
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
            if dst.exists() {
                let _ = fs::remove_dir_all(&dst);
            }
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
    Ok(format!("http://{}:{}/mcp", local_ip, MCP_PORT))
}

// ──────────────────────────── MCP HTTP Server Lifecycle ────────────────────

struct McpServerState(Mutex<Option<Child>>);

impl Default for McpServerState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

fn is_mcp_port_listening(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        std::time::Duration::from_millis(500),
    )
    .is_ok()
}

fn resolve_project_root() -> Option<PathBuf> {
    let from_manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .to_path_buf();
    if from_manifest.join("scripts/mcp-http-server.ts").exists() {
        return Some(from_manifest);
    }

    let mut dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    for _ in 0..8 {
        if dir.join("scripts/mcp-http-server.ts").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

fn find_node_executable() -> Option<PathBuf> {
    let probe = |cmd: &Path| {
        let mut command = Command::new(cmd);
        command.arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command.status().ok().map(|s| s.success()).unwrap_or(false)
    };

    if probe(Path::new("node")) {
        return Some(PathBuf::from("node"));
    }

    #[cfg(windows)]
    {
        let candidates: Vec<PathBuf> = [
            std::env::var("ProgramFiles").ok().map(|p| PathBuf::from(p).join("nodejs").join("node.exe")),
            std::env::var("ProgramFiles(x86)").ok().map(|p| PathBuf::from(p).join("nodejs").join("node.exe")),
            std::env::var("LOCALAPPDATA").ok().map(|p| PathBuf::from(p).join("Programs").join("node").join("node.exe")),
        ]
        .into_iter()
        .flatten()
        .collect();

        for candidate in candidates {
            if candidate.exists() && probe(&candidate) {
                return Some(candidate);
            }
        }
    }

    None
}

fn spawn_mcp_http_server(state: &McpServerState) {
    if is_mcp_port_listening(MCP_PORT) {
        eprintln!("[mcp] Port {} already in use, skipping auto-start", MCP_PORT);
        return;
    }

    let root = match resolve_project_root() {
        Some(r) => r,
        None => {
            eprintln!("[mcp] Could not find scripts/mcp-http-server.ts");
            return;
        }
    };

    let script = root.join("scripts").join("mcp-http-server.ts");
    let tsx_cli = root.join("node_modules").join("tsx").join("dist").join("cli.mjs");
    if !tsx_cli.exists() {
        eprintln!("[mcp] tsx not found; run npm install in project root first");
        return;
    }

    let node = match find_node_executable() {
        Some(n) => n,
        None => {
            eprintln!("[mcp] Node.js not found; install Node.js to auto-start MCP server");
            return;
        }
    };

    let mut cmd = Command::new(&node);
    cmd.arg(&tsx_cli)
        .arg(&script)
        .current_dir(&root)
        .env("MCP_PORT", MCP_PORT.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    match cmd.spawn() {
        Ok(child) => {
            eprintln!("[mcp] Starting HTTP server on port {}", MCP_PORT);
            if let Ok(mut guard) = state.0.lock() {
                *guard = Some(child);
            }
        }
        Err(err) => eprintln!("[mcp] Failed to start HTTP server: {}", err),
    }
}

fn stop_mcp_http_server(state: &McpServerState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[mcp] HTTP server stopped");
        }
    }
}

// ──────────────────────────── LLM Commands ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct LlmChatMessage {
    role: String,
    content: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmRequest {
    model: String,
    messages: Vec<LlmChatMessage>,
    max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmChoice {
    message: LlmChoiceMessage,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmResponse {
    choices: Vec<LlmChoice>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmResult {
    content: String,
    error: Option<String>,
}

#[tauri::command]
async fn llm_chat(
    api_url: String,
    api_key: String,
    model: String,
    prompt: String,
    image_base64: String,
) -> Result<LlmResult, String> {
    let image_url = if image_base64.starts_with("data:") {
        image_base64.clone()
    } else {
        format!("data:image/png;base64,{}", image_base64)
    };

    let user_content = serde_json::json!([
        {
            "type": "text",
            "text": prompt
        },
        {
            "type": "image_url",
            "image_url": {
                "url": image_url,
                "detail": "high"
            }
        }
    ]);

    let payload = LlmRequest {
        model: model.clone(),
        messages: vec![LlmChatMessage {
            role: "user".to_string(),
            content: user_content,
        }],
        max_tokens: Some(4096),
    };

    let request = HTTP_CLIENT
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload);

    let resp = match send_with_retry(request, 1).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(LlmResult {
                content: String::new(),
                error: Some(format!("请求失败: {}", e)),
            });
        }
    };

    let body = resp.text().await.map_err(|e| e.to_string())?;

    let parsed: LlmResponse = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(e) => {
            return Ok(LlmResult {
                content: String::new(),
                error: Some(format!("解析响应失败: {} / body: {}", e, &body[..body.len().min(200)])),
            });
        }
    };

    if let Some(err) = parsed.error {
        return Ok(LlmResult {
            content: String::new(),
            error: Some(err.to_string()),
        });
    }

    if let Some(choice) = parsed.choices.first() {
        let content = choice.message.content.clone().unwrap_or_default();
        Ok(LlmResult { content, error: None })
    } else {
        Ok(LlmResult {
            content: String::new(),
            error: Some("模型未返回任何内容".to_string()),
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmModelsResponse {
    data: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LlmModelInfo {
    id: String,
}

#[tauri::command]
async fn fetch_llm_models(api_key: String, api_url: String) -> Result<Vec<LlmModelInfo>, String> {
    let models_url = format!("{}/models", api_url.trim_end_matches('/'));

    let request = HTTP_CLIENT
        .get(&models_url)
        .header("Authorization", format!("Bearer {}", api_key));

    let resp = request.send().await.map_err(|e| e.to_string())?;
    let body = resp.text().await.map_err(|e| e.to_string())?;

    let parsed: LlmModelsResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let models: Vec<LlmModelInfo> = parsed.data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_str()?.to_string();
            let lower = id.to_lowercase();
            if lower.contains("image") || lower.contains("dall") || lower.contains("flux") {
                return None;
            }
            let vision_keywords = ["gpt-4", "gpt-4o", "gpt-4.1", "claude", "gemini", "qwen-vl", "llava", "glm-4v", "internvl"];
            let is_vision = vision_keywords.iter().any(|kw| lower.contains(kw));
            if is_vision || !lower.contains("image") {
                Some(LlmModelInfo { id })
            } else {
                None
            }
        })
        .collect();

    Ok(models)
}

// ──────────────────────────── Extract Sessions ────────────────────────────

#[tauri::command]
fn save_extract_sessions(app: tauri::AppHandle, sessions: serde_json::Value) -> Result<(), String> {
    let path = app_data_dir(&app)
        .ok_or_else(|| "Cannot determine app data dir".to_string())?
        .join("extract_sessions.json");
    
    let json = serde_json::to_string(&sessions).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn load_extract_sessions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app_data_dir(&app)
        .ok_or_else(|| "Cannot determine app data dir".to_string())?
        .join("extract_sessions.json");
    
    if !path.exists() {
        return Ok(serde_json::json!([]));
    }
    
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let sessions: serde_json::Value = serde_json::from_str(&json)
        .unwrap_or(serde_json::json!([]));
    
    Ok(sessions)
}

// ──────────────────────────── Main ────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-features=TrackingPrevention");
    std::env::set_var("WEBVIEW2_TRACKING_PREVENTION", "0");

    tauri::Builder::default()
        .manage(AppState(Arc::new(Mutex::new(Inner::default()))))
        .manage(McpServerState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<AppState>().inner().clone();
            let mcp_state = app.state::<McpServerState>();
            spawn_mcp_http_server(&mcp_state);

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
            generate_video,
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
            llm_chat,
            fetch_llm_models,
            save_extract_sessions,
            load_extract_sessions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(mcp_state) = app_handle.try_state::<McpServerState>() {
                    stop_mcp_http_server(&mcp_state);
                }
            }
        });
}
