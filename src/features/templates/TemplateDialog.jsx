import { useId, useState } from "react";
import { Plus, Settings2, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function TemplateDialog({ open, definitions, onClose, onAdd }) {
  const titleId = useId();
  const [form, setForm] = useState({ label: "", category: "资料与程序", defaultRole: "PE" });
  const [error, setError] = useState("");
  const dialogRef = useModalFocus(open, onClose);

  if (!open) return null;

  function submit(event) {
    event.preventDefault();
    const label = form.label.trim();
    if (!label) {
      setError("请输入交付项名称");
      return;
    }
    onAdd?.({ ...form, label });
    setForm((current) => ({ ...current, label: "" }));
    setError("");
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog template-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading"><span className="dialog-icon"><Settings2 size={20} /></span><div><h2 id={titleId}>标准交付物模板</h2><p className="dialog-subtitle">新增项目和物料会自动套用这套清单</p></div></div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭模板管理"><X size={20} /></button>
        </header>
        <div className="template-dialog__body">
          <div className="template-list" aria-label="当前模板交付项">
            {definitions.map((definition, index) => (
              <div className="template-list__row" key={definition.key}>
                <span className="template-list__index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{definition.label}</strong>
                <span>{definition.category}</span>
                <b>{definition.defaultRole}</b>
              </div>
            ))}
          </div>
          <form className="template-add" onSubmit={submit}>
            <div className="form-field"><label htmlFor="template-label">新增交付项</label><input id="template-label" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="例如：可靠性报告" /></div>
            <div className="form-field"><label htmlFor="template-category">分类</label><select id="template-category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>资料与程序</option><option>工装</option><option>材料</option></select></div>
            <div className="form-field"><label htmlFor="template-role">默认角色</label><input id="template-role" value={form.defaultRole} onChange={(event) => setForm({ ...form, defaultRole: event.target.value })} /></div>
            <button className="button button-primary" type="submit"><Plus size={16} />加入模板</button>
          </form>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <footer className="dialog-actions"><button className="button button-secondary" type="button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  );
}
