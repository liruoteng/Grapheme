pub use crate::ai_stream::AiCancelFlag;
use crate::ai_stream::{LineDecoder, ToolInput};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command as TokioCommand;

// ── Cancellation flag ──────────────────────────────────────────────────────

#[tauri::command]
pub fn cancel_ai_stream(cancel: tauri::State<AiCancelFlag>) {
    cancel.cancel();
}

// ── Shared types ───────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default, rename = "toolCalls")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default, rename = "toolCallId")]
    pub tool_call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

// ── Claude CLI ────────────────────────────────────────────────────────────

fn extended_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let extras = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/Applications/ChatGPT.app/Contents/Resources",
    ];
    let mut parts: Vec<String> = extras
        .iter()
        .filter(|p| !current.contains(*p))
        .map(|p| p.to_string())
        .collect();
    parts.push(current);
    parts.join(":")
}

#[tauri::command]
pub async fn check_codex_cli() -> String {
    let ok = TokioCommand::new("codex")
        .arg("--version")
        .env("PATH", extended_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        "ready".to_string()
    } else {
        "not_found".to_string()
    }
}

#[tauri::command]
pub async fn get_codex_cli_version() -> String {
    TokioCommand::new("codex")
        .arg("--version")
        .env("PATH", extended_path())
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            (!version.is_empty()).then_some(version)
        })
        .unwrap_or_else(|| "unavailable".to_string())
}

#[derive(Serialize, Clone)]
pub struct CodexModelInfo {
    pub id: String,
    pub label: String,
    pub default_effort: String,
    pub efforts: Vec<String>,
    pub context_window: u64,
    pub is_default: bool,
}

#[derive(Deserialize)]
struct CodexModelsCache {
    models: Vec<CodexCachedModel>,
}

#[derive(Deserialize)]
struct CodexCachedModel {
    slug: String,
    display_name: String,
    #[serde(default)]
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevel>,
    #[serde(default)]
    visibility: Option<String>,
    #[serde(default)]
    context_window: Option<u64>,
}

#[derive(Deserialize)]
struct CodexReasoningLevel {
    effort: String,
}

fn codex_home() -> PathBuf {
    if let Ok(path) = std::env::var("CODEX_HOME") {
        return PathBuf::from(path);
    }
    #[cfg(windows)]
    if let Ok(path) = std::env::var("USERPROFILE") {
        return PathBuf::from(path).join(".codex");
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".codex")
}

fn codex_config_value(name: &str) -> Option<String> {
    let contents = std::fs::read_to_string(codex_home().join("config.toml")).ok()?;
    contents.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != name {
            return None;
        }
        Some(
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string(),
        )
    })
}

/// Read the same model catalog used by the installed Codex app/CLI.
/// Missing or stale local metadata is reported as an empty list so the UI can
/// keep its default fallback and still allow chat to work.
#[tauri::command]
pub fn list_codex_models() -> Result<Vec<CodexModelInfo>, String> {
    let cache_path = codex_home().join("models_cache.json");
    let contents = match std::fs::read_to_string(cache_path) {
        Ok(contents) => contents,
        Err(_) => return Ok(Vec::new()),
    };
    let cache: CodexModelsCache = serde_json::from_str(&contents)
        .map_err(|e| format!("could not parse Codex model catalog: {e}"))?;
    let configured_model = codex_config_value("model");

    Ok(cache
        .models
        .into_iter()
        .filter(|model| model.visibility.as_deref().unwrap_or("list") == "list")
        .map(|model| {
            let efforts = model
                .supported_reasoning_levels
                .into_iter()
                .map(|level| level.effort)
                .collect::<Vec<_>>();
            let default_effort = model.default_reasoning_level.unwrap_or_else(|| {
                efforts
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "medium".to_string())
            });
            CodexModelInfo {
                is_default: configured_model.as_deref() == Some(model.slug.as_str()),
                id: model.slug,
                label: model.display_name,
                default_effort,
                efforts,
                context_window: model.context_window.unwrap_or(200_000),
            }
        })
        .collect())
}

fn codex_context_window(model_id: Option<&str>) -> u64 {
    model_id
        .and_then(|id| {
            list_codex_models()
                .ok()?
                .into_iter()
                .find(|model| model.id == id)
                .map(|model| model.context_window)
        })
        .unwrap_or(200_000)
}

fn validate_cli_session_id(session_id: Option<&str>) -> Result<(), String> {
    if let Some(id) = session_id {
        if id.is_empty()
            || id.len() > 200
            || id.starts_with('-')
            || !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("Invalid AI session ID".into());
        }
    }
    Ok(())
}

/// Run Codex through its authenticated local CLI. This deliberately uses a
/// read-only sandbox: the AI panel is a writing assistant, not a code agent.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_codex_cli(
    session_id: Option<String>,
    message: String,
    system: String,
    model: Option<String>,
    effort: Option<String>,
    cwd: Option<String>,
    on_chunk: Channel<String>,
    on_status: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<Option<String>, String> {
    validate_cli_session_id(session_id.as_deref())?;
    cancel.run(async {
        let mut cmd = TokioCommand::new("codex");
        cmd.env("PATH", extended_path());
        let context_window = codex_context_window(model.as_deref());

        if let Some(ref sid) = session_id {
            cmd.args(["exec", "resume", sid, "--all"]);
        } else {
            cmd.args(["exec", "--sandbox", "read-only", "--skip-git-repo-check"]);
            if let Some(ref dir) = cwd {
                cmd.args(["--cd", dir]);
            }
        }
        // Resume must retain the same sandbox as a new writing conversation.
        cmd.args(["-c", "sandbox_mode=\"read-only\"", "-c", "approval_policy=\"never\""]);
        cmd.arg("--json");
        if let Some(ref m) = model.filter(|m| !m.is_empty()) {
            cmd.args(["--model", m]);
        }
        if let Some(ref e) = effort.filter(|e| !e.is_empty()) {
            cmd.arg("-c").arg(format!("model_reasoning_effort={}", serde_json::to_string(e).map_err(|error| error.to_string())?));
        }

        let prompt = if system.is_empty() {
            message
        } else {
            format!("System instructions:\n{system}\n\nUser request:\n{message}")
        };
        cmd.arg("--").arg(prompt)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.kill_on_drop(true).spawn().map_err(|e| {
            format!("Codex CLI not found: {e}. Install Codex and run `codex login` to authenticate.")
        })?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex CLI stdout unavailable".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Codex CLI stderr unavailable".to_string())?;
        let stderr_task = tokio::spawn(async move {
            let mut out = String::new();
            BufReader::new(stderr).read_to_string(&mut out).await.ok();
            out
        });

        let mut lines = BufReader::new(stdout).lines();
        let mut thread_id = None;
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if let Some(usage) = event["usage"].as_object() {
                let used = usage["input_tokens"]
                    .as_u64()
                    .or_else(|| usage["total_tokens"].as_u64())
                    .unwrap_or(0);
                if used > 0 {
                    let window = event["context_window"]
                        .as_u64()
                        .or_else(|| event["model_context_window"].as_u64())
                        .unwrap_or(context_window);
                    let _ = on_status.send(format!(
                        r#"{{"t":"usage","used":{used},"window":{window}}}"#
                    ));
                }
            }
            match event["type"].as_str() {
                Some("thread.started") => {
                    thread_id = event["thread_id"].as_str().map(str::to_string);
                }
                Some("item.completed") => {
                    if event["item"]["type"].as_str() == Some("agent_message") {
                        if let Some(text) = event["item"]["text"].as_str() {
                            on_chunk.send(text.to_string()).map_err(|e| e.to_string())?;
                        }
                    }
                }
                Some("item.started") if event["item"]["type"].as_str() == Some("reasoning") => {
                    let _ = on_status.send("Codex is thinking…".to_string());
                }
                Some("turn.failed") | Some("error") => {
                    let msg = event["error"]["message"]
                        .as_str()
                        .or_else(|| event["message"].as_str())
                        .unwrap_or("Codex CLI returned an error");
                    return Err(msg.to_string());
                }
                _ => {}
            }
        }
        let status = child.wait().await.map_err(|e| e.to_string())?;
        let stderr_output = stderr_task.await.unwrap_or_default();
        if !status.success() {
            return Err(if stderr_output.trim().is_empty() {
                "Codex CLI failed. Make sure Codex is installed and authenticated with `codex login`."
                    .to_string()
            } else {
                stderr_output.trim().to_string()
            });
        }
        Ok(thread_id)
    }).await
}

#[tauri::command]
pub async fn check_claude_cli() -> String {
    let ok = TokioCommand::new("claude")
        .arg("--version")
        .env("PATH", extended_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        "ready".to_string()
    } else {
        "not_found".to_string()
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_claude_cli(
    session_id: Option<String>,
    message: String,
    system: String,
    model: Option<String>,
    effort: Option<String>,
    thinking: bool,
    on_chunk: Channel<String>,
    on_status: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<Option<String>, String> {
    validate_cli_session_id(session_id.as_deref())?;
    cancel.run(async {
        let mut cmd = TokioCommand::new("claude");
        cmd.env("PATH", extended_path())
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("-p")
            // Grapheme supplies document context and applies edits itself.
            // Native CLI tools must not bypass its document/approval boundary.
            .args(["--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--disable-slash-commands"])
            .args(["--settings", "{\"disableAllHooks\":true}"]);


        if let Some(ref sid) = session_id {
            cmd.arg("--resume").arg(sid);
        }
        if !system.is_empty() {
            cmd.arg("--system-prompt").arg(&system);
        }

        if let Some(ref m) = model {
            cmd.arg("--model").arg(m);
        }

        if let Some(ref e) = effort {
            cmd.arg("--effort").arg(e);
        }

        if thinking {
            cmd.env("MAX_THINKING_TOKENS", "10000");
        }

        cmd.arg("--").arg(&message);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.kill_on_drop(true).spawn().map_err(|e| {
            format!("Claude CLI not found: {e}. Install with: npm install -g @anthropic-ai/claude-code")
        })?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let stderr_task = tokio::spawn(async move {
            let mut out = String::new();
            BufReader::new(stderr).read_to_string(&mut out).await.ok();
            out
        });

        let mut lines = BufReader::new(stdout).lines();
        let mut new_session_id: Option<String> = None;

        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            if line.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };

            match event["type"].as_str() {
                Some("assistant") => {
                    if let Some(content) = event["message"]["content"].as_array() {
                        for block in content {
                            match block["type"].as_str() {
                                Some("thinking") => {
                                    if let Some(t) = block["thinking"].as_str() {
                                        let hint: String = t.chars().take(200).collect();
                                        let text_json =
                                            serde_json::to_string(&hint).unwrap_or_default();
                                        let _ = on_status
                                            .send(format!(r#"{{"t":"thinking","text":{text_json}}}"#));
                                    }
                                }
                                Some("text") => {
                                    if let Some(text) = block["text"].as_str() {
                                        if !text.is_empty() {
                                            on_chunk
                                                .send(text.to_string())
                                                .map_err(|e| e.to_string())?;
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Some("system") | Some("result") => {
                    if let Some(sid) = event["session_id"].as_str() {
                        new_session_id = Some(sid.to_string());
                    }
                    if event["type"].as_str() == Some("result") {
                        if event["subtype"].as_str().is_some_and(|s| s != "success") {
                            let msg = event["error"]
                                .as_str()
                                .unwrap_or("Claude CLI returned an error");
                            return Err(msg.to_string());
                        }
                        // Emit actual token usage so the frontend can show a real context %
                        let u = &event["usage"];
                        let used = u["input_tokens"].as_u64().unwrap_or(0)
                            + u["cache_read_input_tokens"].as_u64().unwrap_or(0)
                            + u["cache_creation_input_tokens"].as_u64().unwrap_or(0);
                        let window = event["modelUsage"]
                            .as_object()
                            .and_then(|m| m.values().next())
                            .and_then(|v| v["contextWindow"].as_u64())
                            .unwrap_or(200_000);
                        if used > 0 {
                            let _ = on_status.send(format!(
                                r#"{{"t":"usage","used":{used},"window":{window}}}"#
                            ));
                        }
                    }
                }
                _ => {}
            }
        }

        let status = child.wait().await.map_err(|e| e.to_string())?;
        let stderr_output = stderr_task.await.unwrap_or_default();

        if !status.success() {
            return Err(if stderr_output.trim().is_empty() {
                "Claude CLI failed. Make sure you are authenticated — run `claude` in your terminal."
                    .to_string()
            } else {
                stderr_output.trim().to_string()
            });
        }

        Ok(new_session_id)
    }).await
}

// ── Tool calling types ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub input: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
#[allow(dead_code)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
    pub is_error: bool,
}

// ── Ollama streaming ───────────────────────────────────────────────────────

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<OllamaTool<'a>>>,
}

#[derive(Serialize)]
struct OllamaTool<'a> {
    #[serde(rename = "type")]
    tool_type: &'a str,
    function: OllamaToolFunction<'a>,
}

#[derive(Serialize)]
struct OllamaToolFunction<'a> {
    name: &'a str,
    description: &'a str,
    parameters: &'a serde_json::Value,
}

#[derive(Serialize)]
struct OllamaMessage<'a> {
    role: &'a str,
    content: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_calls: Option<Vec<OllamaToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_name: Option<&'a str>,
}

#[derive(Serialize, Deserialize, Clone)]
struct OllamaToolCall {
    function: OllamaToolCallFunction,
}

#[derive(Serialize, Deserialize, Clone)]
struct OllamaToolCallFunction {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiStreamEvent {
    TextDelta {
        text: String,
    },
    ToolCall {
        #[serde(rename = "toolCall")]
        tool_call: ToolCall,
    },
}

enum AiOutput<'a> {
    Text(&'a Channel<String>),
    Events(&'a Channel<AiStreamEvent>),
}

impl AiOutput<'_> {
    fn text(&self, text: &str) -> Result<(), String> {
        match self {
            Self::Text(channel) => channel.send(text.to_string()),
            Self::Events(channel) => channel.send(AiStreamEvent::TextDelta {
                text: text.to_string(),
            }),
        }
        .map_err(|e| e.to_string())
    }

    fn tool_call(&self, tool_call: ToolCall) -> Result<(), String> {
        match self {
            Self::Events(channel) => channel
                .send(AiStreamEvent::ToolCall { tool_call })
                .map_err(|e| e.to_string()),
            Self::Text(_) => Err("Unexpected tool call in a text-only response".into()),
        }
    }
}

async fn stream_ollama(
    client: &Client,
    messages: &[ChatMessage],
    base_url: &str,
    model: &str,
    system: &str,
    on_chunk: &Channel<String>,
) -> Result<(), String> {
    stream_ollama_with_tools(
        client,
        messages,
        base_url,
        model,
        system,
        &[],
        &AiOutput::Text(on_chunk),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn stream_ollama_with_tools(
    client: &Client,
    messages: &[ChatMessage],
    base_url: &str,
    model: &str,
    system: &str,
    tools: &[ToolDefinition],
    output: &AiOutput<'_>,
) -> Result<(), String> {
    let mut ollama_messages: Vec<OllamaMessage> = vec![OllamaMessage {
        role: "system",
        content: system,
        tool_calls: None,
        tool_name: None,
    }];
    for m in messages {
        ollama_messages.push(OllamaMessage {
            role: &m.role,
            content: &m.content,
            tool_calls: if m.tool_calls.is_empty() {
                None
            } else {
                Some(
                    m.tool_calls
                        .iter()
                        .map(|call| OllamaToolCall {
                            function: OllamaToolCallFunction {
                                name: call.name.clone(),
                                arguments: call.input.clone(),
                            },
                        })
                        .collect(),
                )
            },
            tool_name: m.name.as_deref(),
        });
    }

    let ollama_tools: Option<Vec<OllamaTool>> = if tools.is_empty() {
        None
    } else {
        Some(
            tools
                .iter()
                .map(|t| OllamaTool {
                    tool_type: "function",
                    function: OllamaToolFunction {
                        name: &t.name,
                        description: &t.description,
                        parameters: &t.parameters,
                    },
                })
                .collect(),
        )
    };

    // Ollama tool calling requires stream: false
    let use_streaming = tools.is_empty();

    let body = serde_json::to_string(&OllamaRequest {
        model,
        messages: ollama_messages,
        stream: use_streaming,
        tools: ollama_tools,
    })
    .map_err(|e| e.to_string())?;

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {url}: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error {status}: {body}"));
    }

    if !use_streaming {
        // Non-streaming response (for tool calls)
        let response_text = resp.text().await.map_err(|e| e.to_string())?;
        let event: serde_json::Value =
            serde_json::from_str(&response_text).map_err(|e| e.to_string())?;
        if let Some(error) = event["error"].as_str() {
            return Err(format!("Ollama error: {error}"));
        }

        // Send text content
        if let Some(text) = event["message"]["content"].as_str() {
            if !text.is_empty() {
                output.text(text)?;
            }
        }

        // Keep native tool calls separate from model-generated text.
        if let Some(tool_calls) = event["message"]["tool_calls"].as_array() {
            for (i, tc) in tool_calls.iter().enumerate() {
                if let Some(func) = tc["function"].as_object() {
                    let name = func["name"].as_str().unwrap_or("");
                    let args = &func["arguments"];
                    let tool_call = ToolCall {
                        id: format!("call_{}", i),
                        name: name.to_string(),
                        input: args.clone(),
                    };
                    output.tool_call(tool_call)?;
                }
            }
        }
        return Ok(());
    }

    // Streaming response (no tools).
    let mut byte_stream = resp.bytes_stream();
    let mut decoder = LineDecoder::default();
    while let Some(chunk) = byte_stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        for line in decoder.push(&chunk)? {
            if emit_ollama_line(&line, output)? {
                return Ok(());
            }
        }
    }
    if let Some(line) = decoder.finish()? {
        if emit_ollama_line(&line, output)? {
            return Ok(());
        }
    }
    Err("Ollama stream ended before completion".into())
}

fn emit_ollama_line(line: &str, output: &AiOutput<'_>) -> Result<bool, String> {
    if line.trim().is_empty() {
        return Ok(false);
    }
    let event: serde_json::Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
    if let Some(error) = event["error"].as_str() {
        return Err(format!("Ollama error: {error}"));
    }
    if let Some(text) = event["message"]["content"]
        .as_str()
        .filter(|text| !text.is_empty())
    {
        output.text(text)?;
    }
    Ok(event["done"].as_bool().unwrap_or(false))
}

// ── Public command ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn stream_ai_chat(
    messages: Vec<ChatMessage>,
    ollama_url: String,
    ollama_model: String,
    system: String,
    on_chunk: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<(), String> {
    cancel
        .run(async {
            let client = Client::new();
            stream_ollama(
                &client,
                &messages,
                &ollama_url,
                &ollama_model,
                &system,
                &on_chunk,
            )
            .await
        })
        .await
}

// ── Tool-enabled Ollama chat ──────────────────────────────────────────────

#[tauri::command]
pub async fn stream_ai_chat_with_tools(
    messages: Vec<ChatMessage>,
    ollama_url: String,
    ollama_model: String,
    system: String,
    tools: Vec<ToolDefinition>,
    on_chunk: Channel<AiStreamEvent>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<(), String> {
    cancel
        .run(async {
            let client = Client::new();
            stream_ollama_with_tools(
                &client,
                &messages,
                &ollama_url,
                &ollama_model,
                &system,
                &tools,
                &AiOutput::Events(&on_chunk),
            )
            .await
        })
        .await
}

// ── Claude API with native tool calling ───────────────────────────────────

#[derive(Serialize)]
struct ClaudeApiRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<ClaudeApiMessage<'a>>,
    tools: Vec<ClaudeApiTool<'a>>,
    stream: bool,
}

#[derive(Serialize)]
struct ClaudeApiMessage<'a> {
    role: &'a str,
    content: serde_json::Value,
}

#[derive(Serialize)]
struct ClaudeApiTool<'a> {
    name: &'a str,
    description: &'a str,
    input_schema: &'a serde_json::Value,
}

fn claude_messages(messages: &[ChatMessage]) -> Result<Vec<ClaudeApiMessage<'_>>, String> {
    messages.iter().map(|message| {
        if message.role == "tool" {
            let id = message.tool_call_id.as_ref().ok_or("Tool result is missing its call ID")?;
            return Ok(ClaudeApiMessage {
                role: "user",
                content: serde_json::json!([{
                    "type": "tool_result", "tool_use_id": id, "content": message.content
                }]),
            });
        }
        if message.tool_calls.is_empty() {
            return Ok(ClaudeApiMessage { role: &message.role, content: serde_json::json!(message.content) });
        }
        let mut blocks = Vec::new();
        if !message.content.is_empty() {
            blocks.push(serde_json::json!({ "type": "text", "text": message.content }));
        }
        for call in &message.tool_calls {
            blocks.push(serde_json::json!({ "type": "tool_use", "id": call.id, "name": call.name, "input": call.input }));
        }
        Ok(ClaudeApiMessage { role: &message.role, content: serde_json::Value::Array(blocks) })
    }).collect()
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn stream_claude_api(
    api_key: String,
    messages: Vec<ChatMessage>,
    model: String,
    system: String,
    tools: Vec<ToolDefinition>,
    on_chunk: Channel<AiStreamEvent>,
    on_status: Channel<String>,
    cancel: tauri::State<'_, AiCancelFlag>,
) -> Result<(), String> {
    cancel
        .run(async {
            let client = Client::new();

            let claude_messages = claude_messages(&messages)?;

            let claude_tools: Vec<ClaudeApiTool> = tools
                .iter()
                .map(|t| ClaudeApiTool {
                    name: &t.name,
                    description: &t.description,
                    input_schema: &t.parameters,
                })
                .collect();

            let body = serde_json::to_string(&ClaudeApiRequest {
                model: &model,
                max_tokens: 8192,
                system: &system,
                messages: claude_messages,
                tools: claude_tools,
                stream: true,
            })
            .map_err(|e| e.to_string())?;

            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .body(body)
                .send()
                .await
                .map_err(|e| format!("Claude API error: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status().as_u16();
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("Claude API error {status}: {body}"));
            }

            let mut byte_stream = resp.bytes_stream();
            let mut decoder = LineDecoder::default();
            let mut current_tool_use: Option<ToolInput> = None;
            let output = AiOutput::Events(&on_chunk);

            while let Some(chunk) = byte_stream.next().await {
                let chunk = chunk.map_err(|e| e.to_string())?;
                for line in decoder.push(&chunk)? {
                    if !line.starts_with("data: ") {
                        continue;
                    }
                    let data = &line[6..];
                    if data == "[DONE]" {
                        return Ok(());
                    }

                    let Ok(event): Result<serde_json::Value, _> = serde_json::from_str(data) else {
                        continue;
                    };

                    match event["type"].as_str() {
                        Some("message_stop") => return Ok(()),
                        Some("error") => {
                            return Err(format!("Claude API error: {}", event["error"]))
                        }
                        Some("content_block_start") => {
                            let block = &event["content_block"];
                            match block["type"].as_str() {
                                Some("text") => {
                                    if let Some(text) = block["text"].as_str() {
                                        if !text.is_empty() {
                                            output.text(text)?;
                                        }
                                    }
                                }
                                Some("tool_use") => {
                                    current_tool_use = Some(ToolInput {
                                        id: block["id"].as_str().unwrap_or("").to_string(),
                                        name: block["name"].as_str().unwrap_or("").to_string(),
                                        json: String::new(),
                                    });
                                }
                                _ => {}
                            }
                        }
                        Some("content_block_delta") => {
                            let delta = &event["delta"];
                            match delta["type"].as_str() {
                                Some("text_delta") => {
                                    if let Some(text) = delta["text"].as_str() {
                                        if !text.is_empty() {
                                            output.text(text)?;
                                        }
                                    }
                                }
                                Some("input_json_delta") => {
                                    if let Some(partial) = delta["partial_json"].as_str() {
                                        if let Some(ref mut tool_use) = current_tool_use {
                                            tool_use.json.push_str(partial);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        Some("content_block_stop") => {
                            if let Some(tool_use) = current_tool_use.take() {
                                let input = tool_use.finish()?;
                                let tc = ToolCall {
                                    id: tool_use.id,
                                    name: tool_use.name,
                                    input,
                                };
                                output.tool_call(tc)?;
                            }
                        }
                        Some("message_delta") => {
                            // Emit usage info
                            if let Some(usage) = event["usage"].as_object() {
                                let output_tokens = usage["output_tokens"].as_u64().unwrap_or(0);
                                let _ = on_status.send(format!(
                                    r#"{{"t":"usage","output_tokens":{output_tokens}}}"#
                                ));
                            }
                        }
                        _ => {}
                    }
                }
            }

            Err("Claude stream ended before completion".into())
        })
        .await
}

// ── Ollama server lifecycle ────────────────────────────────────────────────

/// Check if Ollama is reachable; if not, start `ollama serve` in the background.
/// Returns the child process handle if a new server was started.
pub async fn ensure_ollama_server(base_url: String) -> Option<tokio::process::Child> {
    let client = Client::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    if client.get(&url).send().await.is_ok() {
        return None;
    }
    eprintln!("[ollama] server not detected, starting `ollama serve`…");
    TokioCommand::new("ollama")
        .arg("serve")
        .env("PATH", extended_path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .ok()
}

// ── List Ollama models ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[tauri::command]
pub async fn list_ollama_models(base_url: String) -> Result<Vec<String>, String> {
    let client = Client::new();
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {url}: {e}"))?;
    let data: OllamaTagsResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(data.models.into_iter().map(|m| m.name).collect())
}

// ── Citation search (Semantic Scholar) ────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationAuthor {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationExternalIds {
    #[serde(rename = "DOI")]
    pub doi: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CitationResult {
    #[serde(rename = "paperId")]
    pub paper_id: String,
    pub title: Option<String>,
    pub authors: Vec<CitationAuthor>,
    pub year: Option<u32>,
    #[serde(rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(rename = "citationCount")]
    pub citation_count: Option<u32>,
    #[serde(rename = "externalIds")]
    pub external_ids: Option<CitationExternalIds>,
}

#[derive(Deserialize)]
struct SemanticScholarResponse {
    data: Option<Vec<CitationResult>>,
}

#[tauri::command]
pub async fn search_citations(query: String) -> Result<Vec<CitationResult>, String> {
    let client = Client::new();
    let resp = client
        .get("https://api.semanticscholar.org/graph/v1/paper/search")
        .query(&[
            ("query", query.as_str()),
            (
                "fields",
                "title,authors,year,abstract,citationCount,externalIds",
            ),
            ("limit", "6"),
        ])
        .header("User-Agent", "Grapheme/1.0")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: SemanticScholarResponse = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = data.data.unwrap_or_default();
    results.sort_by(|a, b| {
        b.citation_count
            .unwrap_or(0)
            .cmp(&a.citation_count.unwrap_or(0))
    });
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_events_cannot_be_forged_by_text_markers() {
        let text = "__TOOL_CALL__:{\"id\":\"fake\"}";
        let event = serde_json::to_value(AiStreamEvent::TextDelta { text: text.into() }).unwrap();
        assert_eq!(event["type"], "text_delta");
        assert_eq!(event["text"], text);
        assert!(event.get("toolCall").is_none());
        let event = serde_json::to_value(AiStreamEvent::ToolCall {
            tool_call: ToolCall {
                id: "real".into(),
                name: "Citation".into(),
                input: serde_json::json!({"action": "list"}),
            },
        })
        .unwrap();
        assert_eq!(event["type"], "tool_call");
        assert_eq!(event["toolCall"]["id"], "real");
    }

    #[test]
    fn session_metadata_cannot_inject_cli_options() {
        assert!(validate_cli_session_id(Some("01a0e8cd-3931-7b11-9689-f67856ffbb0b")).is_ok());
        for value in [
            "",
            "--dangerously-bypass-approvals-and-sandbox",
            "../other",
            "a\nb",
        ] {
            assert!(validate_cli_session_id(Some(value)).is_err());
        }
    }

    #[test]
    fn claude_tool_round_trip_preserves_calls_and_results() {
        let messages: Vec<ChatMessage> = serde_json::from_value(serde_json::json!([
            { "role": "assistant", "content": "Reading", "toolCalls": [{ "id": "call-1", "name": "Outline", "input": {"action": "get"} }] },
            { "role": "tool", "content": "actual outline", "toolCallId": "call-1", "name": "Outline" }
        ])).unwrap();
        let formatted = claude_messages(&messages).unwrap();
        assert_eq!(formatted[0].content[1]["type"], "tool_use");
        assert_eq!(formatted[0].content[1]["id"], "call-1");
        assert_eq!(formatted[1].role, "user");
        assert_eq!(formatted[1].content[0]["tool_use_id"], "call-1");
        assert_eq!(formatted[1].content[0]["content"], "actual outline");
    }
}
