use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Filesystem locations that the renderer is allowed to pass to custom Tauri
/// commands. Workspace paths are the default; explicitly approved paths cover
/// files/directories selected through a native dialog.
#[derive(Default)]
pub struct PathPolicy {
    workspace_root: Option<PathBuf>,
    approved_roots: HashSet<PathBuf>,
}

impl PathPolicy {
    pub fn set_workspace_root(&mut self, path: &Path) -> Result<(), String> {
        let root = fs::canonicalize(path)
            .map_err(|e| format!("cannot use workspace root '{}': {e}", path.display()))?;
        if !root.is_dir() {
            return Err(format!(
                "workspace root is not a directory: {}",
                root.display()
            ));
        }
        // Open tabs and pending saves from the previous workspace keep their
        // explicit grant until the application exits.
        if let Some(previous) = self.workspace_root.replace(root) {
            self.approved_roots.insert(previous);
        }
        Ok(())
    }

    pub fn approve(&mut self, path: &Path) -> Result<(), String> {
        self.approved_roots.insert(canonicalize_for_access(path)?);
        Ok(())
    }

    pub fn check(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = canonicalize_for_access(path)?;
        if self.is_allowed(&canonical) {
            Ok(canonical)
        } else {
            Err(format!(
                "path is outside the approved workspace: {}",
                path.display()
            ))
        }
    }

    fn is_allowed(&self, path: &Path) -> bool {
        let in_workspace = self
            .workspace_root
            .as_ref()
            .is_some_and(|root| path.starts_with(root));
        let in_temp_workspace = std::env::temp_dir()
            .join("type-studio")
            .canonicalize()
            .ok()
            .is_some_and(|root| path.starts_with(root));
        let explicitly_approved = self
            .approved_roots
            .iter()
            .any(|root| path == root || path.starts_with(root));
        in_workspace || in_temp_workspace || explicitly_approved
    }
}

pub(crate) fn canonicalize_for_access(path: &Path) -> Result<PathBuf, String> {
    // exists() follows symlinks and returns false for dangling links. Treating
    // one as a new file would let a write create its target outside the root.
    if fs::symlink_metadata(path).is_ok() {
        return fs::canonicalize(path)
            .map_err(|e| format!("cannot resolve '{}': {e}", path.display()));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| format!("path has no file name: {}", path.display()))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("path has no parent: {}", path.display()))?;
    Ok(fs::canonicalize(parent)
        .map_err(|e| format!("cannot resolve parent '{}': {e}", parent.display()))?
        .join(file_name))
}

/// Resolve generated files beneath their document directory, including paths
/// whose metadata folders do not exist yet. Never follow links outside it.
pub(crate) fn confined_path(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut result = root.clone();
    for component in relative.components() {
        match component {
            Component::Normal(name) => result.push(name),
            Component::CurDir => continue,
            _ => return Err("Generated paths must stay inside the document directory".into()),
        }
        match fs::symlink_metadata(&result) {
            Ok(_) => {
                result = fs::canonicalize(&result).map_err(|e| e.to_string())?;
                if !result.starts_with(&root) {
                    return Err("Generated path points outside the document directory".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn generated_paths_reject_metadata_and_file_symlink_escapes() {
        let base = std::env::temp_dir().join("grapheme_generated_path_policy");
        let root = base.join("workspace");
        let outside = base.join("private");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        assert!(confined_path(&root, Path::new(".grapheme/sessions.json")).is_ok());
        assert!(confined_path(&root, Path::new("../private/file")).is_err());
        std::os::unix::fs::symlink(&outside, root.join(".grapheme")).unwrap();
        assert!(confined_path(&root, Path::new(".grapheme/sessions.json")).is_err());
        fs::write(outside.join("secret"), "private").unwrap();
        std::os::unix::fs::symlink(outside.join("secret"), root.join(".doc.preview.typ")).unwrap();
        assert!(confined_path(&root, Path::new(".doc.preview.typ")).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn allows_workspace_paths_and_rejects_siblings() {
        let base = std::env::temp_dir().join("grapheme_path_policy");
        let workspace = base.join("workspace");
        let outside = base.join("outside");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let mut policy = PathPolicy::default();
        policy.set_workspace_root(&workspace).unwrap();
        assert!(policy.check(&workspace.join("doc.typ")).is_ok());
        assert!(policy.check(&outside.join("secret.txt")).is_err());
        policy.set_workspace_root(&outside).unwrap();
        assert!(policy.check(&workspace.join("doc.typ")).is_ok());

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn rejects_symlink_escape_when_supported() {
        let base = std::env::temp_dir().join("grapheme_path_policy_symlink");
        let workspace = base.join("workspace");
        let outside = base.join("outside");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, workspace.join("linked")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, workspace.join("linked")).unwrap();

        let mut policy = PathPolicy::default();
        policy.set_workspace_root(&workspace).unwrap();
        #[cfg(any(unix, windows))]
        assert!(policy.check(&workspace.join("linked/secret.txt")).is_err());

        let _ = fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_dangling_symlink_write_escape() {
        let base = std::env::temp_dir().join("grapheme_dangling_path_policy");
        let workspace = base.join("workspace");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&workspace).unwrap();
        std::os::unix::fs::symlink(base.join("private.txt"), workspace.join("draft.md")).unwrap();
        let mut policy = PathPolicy::default();
        policy.set_workspace_root(&workspace).unwrap();
        assert!(policy.check(&workspace.join("draft.md")).is_err());
        let _ = fs::remove_dir_all(base);
    }
}
