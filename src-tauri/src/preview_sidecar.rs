//! Sidecar-based preview: spawns `tinymist preview` as a child process,
//! parses the bound data-plane port from its stderr, and exposes the URL
//! to the frontend (which renders it in an <iframe>).
//!
//! This gives us tinymist's full incremental vector-IR pipeline
//! (IncrSvgDocServer + typst.ts WASM renderer) for free, at the cost of
//! an extra process per opened document.

use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const MAX_CACHED_PREVIEWS: usize = 4;

struct PreviewEntry {
    child: Child,
    url: String,
    path: String,
    invert_colors: String,
    last_used: u64,
}

/// Holds recently used preview children and the URLs they're serving.
#[derive(Default)]
pub struct PreviewSidecar {
    entries: Vec<PreviewEntry>,
    next_use: u64,
}

pub type SharedSidecar = Arc<Mutex<PreviewSidecar>>;

impl PreviewSidecar {
    /// Stop every cached preview child. Waits for each one to exit.
    pub async fn stop(&mut self) {
        for mut entry in self.entries.drain(..) {
            let _ = entry.child.kill().await;
            let _ = entry.child.wait().await;
        }
    }
}

/// Spawn `tinymist preview` and return the preview URL once the data-plane
/// port is bound. The HTTP server at that URL serves both the frontend HTML
/// and the WebSocket upgrade — embedding it in an <iframe> is sufficient.
pub async fn start(
    sidecar: &SharedSidecar,
    tinymist_path: &str,
    input_path: &str,
    invert_colors: &str,
) -> Result<String, String> {
    let mut guard = sidecar.lock().await;

    // Reuse only if both the file *and* the invert-colors setting are unchanged.
    if let Some(index) = guard
        .entries
        .iter()
        .position(|entry| entry.path == input_path && entry.invert_colors == invert_colors)
    {
        let child_alive = matches!(guard.entries[index].child.try_wait(), Ok(None));
        if child_alive {
            guard.next_use += 1;
            guard.entries[index].last_used = guard.next_use;
            let url = guard.entries[index].url.clone();
            return Ok(url);
        }

        let mut stale = guard.entries.remove(index);
        let _ = stale.child.wait().await;
    }

    while guard.entries.len() >= MAX_CACHED_PREVIEWS {
        let Some((oldest, _)) = guard
            .entries
            .iter()
            .enumerate()
            .min_by_key(|(_, entry)| entry.last_used)
        else {
            break;
        };
        let mut entry = guard.entries.remove(oldest);
        let _ = entry.child.kill().await;
        let _ = entry.child.wait().await;
    }

    // Resolve the project root so absolute imports (`#import "/foo.typ"`)
    // work. Defaults to the input file's parent directory.
    let root = Path::new(input_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    let mut child = Command::new(tinymist_path)
        .arg("preview")
        .arg("--no-open")
        // Let the OS pick free ports — avoids clashes across documents / runs.
        .arg("--data-plane-host")
        .arg("127.0.0.1:0")
        .arg("--control-plane-host")
        .arg("127.0.0.1:0")
        .arg("--root")
        .arg(&root)
        .arg("--invert-colors")
        .arg(invert_colors)
        .arg(input_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to spawn tinymist preview: {e}"))?;

    let stderr = child.stderr.take().ok_or("no stderr on child")?;
    let mut reader = BufReader::new(stderr).lines();

    // Read lines until we see the "Data plane server listening on: HOST:PORT"
    // marker. A short timeout guards against hangs.
    let url = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[preview] {line}");
            if let Some(addr) = parse_data_plane_addr(&line) {
                return Some(format!("http://{addr}"));
            }
        }
        None
    })
    .await
    .map_err(|_| "timeout waiting for tinymist preview to bind".to_string())?
    .ok_or_else(|| "tinymist preview exited before binding".to_string())?;

    // Keep draining stderr so the pipe buffer never fills (which would block the child).
    tokio::spawn(async move {
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[preview] {line}");
        }
    });

    guard.next_use += 1;
    let last_used = guard.next_use;
    guard.entries.push(PreviewEntry {
        child,
        url: url.clone(),
        path: input_path.to_string(),
        invert_colors: invert_colors.to_string(),
        last_used,
    });

    Ok(url)
}

/// Stop the current preview child, if any.
pub async fn stop(sidecar: &SharedSidecar) {
    sidecar.lock().await.stop().await;
}

fn parse_data_plane_addr(line: &str) -> Option<String> {
    // Matches e.g. "... Data plane server listening on: 127.0.0.1:54321"
    let idx = line.find("Data plane server listening on:")?;
    let tail = line[idx..].split(':').skip(1).collect::<Vec<_>>().join(":");
    // `tail` now starts with " 127.0.0.1:PORT" (leading space) — trim.
    let addr = tail.trim();
    // Sanity: must contain a colon (host:port).
    if addr.contains(':') && !addr.is_empty() {
        Some(addr.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_data_plane_line() {
        let line = "[2026-04-20T04:39:05Z INFO  tinymist::cmd::preview] Data plane server listening on: 127.0.0.1:54321";
        assert_eq!(
            parse_data_plane_addr(line).as_deref(),
            Some("127.0.0.1:54321")
        );
    }

    #[test]
    fn ignores_unrelated_lines() {
        assert!(parse_data_plane_addr("hello world").is_none());
        assert!(parse_data_plane_addr("Control panel server listening on: 127.0.0.1:1").is_none());
    }
}
