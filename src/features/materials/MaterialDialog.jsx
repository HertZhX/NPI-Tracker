import { useId, useState } from "react";
import { Boxes, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function MaterialDialog({ open, project, phase, onClose, onCreate }) {
  const titleId = useId();
  const [form, setForm] = useState({
    code: "",
    name: "",
    quantity: phase?.quantity || "",
    dueDate: phase?.planDate || "",
  });
  const [error, setError] = useState("");
  const dialogRef = useModalFocus(open, onClose);

  if (!open) return null;

  function submit(event) {
    event.preventDefault();
    const code = form.code.trim();
    const name = form.name.trim();
    if (!code || !name) {
      setError("物料编码和名称不能为空");
      return;
    }
    const accepted = onCreate?.({ code, name, quantity: Number(form.quantity) || 0, dueDate: form.dueDate });
    if (accepted === false) return;
    onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog material-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header"><div className="dialog-heading"><span className="dialog-icon"><Boxes size={20} /></span><div><h2 id={titleId}>新增物料</h2><p className="dialog-subtitle">{project?.code} · {phase?.label}</p></div></div><button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭新增物料"><X size={20} /></button></header>
        <form className="dialog-form" onSubmit={submit}>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field"><label htmlFor="material-code">物料编码</label><input id="material-code" autoFocus value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} /></div>
            <div className="form-field"><label htmlFor="material-name">物料名称</label><input id="material-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
          </div>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field"><label htmlFor="material-quantity">需求数量</label><input id="material-quantity" type="number" min="0" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></div>
            <div className="form-field"><label htmlFor="material-date">交期</label><input id="material-date" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} /></div>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>取消</button><button className="button button-primary" type="submit">创建物料</button></footer>
        </form>
      </section>
    </div>
  );
}
