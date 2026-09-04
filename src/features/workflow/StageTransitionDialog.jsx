import { useId, useState } from "react";
import { ArrowRight, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { STANDARD_STAGE_TYPES, STAGE_TEMPLATES } from "../../domain/workflow.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

const DEFAULT_QUANTITY = { P: 5, EB: 30, PP: 100, MP: 200 };

function addDays(value, days) {
  const source = new Date(`${String(value || new Date().toISOString()).slice(0, 10)}T00:00:00.000Z`);
  source.setUTCDate(source.getUTCDate() + days);
  return source.toISOString().slice(0, 10);
}

export function StageTransitionDialog({
  open,
  product,
  phase,
  nextPhase = null,
  onClose,
  onSubmit,
}) {
  const titleId = useId();
  const currentIndex = STANDARD_STAGE_TYPES.indexOf(phase?.type);
  const nextType = nextPhase?.type ?? STANDARD_STAGE_TYPES[currentIndex + 1] ?? null;
  const [note, setNote] = useState("");
  const [planDate, setPlanDate] = useState(nextPhase?.planDate ?? addDays(phase?.planDate, 30));
  const [quantity, setQuantity] = useState(nextPhase?.quantity ?? DEFAULT_QUANTITY[nextType] ?? 1);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useModalFocus(open, busyAction ? undefined : onClose);

  if (!open || !product || !phase) return null;

  async function submit(action) {
    const cleanedNote = note.trim();
    if (!cleanedNote) {
      setError("请填写阶段评审结论");
      return;
    }
    setBusyAction(action);
    setError("");
    try {
      const saved = await onSubmit?.({
        action,
        note: cleanedNote,
        ...(action === "advance" && !nextPhase ? {
          planDate,
          quantity: Number(quantity),
        } : {}),
      });
      if (saved === false) return;
      onClose?.();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "阶段流转失败");
    } finally {
      setBusyAction("");
    }
  }

  function requestClose() {
    if (!busyAction) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="dialog stage-transition-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={Boolean(busyAction)}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><ArrowRight size={20} /></span>
            <div><h2 id={titleId}>完成 {phase.type} 阶段</h2><p className="dialog-subtitle">{product.name} · {phase.label}</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={requestClose} disabled={Boolean(busyAction)} aria-label="关闭阶段流转对话框"><X size={20} /></button>
        </header>
        <div className="dialog-form">
          <div className="stage-transition-notice"><CheckCircle2 size={20} /><span><strong>阶段门条件已满足</strong><small>启动会、准入内容和阶段后评审会均已完成。</small></span></div>
          <div className="form-field">
            <label htmlFor={`${titleId}-note`}>阶段评审结论</label>
            <textarea id={`${titleId}-note`} value={note} onChange={(event) => { setNote(event.target.value); setError(""); }} rows="4" maxLength={10_000} placeholder="记录评审结论、遗留问题和流转决定" autoFocus disabled={Boolean(busyAction)} />
          </div>
          {nextType && !nextPhase ? (
            <fieldset className="stage-transition-next">
              <legend>新建下一阶段：{STAGE_TEMPLATES[nextType]?.label ?? nextType}</legend>
              <div className="form-grid form-grid-two-columns">
                <div className="form-field"><label htmlFor={`${titleId}-date`}>计划日期</label><input id={`${titleId}-date`} type="date" value={planDate} onChange={(event) => setPlanDate(event.target.value)} disabled={Boolean(busyAction)} /></div>
                <div className="form-field"><label htmlFor={`${titleId}-quantity`}>计划数量</label><input id={`${titleId}-quantity`} type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={Boolean(busyAction)} /></div>
              </div>
            </fieldset>
          ) : nextPhase ? <p className="form-help">下一阶段已配置：{nextPhase.label}，计划日期 {nextPhase.planDate || "未填写"}。</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions stage-transition-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={Boolean(busyAction)}>取消</button>
            {phase.type !== "MP" ? <button className="button button-secondary" type="button" onClick={() => submit("complete_product")} disabled={Boolean(busyAction)}>{busyAction === "complete_product" ? <LoaderCircle className="attachment-preview-spinner" size={16} /> : <CheckCircle2 size={16} />}在 {phase.type} 结束产品</button> : null}
            {nextType ? <button className="button button-primary" type="button" onClick={() => submit("advance")} disabled={Boolean(busyAction)}>{busyAction === "advance" ? <LoaderCircle className="attachment-preview-spinner" size={16} /> : <ArrowRight size={16} />}进入 {nextType}</button> : <button className="button button-primary" type="button" onClick={() => submit("complete_product")} disabled={Boolean(busyAction)}>{busyAction ? <LoaderCircle className="attachment-preview-spinner" size={16} /> : <CheckCircle2 size={16} />}完成产品流程</button>}
          </footer>
        </div>
      </section>
    </div>
  );
}

export default StageTransitionDialog;
