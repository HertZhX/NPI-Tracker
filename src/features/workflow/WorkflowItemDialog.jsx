import { useId, useState } from "react";
import { ListPlus, X } from "lucide-react";
import { JOB_ROLE_OPTIONS } from "../../domain/accounts.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function WorkflowItemDialog({ open, project, product, phase, onClose, onCreate }) {
  const titleId = useId();
  const roleListId = `${titleId}-roles`;
  const [form, setForm] = useState({
    kind: phase?.type === "MP" ? "deliverable" : "checkpoint",
    title: "",
    criterion: "",
    ownerRole: "",
    baselineDate: phase?.planDate ?? "",
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !project || !product || !phase) return null;

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "", save: "" }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const input = {
      ...form,
      title: form.title.trim(),
      criterion: form.criterion.trim(),
      ownerRole: form.ownerRole.trim(),
    };
    const nextErrors = {};
    if (!input.title) nextErrors.title = "请输入事项名称";
    if (!input.baselineDate) nextErrors.baselineDate = "请选择计划日期";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    setBusy(true);
    try {
      const saved = await onCreate?.(input);
      if (saved === false) return;
      onClose?.();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        save: error instanceof Error ? error.message : "阶段事项创建失败",
      }));
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="dialog workflow-item-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><ListPlus size={20} /></span>
            <div>
              <h2 id={titleId}>新增阶段事项</h2>
              <p className="dialog-subtitle">{project.code} · {product.partNumber} · {product.name} · {phase.type}</p>
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={requestClose} disabled={busy} aria-label="关闭新增阶段事项对话框"><X size={20} /></button>
        </header>

        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={`${titleId}-kind`}>事项类型</label>
            <select id={`${titleId}-kind`} value={form.kind} onChange={(event) => updateField("kind", event.target.value)} autoFocus disabled={busy}>
              {phase.type === "MP" ? <option value="deliverable">交付文件</option> : null}
              <option value="checkpoint">关键任务</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-title`}>事项名称</label>
            <input id={`${titleId}-title`} value={form.title} onChange={(event) => updateField("title", event.target.value)} maxLength={500} autoComplete="off" disabled={busy} aria-invalid={Boolean(errors.title)} required />
            {errors.title ? <p className="form-error" role="alert">{errors.title}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-criterion`}>交付 / 验收标准</label>
            <textarea id={`${titleId}-criterion`} value={form.criterion} onChange={(event) => updateField("criterion", event.target.value)} rows="3" maxLength={10_000} disabled={busy} placeholder="例如：完成评审、签字并受控归档" />
          </div>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-role`}>默认角色</label>
              <input id={`${titleId}-role`} value={form.ownerRole} onChange={(event) => updateField("ownerRole", event.target.value)} list={roleListId} maxLength={500} autoComplete="off" disabled={busy} />
              <datalist id={roleListId}>{JOB_ROLE_OPTIONS.map((role) => <option key={role} value={role} />)}</datalist>
            </div>
            <div className="form-field">
              <label htmlFor={`${titleId}-date`}>计划日期</label>
              <input id={`${titleId}-date`} type="date" value={form.baselineDate} onChange={(event) => updateField("baselineDate", event.target.value)} disabled={busy} aria-invalid={Boolean(errors.baselineDate)} required />
              {errors.baselineDate ? <p className="form-error" role="alert">{errors.baselineDate}</p> : null}
            </div>
          </div>
          {errors.save ? <p className="form-error" role="alert">{errors.save}</p> : null}
          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>取消</button>
            <button className="button button-primary" type="submit" disabled={busy}><ListPlus size={16} />{busy ? "正在创建…" : "创建事项"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default WorkflowItemDialog;
