import { useId, useState } from "react";
import { PencilLine, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function RenameDialog({
  open,
  kind,
  currentValue = "",
  contextLabel = "",
  onClose,
  onRename,
}) {
  const titleId = useId();
  const inputId = `${titleId}-name`;
  const errorId = `${titleId}-error`;
  const helpId = `${titleId}-help`;
  const [value, setValue] = useState(currentValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open) return null;

  const isProject = kind === "project";
  const subject = isProject ? "项目" : "新品";

  async function handleSubmit(event) {
    event.preventDefault();
    const cleaned = value.trim();
    if (!cleaned) {
      setError(`请输入${subject}名称`);
      return;
    }
    if (cleaned === currentValue.trim()) {
      onClose?.();
      return;
    }
    setBusy(true);
    try {
      const accepted = await onRename?.(cleaned);
      if (accepted === false) return;
      onClose?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "名称保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section
        className="dialog rename-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><PencilLine size={20} /></span>
            <div>
              <h2 id={titleId}>重命名{subject}</h2>
              {contextLabel ? <p className="dialog-subtitle">{contextLabel}</p> : null}
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" aria-label={`关闭重命名${subject}对话框`} onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <form className="dialog-form rename-dialog__form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={inputId}>{isProject ? "项目名称" : "新品名称"}</label>
            <input
              id={inputId}
              type="text"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError("");
              }}
              maxLength={isProject ? 200 : 500}
              autoComplete="off"
              autoFocus
              required
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${errorId} ${helpId}` : helpId}
            />
            {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}
            <p className="form-help" id={helpId}>只修改显示名称，不影响料号、阶段、任务及历史记录。</p>
          </div>

          <footer className="dialog-actions rename-dialog__actions">
            <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="button button-primary" type="submit" disabled={busy}>
              <PencilLine size={16} aria-hidden="true" /> {busy ? "正在保存…" : "保存名称"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default RenameDialog;
