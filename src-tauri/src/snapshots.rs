use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Serialize)]
pub struct SnapshotEntry {
    pub timestamp: u64,
    pub path: String,
}

#[tauri::command]
pub fn save_snapshot(path: String) -> Result<(), String> {
    let src = Path::new(&path);
    if !src.exists() {
        return Ok(());
    }
    let parent = src.parent().unwrap_or(Path::new("."));
    let stem = src
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let history_dir = parent.join(".history").join(&stem);
    fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;

    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let filename = if ext.is_empty() {
        format!("{secs}")
    } else {
        format!("{secs}.{ext}")
    };
    fs::copy(src, history_dir.join(&filename)).map_err(|e| e.to_string())?;

    let mut files: Vec<_> = fs::read_dir(&history_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .collect();
    if files.len() > 200 {
        files.sort_by_key(|e| e.file_name());
        for f in &files[..files.len() - 200] {
            let _ = fs::remove_file(f.path());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_snapshots(path: String) -> Result<Vec<SnapshotEntry>, String> {
    let src = Path::new(&path);
    let parent = src.parent().unwrap_or(Path::new("."));
    let stem = src
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let history_dir = parent.join(".history").join(&stem);

    if !history_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<SnapshotEntry> = fs::read_dir(&history_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let ts: u64 = name.split('.').next()?.parse().ok()?;
            Some(SnapshotEntry {
                timestamp: ts,
                path: e.path().to_string_lossy().to_string(),
            })
        })
        .collect();

    entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_snapshot_creates_history_entry() {
        let dir = std::env::temp_dir().join("ts_snap_basic");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("doc.typ");
        fs::write(&file, "content").unwrap();

        save_snapshot(file.to_string_lossy().to_string()).unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 1);
        assert!(snaps[0].timestamp > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_snapshots_empty_when_no_history() {
        let dir = std::env::temp_dir().join("ts_snap_nohistory");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("nosnap.typ");
        fs::write(&file, "").unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert!(snaps.is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_snapshots_ordered_newest_first() {
        let dir = std::env::temp_dir().join("ts_snap_order");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("order.typ");
        fs::write(&file, "v1").unwrap();

        let hist = dir.join(".history").join("order");
        fs::create_dir_all(&hist).unwrap();
        fs::write(hist.join("100.typ"), "older").unwrap();
        fs::write(hist.join("200.typ"), "newer").unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 2);
        assert!(
            snaps[0].timestamp > snaps[1].timestamp,
            "newest should be first"
        );
        assert_eq!(snaps[0].timestamp, 200);
        assert_eq!(snaps[1].timestamp, 100);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_snapshot_prunes_to_200() {
        let dir = std::env::temp_dir().join("ts_snap_prune");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("prune.typ");
        fs::write(&file, "latest").unwrap();

        let hist = dir.join(".history").join("prune");
        fs::create_dir_all(&hist).unwrap();
        for i in 0u64..205 {
            fs::write(hist.join(format!("{i}.typ")), format!("v{i}")).unwrap();
        }

        save_snapshot(file.to_string_lossy().to_string()).unwrap();

        let snaps = list_snapshots(file.to_string_lossy().to_string()).unwrap();
        assert_eq!(snaps.len(), 200);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_snapshot_no_op_for_nonexistent_file() {
        let result = save_snapshot("/nonexistent/path/file.typ".to_string());
        assert!(result.is_ok(), "should silently succeed for missing files");
    }
}
