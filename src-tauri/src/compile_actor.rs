use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

use crate::commands::approved_path;
use crate::converter;
use crate::is_markdown_path;
use crate::preview_sidecar;
use crate::typst_world;
use crate::{AppState, CompileRequest};

fn resolve_tinymist(state: &tauri::State<AppState>) -> String {
    state.tinymist_path.lock().unwrap().clone()
}

fn run_tinymist_compile(
    tinymist: &str,
    input: &str,
    output: &str,
    format: &str,
    root: Option<&str>,
) -> Result<(), String> {
    let mut cmd = Command::new(tinymist);
    cmd.arg("compile")
        .arg("--format")
        .arg(format)
        .arg(input)
        .arg(output);
    if let Some(r) = root {
        cmd.current_dir(r);
    }

    let out = cmd
        .output()
        .map_err(|e| format!("Failed to run tinymist: {e}"))?;

    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        Err(format!("{stderr}\n{stdout}").trim().to_string())
    }
}

#[derive(Clone, Serialize)]
pub struct PageUpdate {
    pub index: usize,
    pub svg: String,
}

#[derive(Clone, Serialize)]
pub struct PreviewResult {
    pub total_pages: usize,
    pub updates: Vec<PageUpdate>,
}

#[derive(Clone, Serialize)]
pub struct PreviewError {
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct GeneratedFileUpdate {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
pub struct PerfMetric {
    pub name: String,
    pub duration_ms: Option<f64>,
    pub value: Option<f64>,
    pub unit: Option<String>,
    pub detail: Option<String>,
    pub timestamp_ms: u128,
}

fn epoch_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn emit_perf_metric(
    app_handle: &tauri::AppHandle,
    name: &str,
    duration: std::time::Duration,
    detail: Option<String>,
) {
    let _ = app_handle.emit(
        "perf-metric",
        PerfMetric {
            name: name.to_string(),
            duration_ms: Some(duration.as_secs_f64() * 1000.0),
            value: None,
            unit: Some("ms".to_string()),
            detail,
            timestamp_ms: epoch_ms(),
        },
    );
}

fn resolve_md_hybrid(md_path: &Path, md_content: &str) -> Option<(String, String, String, String)> {
    let (_, fm_yaml) = converter::strip_front_matter(md_content);
    let compile_rel = fm_yaml.and_then(|y| {
        let fm = converter::parse_front_matter(y);
        fm.compile
    })?;

    let dir = md_path.parent().unwrap_or(Path::new("."));
    let target = dir.join(&compile_rel);
    if !target.exists() {
        return None;
    }

    let (body_typst, _) = converter::markdown_to_typst(md_content);
    let stem = md_path.file_stem()?.to_string_lossy();
    let sibling_typ = dir.join(format!("{stem}.typ"));
    let _ = fs::write(&sibling_typ, &body_typst);

    let target_content = fs::read_to_string(&target).ok()?;
    Some((
        target.to_string_lossy().to_string(),
        target_content,
        sibling_typ.to_string_lossy().to_string(),
        body_typst,
    ))
}

fn md_preview_typ_path(md_path: &str) -> PathBuf {
    let path = Path::new(md_path);
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "untitled".to_string());
    parent.join(format!(".{stem}.preview.typ"))
}

fn compose_markdown_source(md_path: &Path, md_content: &str) -> (String, Vec<String>) {
    let (body_md, fm_yaml) = converter::strip_front_matter(md_content);
    let fm = fm_yaml
        .map(converter::parse_front_matter)
        .unwrap_or_default();
    let (body, warnings) = converter::markdown_to_typst(body_md);

    let explicit_template = md_path
        .parent()
        .map(|p| p.join("template.typ"))
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(&p).ok());

    let typst = match explicit_template {
        Some(t) => format!("{t}\n\n{body}"),
        None => {
            let preamble = converter::build_preamble(&fm);
            if preamble.is_empty() {
                body
            } else {
                format!("{preamble}\n{body}")
            }
        }
    };
    (typst, warnings)
}

fn compose_markdown_preview_source(md_path: &Path, md_content: &str) -> (String, Vec<String>) {
    let (body_md, fm_yaml) = converter::strip_front_matter(md_content);
    let fm = fm_yaml
        .map(converter::parse_front_matter)
        .unwrap_or_default();
    let (body, warnings) = converter::markdown_to_typst_preview(body_md, md_path);

    let explicit_template = md_path
        .parent()
        .map(|p| p.join("template.typ"))
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(&p).ok());

    let typst = match explicit_template {
        Some(t) => format!("{t}\n\n{body}"),
        None => {
            let preamble = converter::build_preamble(&fm);
            if preamble.is_empty() {
                body
            } else {
                format!("{preamble}\n{body}")
            }
        }
    };
    (typst, warnings)
}

#[cfg(test)]
fn validate_typst_source(path: &Path, content: &str) -> Result<(), String> {
    let mut world = typst_world::TypstWorld::new(path)?;
    world.set_source(path, content)?;
    let warned = typst::compile::<typst::layout::PagedDocument>(&world);
    match warned.output {
        Ok(_) => Ok(()),
        Err(errors) => {
            eprintln!(
                "[markdown-preview] Typst validation failed for {}",
                path.display()
            );
            for (index, error) in errors.iter().enumerate() {
                eprintln!("[markdown-preview] error {}: {}", index + 1, error.message);
                eprintln!("[markdown-preview] diagnostic {index}: {error:?}");
            }
            Err(errors
                .iter()
                .map(|e: &typst::diag::SourceDiagnostic| e.message.to_string())
                .collect::<Vec<_>>()
                .join("\n"))
        }
    }
}

fn validate_typst_source_quiet(path: &Path, content: &str) -> Result<(), String> {
    let mut world = typst_world::TypstWorld::new(path)?;
    world.set_source(path, content)?;
    let warned = typst::compile::<typst::layout::PagedDocument>(&world);
    match warned.output {
        Ok(_) => Ok(()),
        Err(errors) => Err(errors
            .iter()
            .map(|e: &typst::diag::SourceDiagnostic| e.message.to_string())
            .collect::<Vec<_>>()
            .join("\n")),
    }
}

fn quote_typst_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
fn split_typst_chunks(source: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for line in source.lines() {
        current.push_str(line);
        current.push('\n');
        if line.trim().is_empty() && !current.trim().is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
fn recover_typst_source(path: &Path, typst_content: &str) -> Result<String, String> {
    let chunks = split_typst_chunks(typst_content);
    let mut skipped = Vec::new();
    let recovered = recover_typst_chunks(path, "", &chunks, &mut skipped);

    if recovered.trim().is_empty() {
        Err(skipped.join("\n"))
    } else {
        Ok(recovered)
    }
}

#[cfg(test)]
fn extract_missing_labels(diagnostics: &str) -> Vec<String> {
    let mut labels = Vec::new();
    let mut rest = diagnostics;
    while let Some(start) = rest.find("label `<") {
        let after_start = &rest[start + "label `<".len()..];
        let Some(end) = after_start.find(">` does not exist") else {
            break;
        };
        let label = &after_start[..end];
        if !label.is_empty() && !labels.iter().any(|existing| existing == label) {
            labels.push(label.to_string());
        }
        rest = &after_start[end + 1..];
    }
    labels
}

#[cfg(test)]
fn escape_missing_label_refs(source: &str, diagnostics: &str) -> Option<String> {
    let labels = extract_missing_labels(diagnostics);
    if labels.is_empty() {
        return None;
    }

    let mut out = String::with_capacity(source.len() + labels.len());
    let mut i = 0;
    while i < source.len() {
        let rest = &source[i..];

        if rest.starts_with('@') && (i == 0 || !source[..i].ends_with('\\')) {
            if let Some(label) = labels
                .iter()
                .find(|label| rest[1..].starts_with(label.as_str()))
            {
                out.push_str("\\@");
                out.push_str(label);
                i += 1 + label.len();
                continue;
            }
        }

        let ch = rest
            .chars()
            .next()
            .expect("source byte length is validated by loop condition");
        out.push(ch);
        i += ch.len_utf8();
    }

    eprintln!(
        "[markdown-preview] escaped unresolved Typst label refs for preview: {}",
        labels.join(", ")
    );
    Some(out)
}

#[cfg(test)]
fn recover_typst_chunks(
    path: &Path,
    prefix: &str,
    chunks: &[String],
    skipped: &mut Vec<String>,
) -> String {
    if chunks.is_empty() {
        return String::new();
    }

    let joined = chunks.concat();
    let candidate = format!("{prefix}{joined}");
    if validate_typst_source_quiet(path, &candidate).is_ok() {
        return joined;
    }

    if chunks.len() == 1 {
        let msg = validate_typst_source_quiet(path, &candidate).unwrap_err();
        skipped.push(msg);
        eprintln!("[markdown-preview] skipped invalid generated Typst chunk:");
        eprintln!("{}", chunks[0]);
        eprintln!(
            "[markdown-preview] skipped chunk error: {}",
            skipped.last().unwrap()
        );
        return String::new();
    }

    let mid = chunks.len() / 2;
    let left = recover_typst_chunks(path, prefix, &chunks[..mid], skipped);
    let next_prefix = format!("{prefix}{left}");
    let right = recover_typst_chunks(path, &next_prefix, &chunks[mid..], skipped);
    format!("{left}{right}")
}

fn markdown_preview_fallback_source(md_path: &Path, md_content: &str, diagnostics: &str) -> String {
    let name = md_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Markdown file".to_string());

    format!(
        "#set page(margin: 2cm)\n\
         #set text(size: 10pt)\n\n\
         #text(fill: red, weight: \"bold\")[Markdown preview could not compile]\n\n\
         #block(stroke: (left: 2pt + red), inset: 8pt)[\n\
         Source: {}\n\n\
         #raw({}, block: true)\n\
         ]\n\n\
         #raw({}, block: true, lang: \"markdown\")\n",
        quote_typst_string(&name),
        quote_typst_string(diagnostics),
        quote_typst_string(md_content),
    )
}

#[cfg(test)]
fn write_markdown_preview_source_resilient(
    md_path: &str,
    md_content: &str,
) -> Result<Option<String>, String> {
    let path = Path::new(md_path);
    let (typst_content, _warnings) = compose_markdown_source(path, md_content);
    let temp_path = md_preview_typ_path(md_path);

    match validate_typst_source_quiet(&temp_path, &typst_content) {
        Ok(()) => {
            fs::write(&temp_path, &typst_content).map_err(|e| e.to_string())?;
            Ok(None)
        }
        Err(msg) => {
            if let Some(recovered) = escape_missing_label_refs(&typst_content, &msg)
                .filter(|candidate| validate_typst_source_quiet(&temp_path, candidate).is_ok())
            {
                fs::write(&temp_path, recovered).map_err(|e| e.to_string())?;
                return Ok(Some(msg));
            }

            let recovered = recover_typst_source(&temp_path, &typst_content)
                .unwrap_or_else(|_| markdown_preview_fallback_source(path, md_content, &msg));
            fs::write(&temp_path, recovered).map_err(|e| e.to_string())?;
            Ok(Some(msg))
        }
    }
}

pub(crate) fn write_markdown_preview_source_fast(
    md_path: &str,
    md_content: &str,
) -> Result<Option<(String, String)>, String> {
    if let Some((_, _, sibling_path, sibling_content)) =
        resolve_md_hybrid(Path::new(md_path), md_content)
    {
        return Ok(Some((sibling_path, sibling_content)));
    }

    let path = Path::new(md_path);
    let (typst_content, _warnings) = compose_markdown_preview_source(path, md_content);
    let preview_path = md_preview_typ_path(md_path);
    if fs::read_to_string(&preview_path)
        .map(|existing| existing == typst_content)
        .unwrap_or(false)
    {
        return Ok(None);
    }
    fs::write(preview_path, typst_content).map_err(|e| e.to_string())?;
    Ok(None)
}

pub(crate) fn validate_preview_sidecar_content_blocking(
    path: String,
    content: String,
) -> Result<Option<String>, String> {
    if is_markdown_path(Path::new(&path)) {
        if let Some((target_path, target_content, _, _)) =
            resolve_md_hybrid(Path::new(&path), &content)
        {
            return match validate_typst_source_quiet(Path::new(&target_path), &target_content) {
                Ok(()) => Ok(None),
                Err(msg) => Ok(Some(msg)),
            };
        }

        let _ = write_markdown_preview_source_fast(&path, &content)?;
        let temp_path = md_preview_typ_path(&path);
        let preview_source = fs::read_to_string(&temp_path).map_err(|e| e.to_string())?;
        match validate_typst_source_quiet(&temp_path, &preview_source) {
            Ok(()) => Ok(None),
            Err(msg) => {
                let fallback = markdown_preview_fallback_source(Path::new(&path), &content, &msg);
                fs::write(&temp_path, fallback).map_err(|e| e.to_string())?;
                Ok(Some(msg))
            }
        }
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod markdown_preview_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("type-studio-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn markdown_preview_writes_compilable_fallback_for_broken_typst() {
        let dir = temp_test_dir("markdown-preview-fallback");
        let md_path = dir.join("broken.md");
        let md = "# Broken\n\n```typst\n#let x =\n```\n\nStill show \"this\" \\ text.\n";

        let result = write_markdown_preview_source_resilient(&md_path.to_string_lossy(), md);
        assert!(result.unwrap().is_some());

        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let recovered = fs::read_to_string(&preview_path).unwrap();
        assert!(recovered.contains("= Broken"));
        assert!(recovered.contains("Still show"));
        assert!(!recovered.contains("#let x ="));
        validate_typst_source(&preview_path, &recovered).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_preview_recovers_repository_sample() {
        let sample_path = Path::new("../examples/markdown/sample.md");
        if !sample_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-sample");
        let md_path = dir.join("sample.md");
        let md = fs::read_to_string(sample_path).unwrap();

        let result = write_markdown_preview_source_resilient(&md_path.to_string_lossy(), &md);
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let recovered = fs::read_to_string(&preview_path).unwrap();

        assert!(result.unwrap().is_some());
        assert!(recovered.contains("= Heading 1"));
        assert!(recovered.contains("\\@"));
        assert!(recovered.contains("Deep learning has revolutionized"));
        validate_typst_source(&preview_path, &recovered).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_preview_fallback_page_is_compilable_and_preserves_markdown() {
        let dir = temp_test_dir("markdown-preview-fallback-page");
        let md_path = dir.join("fallback.md");
        let md = "# Original\n\nThis *Markdown* should remain visible.";
        let source = markdown_preview_fallback_source(&md_path, md, "synthetic Typst diagnostic");

        assert!(source.contains("Markdown preview could not compile"));
        assert!(source.contains("synthetic Typst diagnostic"));
        assert!(source.contains("This *Markdown* should remain visible."));
        validate_typst_source(&md_preview_typ_path(&md_path.to_string_lossy()), &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_label_refs_are_escaped_without_dropping_paragraph() {
        let source = "Text @missing and \\@already escaped.\n";
        let diagnostics = "label `<missing>` does not exist in the document";
        let recovered = escape_missing_label_refs(source, diagnostics).unwrap();
        assert_eq!(recovered, "Text \\@missing and \\@already escaped.\n");
    }

    #[test]
    fn fast_markdown_preview_writes_compilable_sample_without_preflight_recovery() {
        let sample_path = Path::new("../examples/markdown/sample.md");
        if !sample_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-fast-sample");
        let md_path = dir.join("sample.md");
        let md = fs::read_to_string(sample_path).unwrap();

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(source.contains("= Heading 1"));
        assert!(source.contains("\\@"));
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn hybrid_markdown_preview_writes_body_and_skips_preview_temp() {
        let dir = temp_test_dir("markdown-preview-hybrid");
        let md_path = dir.join("content.md");
        let main_path = dir.join("main.typ");
        let body_path = dir.join("content.typ");
        let md = "---\ncompile: main.typ\n---\n\n# Hello\n\nBody text.\n";

        fs::write(&main_path, "#include \"content.typ\"\n").unwrap();

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), md).unwrap();

        let body = fs::read_to_string(&body_path).unwrap();
        assert!(body.contains("= Hello"));
        assert!(body.contains("Body text."));
        assert!(!md_preview_typ_path(&md_path.to_string_lossy()).exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn hybrid_markdown_validation_compiles_declared_target() {
        let dir = temp_test_dir("markdown-preview-hybrid-validation");
        let md_path = dir.join("content.md");
        let main_path = dir.join("main.typ");
        let md = "---\ncompile: main.typ\n---\n\n# Hello\n";

        fs::write(
            &main_path,
            "#set page(margin: 2cm)\n#include \"content.typ\"\n",
        )
        .unwrap();

        let diagnostic = validate_preview_sidecar_content_blocking(
            md_path.to_string_lossy().to_string(),
            md.to_string(),
        )
        .unwrap();

        assert_eq!(diagnostic, None);
        assert!(fs::read_to_string(dir.join("content.typ"))
            .unwrap()
            .contains("= Hello"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_quotes_broken_typst_fences() {
        let dir = temp_test_dir("markdown-preview-fast-broken-typst");
        let md_path = dir.join("broken.md");
        let md = "# Broken\n\n```typst\n#let x =\n```\n\nAfterward.\n";

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(source.contains("#raw("));
        assert!(source.contains("lang: \"typst\""));
        assert!(source.contains("#let x ="));
        assert!(source.contains("Afterward."));
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_stress_test() {
        let stress_path = Path::new("../examples/markdown/stress-test.md");
        if !stress_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-fast-stress");
        let md_path = dir.join("stress-test.md");
        let md = fs::read_to_string(stress_path).unwrap();

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_math_reference() {
        let math_path = Path::new("../examples/markdown/math.md");
        if !math_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-fast-math");
        let md_path = dir.join("math.md");
        let md = fs::read_to_string(math_path).unwrap();

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_syntax_test() {
        let syntax_path = Path::new("../examples/markdown/test_syntax.md");
        if !syntax_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-fast-syntax");
        let md_path = dir.join("test_syntax.md");
        let md = fs::read_to_string(syntax_path).unwrap();

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(source.contains("a &= b + c \\"), "got: {source}");
        assert!(source.contains("d &= e + f"), "got: {source}");
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_gaussian_integral_math() {
        let dir = temp_test_dir("markdown-preview-gaussian-integral");
        let md_path = dir.join("gaussian.md");
        let md = "$$\n\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}\n$$\n";

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_align_math_with_pivots() {
        let dir = temp_test_dir("markdown-preview-align-math");
        let md_path = dir.join("align.md");
        let md = "$$\n\\begin{align}\na &= b + c \\\\\nd &= e + f\n\\end{align}\n$$\n";

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(source.contains("a &= b + c \\"), "got: {source}");
        assert!(source.contains("d &= e + f"), "got: {source}");
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_footnotes() {
        let dir = temp_test_dir("markdown-preview-footnotes");
        let md_path = dir.join("footnotes.md");
        let md = "Paragraph with a footnote.[^1]\n\n[^1]: Footnote body with *emphasis*.\n";

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(source.contains("#footnote["), "got: {source}");
        assert!(!source.contains("[^1]:"), "got: {source}");
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn fast_markdown_preview_compiles_latex_math_coverage() {
        let dir = temp_test_dir("markdown-preview-math-coverage");
        let md_path = dir.join("math-coverage.md");
        let mut md = String::from("# Math coverage\n\n");

        for (latex, _typst, standalone) in converter::latex_math_command_coverage() {
            if standalone {
                md.push_str(&format!("$x {latex} y$\n\n"));
            }
        }
        md.push_str("$$\n\\frac{\\sqrt{\\alpha}}{\\mathbb{R}} + \\lim_{n \\to \\infty} n\n$$\n");

        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(
            !source.contains("#raw("),
            "coverage math fell back to raw: {source}"
        );
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_preview_idle_validation_writes_nonblank_compilable_preview() {
        let dir = temp_test_dir("markdown-preview-idle-validation");
        let md_path = dir.join("idle.md");
        let md = "# Idle validation\n\n```typst\n#let x =\n```\n\nStill visible.\n";

        let diagnostic = validate_preview_sidecar_content_blocking(
            md_path.to_string_lossy().to_string(),
            md.to_string(),
        )
        .unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(diagnostic.is_none());
        assert!(!source.trim().is_empty());
        assert!(source.contains("Idle validation"));
        assert!(source.contains("Still visible"));
        assert!(source.contains("#raw("));
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_preview_idle_validation_compiles_math_reference_fast() {
        let math_path = Path::new("../examples/markdown/math.md");
        if !math_path.exists() {
            return;
        }

        let dir = temp_test_dir("markdown-preview-idle-math");
        let md_path = dir.join("math.md");
        let md = fs::read_to_string(math_path).unwrap();

        let diagnostic =
            validate_preview_sidecar_content_blocking(md_path.to_string_lossy().to_string(), md)
                .unwrap();
        let preview_path = md_preview_typ_path(&md_path.to_string_lossy());
        let source = fs::read_to_string(&preview_path).unwrap();

        assert!(diagnostic.is_none(), "got diagnostic: {diagnostic:?}");
        validate_typst_source(&preview_path, &source).unwrap();

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_preview_stage_timing_budgets() {
        let dir = temp_test_dir("markdown-preview-timing");
        let md_path = dir.join("timing.md");
        let mut md = String::from("# Timing\n\n");
        for i in 0..8 {
            md.push_str(&format!(
                "## Section {i}\n\nParagraph with plain text for timing coverage.\n\n"
            ));
        }

        let fast_start = std::time::Instant::now();
        write_markdown_preview_source_fast(&md_path.to_string_lossy(), &md).unwrap();
        let fast_ms = fast_start.elapsed().as_millis();

        let resilient_start = std::time::Instant::now();
        let diagnostic =
            write_markdown_preview_source_resilient(&md_path.to_string_lossy(), &md).unwrap();
        let resilient_ms = resilient_start.elapsed().as_millis();

        let fallback_start = std::time::Instant::now();
        let fallback =
            markdown_preview_fallback_source(&md_path, &md, "synthetic timing diagnostic");
        let fallback_ms = fallback_start.elapsed().as_millis();

        eprintln!(
            "[markdown-preview timing] fast={fast_ms}ms resilient={resilient_ms}ms fallback={fallback_ms}ms"
        );

        assert!(diagnostic.is_none());
        assert!(!fallback.trim().is_empty());
        assert!(fast_ms < 1_000, "fast preview took {fast_ms}ms");
        assert!(
            resilient_ms < 5_000,
            "resilient preview took {resilient_ms}ms"
        );
        assert!(fallback_ms < 500, "fallback source took {fallback_ms}ms");

        let _ = fs::remove_dir_all(dir);
    }
}

fn hash_svg(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

pub async fn compile_actor(
    mut rx: tokio::sync::watch::Receiver<Option<CompileRequest>>,
    world_arc: Arc<Mutex<Option<typst_world::TypstWorld>>>,
    app_handle: tauri::AppHandle,
) {
    let mut prev_hashes: Vec<u64> = Vec::new();

    loop {
        if rx.changed().await.is_err() {
            break;
        }
        let req = rx.borrow_and_update().clone();
        let Some(req) = req else { continue };
        let compile_started_at = Instant::now();

        let (source_content, conv_warnings) = if is_markdown_path(Path::new(&req.path)) {
            compose_markdown_source(Path::new(&req.path), &req.content)
        } else {
            (req.content.clone(), vec![])
        };
        let _ = app_handle.emit("converter-warnings", &conv_warnings);

        let world = Arc::clone(&world_arc);
        let result = tauri::async_runtime::spawn_blocking(move || {
            let main_path = Path::new(&req.path);
            let mut guard = world.lock().unwrap();

            let needs_init = match guard.as_ref() {
                None => true,
                Some(w) => w.root() != main_path.parent().unwrap_or_else(|| Path::new("/")),
            };
            if needs_init {
                *guard = Some(typst_world::TypstWorld::new(main_path)?);
            }
            if let Some((sidecar_path, sidecar_content)) = &req.sidecar {
                guard
                    .as_mut()
                    .unwrap()
                    .cache_source(Path::new(sidecar_path), sidecar_content);
            }
            guard
                .as_mut()
                .unwrap()
                .set_source(main_path, &source_content)?;

            let warned = typst::compile::<typst::layout::PagedDocument>(guard.as_ref().unwrap());
            drop(guard);
            comemo::evict(30);

            match warned.output {
                Ok(doc) => Ok(doc.pages.iter().map(typst_svg::svg).collect::<Vec<_>>()),
                Err(errors) => {
                    eprintln!("[preview] Typst compile failed for {}", main_path.display());
                    for (index, error) in errors.iter().enumerate() {
                        eprintln!("[preview] error {}: {}", index + 1, error.message);
                        eprintln!("[preview] diagnostic {index}: {error:?}");
                    }
                    Err(errors
                        .iter()
                        .map(|e: &typst::diag::SourceDiagnostic| e.message.to_string())
                        .collect::<Vec<_>>()
                        .join("\n"))
                }
            }
        })
        .await;

        match result {
            Ok(Ok(pages)) => {
                let hashes: Vec<u64> = pages.iter().map(|s| hash_svg(s)).collect();
                let updates: Vec<PageUpdate> = pages
                    .into_iter()
                    .enumerate()
                    .filter(|(i, _)| hashes.get(*i) != prev_hashes.get(*i))
                    .map(|(index, svg)| PageUpdate { index, svg })
                    .collect();
                prev_hashes = hashes;
                let _ = app_handle.emit(
                    "preview-result",
                    PreviewResult {
                        total_pages: prev_hashes.len(),
                        updates,
                    },
                );
                emit_perf_metric(
                    &app_handle,
                    "preview.compile",
                    compile_started_at.elapsed(),
                    Some(format!("pages={}", prev_hashes.len())),
                );
            }
            Ok(Err(msg)) => {
                let _ = app_handle.emit("preview-error", PreviewError { message: msg });
                emit_perf_metric(
                    &app_handle,
                    "preview.compile",
                    compile_started_at.elapsed(),
                    Some("error".to_string()),
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "preview-error",
                    PreviewError {
                        message: e.to_string(),
                    },
                );
                emit_perf_metric(
                    &app_handle,
                    "preview.compile",
                    compile_started_at.elapsed(),
                    Some("join-error".to_string()),
                );
            }
        }
    }
}

#[tauri::command]
pub fn update_preview_source(
    path: String,
    content: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let (compile_path, compile_content, sidecar) = if is_markdown_path(Path::new(&path)) {
        if let Some((tp, tc, sp, sc)) = resolve_md_hybrid(Path::new(&path), &content) {
            (tp, tc, Some((sp, sc)))
        } else {
            (path, content, None)
        }
    } else {
        (path, content, None)
    };
    state
        .compile_tx
        .send(Some(CompileRequest {
            path: compile_path,
            content: compile_content,
            sidecar,
        }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn trigger_preview_compile(path: String, state: tauri::State<AppState>) -> Result<(), String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let (compile_path, compile_content, sidecar) = if is_markdown_path(Path::new(&path)) {
        if let Some((tp, tc, sp, sc)) = resolve_md_hybrid(Path::new(&path), &content) {
            (tp, tc, Some((sp, sc)))
        } else {
            (path, content, None)
        }
    } else {
        (path, content, None)
    };
    state
        .compile_tx
        .send(Some(CompileRequest {
            path: compile_path,
            content: compile_content,
            sidecar,
        }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_sidecar_preview(
    path: String,
    invert_colors: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let started_at = Instant::now();
    let tinymist = state.tinymist_path.lock().unwrap().clone();
    let sidecar = state.preview_sidecar.clone();

    let input_path = if is_markdown_path(Path::new(&path)) {
        let md_content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let input = if let Some((target_path, _, _, _)) =
            resolve_md_hybrid(Path::new(&path), &md_content)
        {
            target_path
        } else {
            let temp = md_preview_typ_path(&path);
            let _ = write_markdown_preview_source_fast(&path, &md_content)?;
            temp.to_string_lossy().to_string()
        };
        let _ = app_handle.emit(
            "preview-error",
            PreviewError {
                message: String::new(),
            },
        );
        input
    } else {
        path.clone()
    };

    let result = preview_sidecar::start(&sidecar, &tinymist, &input_path, &invert_colors).await;
    emit_perf_metric(
        &app_handle,
        "preview.sidecar-start",
        started_at.elapsed(),
        Some(if result.is_ok() {
            input_path
        } else {
            "error".to_string()
        }),
    );
    result
}

#[tauri::command]
pub async fn stop_sidecar_preview(state: tauri::State<'_, AppState>) -> Result<(), String> {
    preview_sidecar::stop(&state.preview_sidecar).await;
    Ok(())
}

#[tauri::command]
pub async fn write_preview_sidecar_content(
    path: String,
    content: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let started_at = Instant::now();
    let detail = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if is_markdown_path(Path::new(&path)) {
            return write_markdown_preview_source_fast(&path, &content);
        }
        Ok(None)
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Ok(Some((path, content))) = &result {
        let _ = app_handle.emit(
            "generated-file-updated",
            GeneratedFileUpdate {
                path: path.clone(),
                content: content.clone(),
            },
        );
    }
    emit_perf_metric(
        &app_handle,
        "preview.markdown-write",
        started_at.elapsed(),
        Some(detail),
    );
    result.map(|_| ())
}

#[tauri::command]
pub async fn validate_preview_sidecar_content(
    path: String,
    content: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<String>, String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let started_at = Instant::now();
    let detail = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        validate_preview_sidecar_content_blocking(path, content)
    })
    .await
    .map_err(|e| e.to_string())?;
    emit_perf_metric(
        &app_handle,
        "preview.markdown-validate",
        started_at.elapsed(),
        Some(detail),
    );
    result
}

#[tauri::command]
pub fn export_pdf(
    path: String,
    dest_path: String,
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let path = approved_path(&state, &path)?.to_string_lossy().to_string();
    let dest_path = approved_path(&state, &dest_path)?
        .to_string_lossy()
        .to_string();
    let started_at = Instant::now();
    let tinymist = resolve_tinymist(&state);

    let input_path = Path::new(&path);
    let root = input_path.parent().map(|p| p.to_string_lossy().to_string());

    let (compile_input, temp_to_clean) = if is_markdown_path(input_path) {
        let md_content = fs::read_to_string(input_path).map_err(|e| e.to_string())?;
        if let Some((target_path, _, _, _)) = resolve_md_hybrid(input_path, &md_content) {
            (target_path, None)
        } else {
            let (typst_content, _) = compose_markdown_source(input_path, &md_content);
            let parent = input_path.parent().unwrap_or_else(|| Path::new("."));
            let stem = input_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "untitled".to_string());
            let temp = parent.join(format!(".{stem}.export.typ"));
            fs::write(&temp, typst_content).map_err(|e| e.to_string())?;
            let temp_str = temp.to_string_lossy().to_string();
            (temp_str.clone(), Some(temp_str))
        }
    } else {
        (path.clone(), None)
    };

    let result = run_tinymist_compile(
        &tinymist,
        &compile_input,
        &dest_path,
        "pdf",
        root.as_deref(),
    );

    if let Some(temp) = temp_to_clean {
        let _ = fs::remove_file(&temp);
    }

    let detail = if result.is_ok() {
        Some(dest_path.clone())
    } else {
        Some("error".to_string())
    };
    emit_perf_metric(&app_handle, "export.pdf", started_at.elapsed(), detail);
    result?;
    Ok(dest_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_markdown_source_without_template_returns_body_only() {
        let dir = std::env::temp_dir().join("ts_compose_notmpl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let md = dir.join("doc.md");
        fs::write(&md, "# Hello\n").unwrap();

        let (out, _) = compose_markdown_source(&md, "# Hello\n");
        assert!(out.contains("= Hello"));
        assert!(!out.contains("#set page"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compose_markdown_source_prepends_template_when_present() {
        let dir = std::env::temp_dir().join("ts_compose_tmpl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let md = dir.join("doc.md");
        fs::write(&md, "# Hello\n").unwrap();
        fs::write(dir.join("template.typ"), "#set page(margin: 3cm)\n").unwrap();

        let (out, _) = compose_markdown_source(&md, "# Hello\n");
        let tmpl_pos = out
            .find("#set page(margin: 3cm)")
            .expect("template missing");
        let body_pos = out.find("= Hello").expect("body missing");
        assert!(tmpl_pos < body_pos, "template must come before body");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_typst_source_rejects_compile_errors() {
        let dir = std::env::temp_dir().join("ts_validate_typst_error");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let typ = dir.join("doc.typ");

        let err = validate_typst_source(&typ, "#let broken =").unwrap_err();
        assert!(!err.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hash_svg_is_deterministic() {
        let s = "<svg><rect width='100'/></svg>";
        let h1 = hash_svg(s);
        let h2 = hash_svg(s);
        assert_eq!(h1, h2);
    }

    #[test]
    fn hash_svg_differs_for_different_content() {
        assert_ne!(hash_svg("<svg>a</svg>"), hash_svg("<svg>b</svg>"));
    }

    #[test]
    fn hash_svg_empty_string() {
        let h1 = hash_svg("");
        let h2 = hash_svg("");
        assert_eq!(h1, h2);
    }
}
