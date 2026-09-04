import { useId, useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function DeleteProductDialog({ open, project, product, onClose, onDelete }) {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const confirmationId = `${titleId}-confirmation`;
  const errorId = `${titleId}-error`;
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !project || !product) return null;

  const confirmationText = product.partNumber || product.name;
  const confirmed = confirmation.trim() === confirmationText;

  async function handleSubmit(event) {
    event.preventDefault();
    if (!confirmed || busy) return;

    setBusy(true);
    setError("");
    try {
      await onDelete?.(project.id, product.id);
      onClose?.();
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "产品删除失败";
      const requestId = requestError?.requestId ? `（请求 ${requestError.requestId}）` : "";
      setError(`${message}${requestId}`);
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section
        className="dialog delete-project-dialog"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
      >
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon delete-project-dialog__icon" aria-hidden="true">
              <Trash2 size={20} />
            </span>
            <div>
              <h2 id={titleId}>永久删除产品</h2>
              <p className="dialog-subtitle">{project.code} · {product.partNumber ? `${product.partNumber} · ` : ""}{product.name}</p>
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" aria-label="关闭删除产品确认框" onClick={requestClose} disabled={busy}>
            <X size={20} />
          </button>
        </header>

        <form className="dialog-form delete-project-dialog__form" onSubmit={handleSubmit}>
          <div className="delete-project-dialog__warning" id={descriptionId}>
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <strong>删除后无法恢复</strong>
              <p>该产品的阶段、文件事项、物料、任务、BOM、报价匹配及导入记录都会被永久删除。</p>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor={confirmationId}>输入 <strong>{confirmationText}</strong> 以确认</label>
            <input
              id={confirmationId}
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError("");
              }}
              autoComplete="off"
              spellCheck="false"
              disabled={busy}
              aria-invalid={Boolean(confirmation && !confirmed)}
              aria-describedby={error ? errorId : descriptionId}
              autoFocus
            />
          </div>

          {error ? <p className="form-error" id={errorId} role="alert">{error}</p> : null}

          <footer className="dialog-actions delete-project-dialog__actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>取消</button>
            <button className="button button-danger" type="submit" disabled={!confirmed || busy}>
              <Trash2 size={16} aria-hidden="true" />
              {busy ? "正在删除…" : "永久删除产品"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default DeleteProductDialog;
