use serde::{Deserialize, Serialize};

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
struct ImageResult {
    images: Vec<String>,
    error: Option<String>,
}

#[tauri::command]
fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_maximize(window: tauri::Window) {
    let _ = window.maximize();
}

#[tauri::command]
async fn generate_image(
    prompt: String,
    api_key: String,
    size: String,
    n: u32,
    reference_images: Option<Vec<String>>,
    response_format: String,
) -> Result<ImageResult, String> {
    let client = reqwest::Client::new();
    let api_url = "https://www.hfsyapi.cn/v1/images/generations";

    let payload = GenRequest {
        model: "gpt-image-2".to_string(),
        prompt: prompt.clone(),
        reference_images: reference_images.filter(|v| !v.is_empty()),
        size: size.clone(),
        n,
        response_format: response_format.clone(),
    };

    let resp = client
        .post(api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(180))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        return Ok(ImageResult {
            images: vec![],
            error: Some(format!("HTTP {}: {}", status, body_text)),
        });
    }

    let gen_resp: GenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析响应失败: {} | body: {}", e, &body_text[..body_text.len().min(500)]))?;

    if let Some(ref s) = gen_resp.status {
        if s == "FAILED" || s == "ERROR" {
            return Ok(ImageResult {
                images: vec![],
                error: Some(gen_resp.fail_reason.unwrap_or_else(|| body_text.clone())),
            });
        }
    }

    let mut images = Vec::new();

    if let Some(url) = gen_resp.result_url {
        if !url.is_empty() {
            images.push(url);
        }
    }

    if images.is_empty() {
        if let Some(data_arr) = gen_resp.data {
            for item in data_arr {
                if let Some(b64) = item.b64_json {
                    let data_url = format!("data:image/png;base64,{}", b64);
                    images.push(data_url);
                } else if let Some(url) = item.url {
                    images.push(url);
                }
            }
        }
    }

    if images.is_empty() && gen_resp.task_id.is_some() {
        let task_id = gen_resp.task_id.unwrap();
        let poll_url = format!("https://www.hfsyapi.cn/v1/images/generations/{}", task_id);

        for _ in 0..60 {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;

            let poll_resp = client
                .get(&poll_url)
                .header("Authorization", format!("Bearer {}", api_key))
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await
                .map_err(|e| format!("轮询失败: {}", e))?;

            let poll_text = poll_resp.text().await.map_err(|e| format!("读取轮询响应失败: {}", e))?;
            let poll_data: GenResponse = serde_json::from_str(&poll_text)
                .map_err(|e| format!("解析轮询响应失败: {}", e))?;

            if let Some(ref s) = poll_data.status {
                if s == "SUCCESS" {
                    if let Some(url) = poll_data.result_url {
                        if !url.is_empty() {
                            images.push(url);
                            break;
                        }
                    }
                    if let Some(data_arr) = poll_data.data {
                        for item in data_arr {
                            if let Some(b64) = item.b64_json {
                                let data_url = format!("data:image/png;base64,{}", b64);
                                images.push(data_url);
                            } else if let Some(url) = item.url {
                                images.push(url);
                            }
                        }
                        break;
                    }
                } else if s == "FAILED" || s == "ERROR" {
                    return Ok(ImageResult {
                        images: vec![],
                        error: Some(poll_data.fail_reason.unwrap_or_else(|| "生成失败".to_string())),
                    });
                }
            }
        }

        if images.is_empty() {
            return Ok(ImageResult {
                images: vec![],
                error: Some("生成超时（5分钟），请稍后重试".to_string()),
            });
        }
    }

    Ok(ImageResult {
        images,
        error: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            generate_image,
            window_close,
            window_minimize,
            window_maximize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
