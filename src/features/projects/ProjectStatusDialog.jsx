import { useId, useState } from "react";
import { CheckCircle2, RotateCcw, X } from "lucide-react";
import { PROJECT_STATUS } from "../../domain/projects.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function ProjectStatusDialog({ open, project, onClose, onSave }) {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !project) return null;

  const reopening = project.status === PROJECT_STATUS.COMPLETED;
  const targetStatus = reopening ? PROJECT_STATUS.ACTIVE : PROJECT_STATUS.COMPLETED;
  const Icon = reopening ? RotateCcw : CheckCircle2;

  async function handleSubmit(event) {
    event.preventDefault();
    const cleanedNote = note.trim();
    if (!cleanedNote) {
      setError(reopening ? "请填写恢复项目的说明" : "请填写提前完结说明");
      return;
    }
    if (busy) return;

    setBusy(true);
    setError("");
    try {
      const saved = await onSave?.({ status: targetStatus, note: cleanedNote });
      if (saved === false) return;
      onClose?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "项目状态更新失败");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section
        className="dialog project-status-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
      >
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><Icon size={20} /></span>
            <div>
              <h2 id={titleId}>{reopening ? "恢复项目" : "提前完结项目"}</h2>
              <p className="dialog-subtitle">{project.code} · {project.products?.length ?? 0} 个产品</p>
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={requestClose} disabled={busy} aria-label="关闭项目状态对话框"><X size={20} /></button>
        </header>

        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="project-status-notice" id={descriptionId}>
            <Icon size={19} aria-hidden="true" />
            <div>
              <strong>{reopening ? "项目将重新归入进行中" : "未完成事项会保留，但项目会立即归入已完成"}</strong>
              <p>{reopening ? "恢复后可以继续维护产品、阶段和交付事项。" : "该操作不会删除产品、阶段、任务、文件或材料，后续仍可恢复。"}</p>
            </div>
          </div>

          {reopening && project.completionNote ? (
            <div className="project-status-history">
              <span>上次完结说明</span>
              <p>{project.completionNote}</p>
            </div>
          ) : null}

          <div className="form-field">
            <label htmlFor={`${titleId}-note`}>{reopening ? "恢复说明" : "提前完结说明"}</label>
            <textarea
              id={`${titleId}-note`}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setError("");
              }}
              rows="4"
              maxLength={10_000}
              autoFocus
              disabled={busy}
              aria-invalid={Boolean(error)}
              placeholder={reopening ? "例如：客户确认重新启动该项目" : "例如：客户取消、方案终止或转入其他流程"}
              required
            />
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>取消</button>
            <button className="button button-primary" type="submit" disabled={busy}>
              <Icon size={16} aria-hidden="true" />{busy ? "正在保存…" : reopening ? "恢复项目" : "确认提前完结"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default ProjectStatusDialog;
