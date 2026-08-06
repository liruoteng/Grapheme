import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Search } from "lucide-react";
import { useEditorStore } from "../../stores/editorStore";
import "./TemplatePickerDialog.css";

interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  main: string;
  thumbnail?: string;
  version?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Conference": "var(--template-badge-conference)",
  "CV / AI":    "var(--template-badge-cv)",
  "ML / AI":    "var(--template-badge-ml)",
  "General":    "var(--template-badge-general)",
};

function TemplateThumbnail({ template }: { template: TemplateInfo }) {
  if (template.thumbnail) {
    return (
      <div className="template-thumbnail template-thumbnail--rendered">
        <img src={template.thumbnail} alt="" />
      </div>
    );
  }

  const isTwo =
    template.id === "ieee-conference" ||
    template.id === "cvpr-2025" ||
    template.id === "icml-2025";
  const lines = [90, 70, 80, 60, 75, 65, 70, 55];

  return (
    <div className="template-thumbnail">
      <div className="thumbnail-title-bar" />
      <div className="thumbnail-author-bar" />
      {isTwo ? (
        <div className="thumbnail-two-col">
          <div className="thumbnail-col">
            {lines.slice(0, 4).map((w, i) => (
              <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="thumbnail-col">
            {lines.slice(4).map((w, i) => (
              <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
      ) : (
        <div className="thumbnail-lines">
          {lines.map((w, i) => (
            <div key={i} className="thumbnail-line" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function TemplatePickerDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<"built-in" | "universe">("built-in");
  const [builtInTemplates, setBuiltInTemplates] = useState<TemplateInfo[]>([]);
  const [universeTemplates, setUniverseTemplates] = useState<TemplateInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [projectName, setProjectName] = useState("my-paper");
  const [loading, setLoading] = useState(true);
  const [universeLoading, setUniverseLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<TemplateInfo[]>("list_templates")
      .then((list) => {
        setBuiltInTemplates(list);
        if (list.length > 0) setSelected(list[0].id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (source !== "universe" || universeTemplates.length > 0 || universeLoading) return;
    setUniverseLoading(true);
    setError(null);
    invoke<TemplateInfo[]>("list_universe_templates")
      .then(setUniverseTemplates)
      .catch((e) => setError(String(e)))
      .finally(() => setUniverseLoading(false));
  }, [source, universeLoading, universeTemplates.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const templates = source === "built-in" ? builtInTemplates : universeTemplates;
  const templatesLoading = source === "built-in" ? loading : universeLoading;

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(templates.map((template) => template.category)))],
    [templates],
  );
  const visibleTemplates = useMemo(
    () => {
      const normalizedQuery = query.trim().toLowerCase();
      return templates.filter((template) => {
        if (category !== "All" && template.category !== category) return false;
        if (!normalizedQuery) return true;
        return [template.name, template.description, template.category, template.id]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      });
    },
    [category, query, templates],
  );

  useEffect(() => {
    if (visibleTemplates.length === 0) {
      setSelected(null);
      return;
    }
    if (!visibleTemplates.some((template) => template.id === selected)) {
      setSelected(visibleTemplates[0].id);
    }
  }, [selected, visibleTemplates]);

  const handleCreate = useCallback(async () => {
    if (!selected) return;
    const name = projectName.trim();
    if (!name) {
      setError("Please enter a project name.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const parentFolder = await open({
        directory: true,
        multiple: false,
        title: "Choose where to create the project",
      });
      if (typeof parentFolder !== "string") {
        setCreating(false);
        return;
      }
      await invoke("approve_path", { path: parentFolder });
      const selectedTemplate = templates.find((template) => template.id === selected);
      if (source === "universe" && !selectedTemplate?.version) {
        throw new Error("Select a Typst Universe template to import.");
      }
      const mainPath = source === "built-in"
        ? await invoke<string>("create_project_from_template", {
            templateId: selected,
            parentPath: parentFolder,
            projectName: name,
          })
        : await invoke<string>("create_project_from_universe_template", {
            packageName: selected,
            version: selectedTemplate?.version,
            parentPath: parentFolder,
            projectName: name,
          });
      const projectPath = mainPath.slice(0, mainPath.lastIndexOf("/"));
      const content = await invoke<string>("read_file", { path: mainPath });
      const fileName = mainPath.split("/").pop() ?? "main";
      await invoke("set_workspace_root", { path: projectPath });
      useEditorStore.getState().setWorkspacePath(projectPath);
      useEditorStore.getState().openTab(mainPath, fileName, content);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [selected, projectName, onClose, source, templates]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !creating) handleCreate();
  }, [handleCreate, creating]);

  return (
    <div className="template-backdrop" onMouseDown={onClose}>
      <div className="template-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="template-header">
          <span className="template-title">New Project from Template</span>
          <div className="template-source" role="tablist" aria-label="Template source">
            <button
              type="button"
              role="tab"
              aria-selected={source === "built-in"}
              className={source === "built-in" ? "selected" : ""}
              onClick={() => { setSource("built-in"); setCategory("All"); }}
            >
              Built-in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === "universe"}
              className={source === "universe" ? "selected" : ""}
              onClick={() => { setSource("universe"); setCategory("All"); }}
            >
              Typst Universe
            </button>
          </div>
        </div>

        <div className="template-body">
          {templatesLoading && <div className="template-loading">Loading templates…</div>}
          {!templatesLoading && templates.length === 0 && (
            <div className="template-loading">No templates found.</div>
          )}
          {!templatesLoading && templates.length > 0 && (
            <>
              {source === "universe" && (
                <button
                  type="button"
                  className="template-universe-link"
                  onClick={() => openUrl("https://typst.app/universe/search/?kind=templates")}
                >
                  Browse on typst.app
                  <ExternalLink size={13} />
                </button>
              )}
              <div className="template-filter" role="tablist" aria-label="Template category">
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={category === item}
                    className={`template-filter-option${category === item ? " selected" : ""}`}
                    onClick={() => setCategory(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <label className="template-search">
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search templates"
                  aria-label="Search templates"
                />
              </label>
              {visibleTemplates.length === 0 ? (
                <div className="template-loading">No matching templates.</div>
              ) : (
                <div className="template-grid">
                  {visibleTemplates.map((t) => (
                    <button
                      key={t.id}
                      className={`template-card${selected === t.id ? " selected" : ""}`}
                      onClick={() => setSelected(t.id)}
                      onDoubleClick={handleCreate}
                    >
                      <TemplateThumbnail template={t} />
                      <div className="template-card-info">
                        <div className="template-card-name">{t.name}</div>
                        {t.version && <div className="template-card-version">@preview/{t.id}:{t.version}</div>}
                        <div className="template-card-desc">{t.description}</div>
                        <span
                          className="template-badge"
                          style={{ background: CATEGORY_COLORS[t.category] ?? "var(--template-badge-general)" }}
                        >
                          {t.category}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="template-name-row">
          <label className="template-name-label" htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            className="template-name-input"
            type="text"
            value={projectName}
            onChange={(e) => { setProjectName(e.target.value); setError(null); }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {error && <div className="template-error">{error}</div>}

        <div className="template-footer">
          <button className="template-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="template-btn-create"
            onClick={handleCreate}
            disabled={!selected || creating || !projectName.trim()}
          >
            {creating ? "Creating…" : "Choose Location…"}
          </button>
        </div>
      </div>
    </div>
  );
}
