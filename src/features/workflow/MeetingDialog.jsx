import { useId, useRef, useState } from "react";
import {
  CalendarCheck,
  Download,
  FilePlus2,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { MEETING_STATUS, MEETING_TYPE } from "../../domain/workflow.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";
import { npiApi } from "../../services/api.js";

const STATUS_OPTIONS = [
  { value: MEETING_STATUS.PENDING, label: "待安排" },
  { value: MEETING_STATUS.SCHEDULED, label: "已安排" },
  { value: MEETING_STATUS.COMPLETED, label: "已完成" },
  { value: MEETING_STATUS.CANCELLED, label: "已取消" },
];

function toInputDateTime(value) {
  return String(value || "").slice(0, 16);
}

export function MeetingDialog({
  open,
  meeting,
  phase,
  accounts = [],
  canManage = false,
  onClose,
  onSave,
}) {
  const titleId = useId();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => ({
    subject: meeting?.subject ?? "",
    status: meeting?.status ?? MEETING_STATUS.PENDING,
    scheduledAt: toInputDateTime(meeting?.scheduledAt),
    heldAt: toInputDateTime(meeting?.heldAt),
    attendees: (meeting?.attendees ?? []).join("、"),
    conclusion: meeting?.conclusion ?? "",
    ownerAccountId: meeting?.ownerAccountId ?? "",
  }));
  const [newFiles, setNewFiles] = useState([]);
  const [deleteIds, setDeleteIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !meeting) return null;

  const isKickoff = meeting.type === MEETING_TYPE.KICKOFF;
  const activeAccounts = accounts.filter((account) => (
    account.active || account.id === meeting.ownerAccountId
  ));

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
  }

  function addFiles(files) {
    const selected = [...files];
    setNewFiles((current) => [...current, ...selected]);
  }

  function toggleDelete(attachmentId) {
    setDeleteIds((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.subject.trim()) {
      setError("请输入会议主题");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const patch = {
        subject: form.subject.trim(),
        status: form.status,
        scheduledAt: form.scheduledAt,
        heldAt: form.heldAt,
        attendees: form.attendees
          .split(/[、,，;；\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
        conclusion: form.conclusion.trim(),
        ownerAccountId: form.ownerAccountId,
      };
      const legacyEvidence = (meeting.evidence ?? []).filter((item) => !item.id);
      const hasAttachmentChanges = newFiles.length > 0 || deleteIds.size > 0;
      const saved = await onSave?.({
        patch,
        attachmentChanges: hasAttachmentChanges ? {
          files: newFiles,
          deleteIds: [...deleteIds],
          legacyEvidence,
        } : null,
      });
      if (saved === false) return;
      onClose?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "会议保存失败");
    } finally {
      setBusy(false);
    }
  }

  function requestClose() {
    if (!busy) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="dialog meeting-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><CalendarCheck size={20} /></span>
            <div>
              <h2 id={titleId}>{isKickoff ? "阶段前启动会" : "阶段后评审会"}</h2>
              <p className="dialog-subtitle">{phase?.label ?? meeting.stageType}</p>
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={requestClose} disabled={busy} aria-label="关闭会议对话框"><X size={20} /></button>
        </header>

        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={`${titleId}-subject`}>会议主题</label>
            <input id={`${titleId}-subject`} value={form.subject} onChange={(event) => updateField("subject", event.target.value)} maxLength={500} disabled={busy || !canManage} autoFocus />
          </div>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-status`}>会议状态</label>
              <select id={`${titleId}-status`} value={form.status} onChange={(event) => updateField("status", event.target.value)} disabled={busy || !canManage}>
                {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor={`${titleId}-owner`}>负责人</label>
              <select id={`${titleId}-owner`} value={form.ownerAccountId} onChange={(event) => updateField("ownerAccountId", event.target.value)} disabled={busy || !canManage}>
                <option value="">未分配</option>
                {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.jobRole}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-scheduled`}>计划时间</label>
              <input id={`${titleId}-scheduled`} type="datetime-local" value={form.scheduledAt} onChange={(event) => updateField("scheduledAt", event.target.value)} disabled={busy || !canManage} />
            </div>
            <div className="form-field">
              <label htmlFor={`${titleId}-held`}>实际时间</label>
              <input id={`${titleId}-held`} type="datetime-local" value={form.heldAt} onChange={(event) => updateField("heldAt", event.target.value)} disabled={busy || !canManage} />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-attendees`}>参会人员</label>
            <input id={`${titleId}-attendees`} value={form.attendees} onChange={(event) => updateField("attendees", event.target.value)} maxLength={2_000} placeholder="多人可用顿号或逗号分隔" disabled={busy || !canManage} />
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-conclusion`}>会议结论</label>
            <textarea id={`${titleId}-conclusion`} value={form.conclusion} onChange={(event) => updateField("conclusion", event.target.value)} rows="4" maxLength={10_000} placeholder={isKickoff ? "记录阶段目标、分工和风险" : "记录评审结论和准入决定"} disabled={busy || !canManage} />
          </div>

          <div className="form-field meeting-file-field">
            <span className="form-label">会议文件</span>
            <div className="meeting-file-list">
              {(meeting.evidence ?? []).map((attachment) => (
                <div key={attachment.id || attachment.name} className={deleteIds.has(attachment.id) ? "is-pending-delete" : ""}>
                  <span>{attachment.name}</span>
                  <span>
                    {attachment.id ? <a className="icon-button" href={npiApi.attachmentDownloadUrl(attachment.id)} download aria-label={`下载 ${attachment.name}`}><Download size={15} /></a> : null}
                    {canManage && attachment.id ? <button className="icon-button" type="button" onClick={() => toggleDelete(attachment.id)} disabled={busy} aria-label={`${deleteIds.has(attachment.id) ? "撤销删除" : "删除"} ${attachment.name}`}><Trash2 size={15} /></button> : null}
                  </span>
                </div>
              ))}
              {newFiles.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`}><span>{file.name}（待上传）</span>{canManage ? <button className="icon-button" type="button" onClick={() => setNewFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`移除 ${file.name}`}><X size={15} /></button> : null}</div>
              ))}
              {!meeting.evidence?.length && !newFiles.length ? <small>尚未上传会议文件。</small> : null}
            </div>
            {canManage ? <>
              <input ref={fileInputRef} className="sr-only" type="file" multiple onChange={(event) => addFiles(event.target.files)} />
              <button className="button button-secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}><FilePlus2 size={16} />选择会议文件</button>
            </> : null}
          </div>

          {meeting.type === MEETING_TYPE.GATE_REVIEW ? <p className="form-help">评审会只有在启动会和本阶段准入内容完成后，才能标记为“已完成”。</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>{canManage ? "取消" : "关闭"}</button>
            {canManage ? <button className="button button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="attachment-preview-spinner" size={16} /> : <CalendarCheck size={16} />}{busy ? "正在保存…" : "保存会议"}</button> : null}
          </footer>
        </form>
      </section>
    </div>
  );
}

export default MeetingDialog;
