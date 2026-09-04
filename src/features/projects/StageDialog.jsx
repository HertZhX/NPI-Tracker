import { useId, useState } from "react";
import { CalendarPlus, CheckCircle2, X } from "lucide-react";
import { STANDARD_STAGE_TYPES, STAGE_TEMPLATES } from "../../domain/workflow.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

const STAGE_QUANTITIES = Object.freeze({ P: 5, EB: 30, PP: 100, MP: 200 });

function addDays(value, days) {
  const source = value ? new Date(`${value}T00:00:00.000Z`) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function suggestedPlanDate(type, phases) {
  const targetIndex = STANDARD_STAGE_TYPES.indexOf(type);
  const previousPhase = phases
    .filter((phase) => STANDARD_STAGE_TYPES.indexOf(phase.type) < targetIndex)
    .toSorted((left, right) => (
      STANDARD_STAGE_TYPES.indexOf(right.type) - STANDARD_STAGE_TYPES.indexOf(left.type)
    ))[0];
  const previousIndex = previousPhase ? STANDARD_STAGE_TYPES.indexOf(previousPhase.type) : -1;
  return addDays(previousPhase?.planDate, previousPhase ? (targetIndex - previousIndex) * 30 : 30);
}

function createInitialForm(availableTypes, phases) {
  const type = availableTypes[0] ?? "";
  return {
    type,
    label: STAGE_TEMPLATES[type]?.label ?? type,
    planDate: suggestedPlanDate(type, phases),
    quantity: String(STAGE_QUANTITIES[type] ?? ""),
  };
}

export default function StageDialog({ open, availableTypes = [], phases = [], onClose, onCreate }) {
  const titleId = useId();
  const [form, setForm] = useState(() => createInitialForm(availableTypes, phases));
  const [errors, setErrors] = useState({});
  const dialogRef = useModalFocus(open, onClose);

  if (!open || !availableTypes.length) return null;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => name === "type" ? {
      ...current,
      type: value,
      label: STAGE_TEMPLATES[value]?.label ?? value,
      planDate: suggestedPlanDate(value, phases),
      quantity: String(STAGE_QUANTITIES[value] ?? ""),
    } : { ...current, [name]: value });
    setErrors((current) => ({ ...current, [name]: "" }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    const nextErrors = {};
    if (!form.planDate) nextErrors.planDate = "请选择计划日期";
    if (!Number.isInteger(quantity) || quantity <= 0) {
      nextErrors.quantity = "计划数量必须是大于 0 的整数";
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const accepted = onCreate?.({
      type: form.type,
      label: STAGE_TEMPLATES[form.type]?.label ?? form.type,
      planDate: form.planDate,
      quantity,
    });
    if (accepted === false) return;
    onClose?.();
  };

  return (
    <div
      className="dialog-backdrop stage-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className="dialog stage-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><CalendarPlus size={20} /></span>
            <div>
              <h2 id={titleId}>新增产品阶段</h2>
              <p className="dialog-subtitle">按产品实际流程补充适用阶段</p>
            </div>
          </div>
          <button
            className="icon-button dialog-close"
            type="button"
            aria-label="关闭新增阶段对话框"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>

        <form className="dialog-form stage-dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="stage-unlock-notice">
            <CheckCircle2 size={18} aria-hidden="true" />
            可直接选择任一未配置阶段；创建后会生成该阶段的标准任务和交付文件。
          </div>

          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-type`}>阶段类型</label>
              <select id={`${titleId}-type`} name="type" value={form.type} onChange={handleChange} autoFocus>
                {availableTypes.map((type) => <option key={type} value={type}>{type} · {STAGE_TEMPLATES[type].shortLabel}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor={`${titleId}-label`}>阶段名称</label>
              <input id={`${titleId}-label`} value={form.label} readOnly />
            </div>
          </div>

          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-planned-date`}>计划日期</label>
              <input
                id={`${titleId}-planned-date`}
                name="planDate"
                type="date"
                value={form.planDate}
                onChange={handleChange}
                aria-invalid={Boolean(errors.planDate)}
                required
              />
              {errors.planDate ? <p className="form-error" role="alert">{errors.planDate}</p> : null}
            </div>

            <div className="form-field">
              <label htmlFor={`${titleId}-planned-quantity`}>计划数量</label>
              <input
                id={`${titleId}-planned-quantity`}
                name="quantity"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={form.quantity}
                onChange={handleChange}
                aria-invalid={Boolean(errors.quantity)}
                required
              />
              {errors.quantity ? <p className="form-error" role="alert">{errors.quantity}</p> : null}
            </div>
          </div>

          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>取消</button>
            <button className="button button-primary" type="submit">创建 {form.type} 阶段</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
