import { useId, useState } from "react";
import { Archive, LoaderCircle, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function WorkflowArchiveDialog({ open, item, onClose, onArchive }) {
  const titleId = useId();
  const [reason, setReason] = useState("当前产品阶段不适用");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !item) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    const cleaned = reason.trim();
    if (!cleaned) {
      setError("请填写停用原因");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await onArchive?.(cleaned);
      if (saved === false) return;
      onClose?.();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "阶段事项停用失败");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="dialog workflow-archive-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><Archive size={20} /></span>
            <div><h2 id={titleId}>停用阶段事项</h2><p className="dialog-subtitle">{item.stageType} · {item.title}</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={requestClose} disabled={busy} aria-label="关闭停用阶段事项对话框"><X size={20} /></button>
        </header>
        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <p className="form-help">停用后该事项不再参与阶段门计算，历史记录和附件仍会保留，并可随时恢复。</p>
          <div className="form-field">
            <label htmlFor={`${titleId}-reason`}>停用原因</label>
            <textarea id={`${titleId}-reason`} value={reason} onChange={(event) => { setReason(event.target.value); setError(""); }} rows="3" maxLength={2_000} autoFocus disabled={busy} />
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>取消</button>
            <button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="attachment-preview-spinner" size={16} /> : <Archive size={16} />}{busy ? "正在停用…" : "确认停用"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default WorkflowArchiveDialog;
