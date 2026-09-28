use std::future::Future;
use std::sync::Mutex;
use tokio::sync::watch;

/// Each request owns its cancellation receiver. Starting a new request cancels
/// the old one permanently, even when the provider has not produced any output.
#[derive(Default)]
pub struct AiCancelFlag(Mutex<Option<watch::Sender<bool>>>);

impl AiCancelFlag {
    pub fn cancel(&self) {
        if let Some(sender) = self.0.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            let _ = sender.send(true);
        }
    }

    pub async fn run<T>(
        &self,
        operation: impl Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let (sender, mut receiver) = watch::channel(false);
        {
            let mut active = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(previous) = active.replace(sender) {
                let _ = previous.send(true);
            }
        }
        tokio::select! {
            biased;
            _ = receiver.changed() => Err("cancelled".to_string()),
            result = operation => result,
        }
    }
}

/// Decode only complete lines, so a UTF-8 code point split across network
/// chunks is retained intact. Supports both NDJSON and SSE's CRLF lines.
#[derive(Default)]
pub struct LineDecoder {
    pending: Vec<u8>,
}

impl LineDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.pending.extend_from_slice(chunk);
        let mut lines = Vec::new();
        let mut start = 0;
        for (index, byte) in self.pending.iter().enumerate() {
            if *byte == b'\n' {
                lines.push(Self::decode(&self.pending[start..index])?);
                start = index + 1;
            }
        }
        self.pending.drain(..start);
        if self.pending.len() > 8 * 1024 * 1024 {
            return Err("AI stream line exceeded the size limit".into());
        }
        Ok(lines)
    }

    pub fn finish(&mut self) -> Result<Option<String>, String> {
        if self.pending.is_empty() {
            return Ok(None);
        }
        let line = Self::decode(&self.pending)?;
        self.pending.clear();
        Ok(Some(line))
    }

    fn decode(bytes: &[u8]) -> Result<String, String> {
        std::str::from_utf8(bytes)
            .map(|line| line.trim_end_matches('\r').to_string())
            .map_err(|e| format!("Invalid UTF-8 in AI stream: {e}"))
    }
}

#[derive(Default)]
pub struct ToolInput {
    pub id: String,
    pub name: String,
    pub json: String,
}

impl ToolInput {
    pub fn finish(&self) -> Result<serde_json::Value, String> {
        let input = if self.json.is_empty() {
            "{}"
        } else {
            &self.json
        };
        let parsed: serde_json::Value = serde_json::from_str(input)
            .map_err(|e| format!("Incomplete AI tool arguments for {}: {e}", self.name))?;
        if !parsed.is_object() {
            return Err(format!(
                "AI tool arguments for {} must be an object",
                self.name
            ));
        }
        Ok(parsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn cancellation_interrupts_a_provider_that_never_yields() {
        let cancel = AiCancelFlag::default();
        let operation = cancel.run(std::future::pending::<Result<(), String>>());
        let stop = async {
            tokio::task::yield_now().await;
            cancel.cancel();
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(operation, stop)
        })
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "cancelled");
    }

    #[tokio::test]
    async fn new_request_cannot_revive_cancelled_request() {
        let cancel = AiCancelFlag::default();
        let first = cancel.run(std::future::pending::<Result<(), String>>());
        let second = async {
            tokio::task::yield_now().await;
            cancel.run(async { Ok(42) }).await
        };
        let (first, second) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(first, second)
        })
        .await
        .unwrap();
        assert_eq!(first.unwrap_err(), "cancelled");
        assert_eq!(second.unwrap(), 42);
    }

    #[test]
    fn decodes_multibyte_text_at_every_possible_chunk_boundary() {
        let payload = "data: {\"text\":\"你好 🌍 café\"}\r\n\r\nlast";
        for split in 0..=payload.len() {
            let mut decoder = LineDecoder::default();
            let mut lines = decoder.push(&payload.as_bytes()[..split]).unwrap();
            lines.extend(decoder.push(&payload.as_bytes()[split..]).unwrap());
            assert_eq!(lines, ["data: {\"text\":\"你好 🌍 café\"}", ""]);
            assert_eq!(decoder.finish().unwrap().as_deref(), Some("last"));
        }
    }

    #[test]
    fn parses_tool_arguments_only_after_all_fragments_arrive() {
        let mut tool = ToolInput {
            name: "draft".into(),
            ..Default::default()
        };
        for fragment in ["{\"title\"", ":\"Hello", " world\",\"n\":", "2}"] {
            tool.json.push_str(fragment);
        }
        assert_eq!(
            tool.finish().unwrap(),
            serde_json::json!({"title": "Hello world", "n": 2})
        );
        tool.json.pop();
        assert!(tool.finish().is_err());
        tool.json = "[]".into();
        assert!(tool.finish().is_err());
    }
}
