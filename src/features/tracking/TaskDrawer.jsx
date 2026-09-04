import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, FileText, Paperclip, Save, Trash2, X } from "lucide-react";
import {
  JOB_ROLE_OPTIONS,
  accountAssignmentPatch,
  findAccountForAssignment,
} from "../../domain/accounts.js";
import { STATUS_OPTIONS } from "../../domain/statuses.js";
import {
  MAX_ATTACHMENTS_PER_ENTITY,
  validateAttachmentFiles,
} from "../../services/attachmentPreview.js";
import AttachmentPreviewDialog from "./AttachmentPreviewDialog.jsx";

const EDITABLE_FIELDS = [
  "title",
  "criterion",
  "status",
  "owner",
  "ownerAccountId",
  "ownerRole",
  "baselineDate",
  "forecastDate",
  "blocker",
  "notes",
  "fileVersion",
];

function normalizeEvidence(evidence) {
  const evidenceItems = Array.isArray(evidence) ? evidence : evidence ? [evidence] : [];

  return evidenceItems
    .map((item) => (typeof item === "string" ? { name: item, size: 0 } : item))
    .filter((item) => item && item.name)
    .map((item) => ({
      id: item.stored ? String(item.id || "") : "",
      stored: Boolean(item.stored),
      name: String(item.name),
      type: String(item.type || item.file?.type || ""),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      addedAt: String(item.addedAt || ""),
      addedByAccountId: String(item.addedByAccountId || ""),
      addedBy: String(item.addedBy || ""),
      localId: String(item.localId || ""),
      file: item.file,
    }));
}

function persistedEvidence(evidence) {
  return normalizeEvidence(evidence)
    .filter(({ file }) => !file)
    .map(({ file: _file, localId: _localId, ...item }) => item);
}

function evidenceIdentity(evidence) {
  return normalizeEvidence(evidence).map(({ id, localId, name, size }) => ({ id, localId, name, size }));
}

function normalizeDate(value) {
  return value ? String(value).slice(0, 10) : "";
}

function createForm(task, definition, accounts) {
  const account = findAccountForAssignment(task, accounts);
  return {
    title: task?.title || definition?.label || definition?.name || "",
    criterion: task?.criterion || "",
    status: task?.status || "not_reported",
    owner: account?.name || task?.owner || task?.assignee || "",
    ownerAccountId: account?.id || task?.ownerAccountId || "",
    ownerRole: task?.ownerRole || task?.role || definition?.defaultRole || "",
    baselineDate: normalizeDate(task?.baselineDate || task?.dueDate),
    forecastDate: normalizeDate(task?.forecastDate),
    blocker: task?.blocker || task?.blockReason || task?.blockerReason || "",
    notes: task?.notes || task?.remark || "",
    fileVersion: task?.fileVersion || "",
    evidence: normalizeEvidence(task?.evidence || task?.attachments),
  };
}

function areEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatFileSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getMaterialCode(material, task) {
  if (typeof material === "string") return material;
  return (
    material?.partNumber ||
    material?.materialCode ||
    material?.code ||
    task?.partNumber ||
    task?.materialCode ||
    "—"
  );
}

function getDefinitionName(definition, task) {
  if (typeof definition === "string") return definition;
  return definition?.name || definition?.label || definition?.title || task?.definitionName || "—";
}

export default function TaskDrawer({
  open,
  task,
  definition,
  material,
  accounts = [],
  canManage = false,
  canEditDefinition = false,
  showFileVersion = false,
  drawerTitle = "更新交付进度",
  drawerDescription = "修改责任、日期、状态与跟进记录。",
  primaryContextLabel = "料号",
  secondaryContextLabel = "交付项",
  onClose,
  onSave,
}) {
  const titleId = useId();
  const descriptionId = useId();
  const roleListId = useId();
  const fileInputRef = useRef(null);
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);
  const sourceForm = useMemo(
    () => createForm(task, definition, accounts),
    [accounts, definition, task],
  );
  const [form, setForm] = useState(sourceForm);
  const [initialForm, setInitialForm] = useState(sourceForm);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const isDirty = useMemo(() => !areEqual(form, initialForm), [form, initialForm]);
  const assignableAccounts = useMemo(
    () => accounts.filter((account) => account.active || account.id === form.ownerAccountId),
    [accounts, form.ownerAccountId],
  );

  const requestClose = useCallback(() => {
    if (busy) return;
    if (isDirty && !window.confirm("有尚未保存的更改，确定关闭吗？")) return;
    onClose?.();
  }, [busy, isDirty, onClose]);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    return () => previousFocusRef.current?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open || previewAttachment) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, previewAttachment, requestClose]);

  if (!open) return null;

  const updateField = (name, value) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const updateOwner = (accountId) => {
    const account = accounts.find((item) => item.id === accountId) ?? null;
    setForm((current) => ({
      ...current,
      ...accountAssignmentPatch(account),
      ownerRole: account?.jobRole ?? current.ownerRole,
    }));
  };

  const handleFiles = (event) => {
    const selectedFiles = Array.from(event.target.files || []);
    const pendingFiles = form.evidence.filter(({ file }) => file).map(({ file }) => file);
    const persistedCount = form.evidence.length - pendingFiles.length;
    const validationError = validateAttachmentFiles(
      [...pendingFiles, ...selectedFiles],
      persistedCount,
    );
    if (validationError) {
      setErrors((current) => ({ ...current, attachment: validationError }));
      event.target.value = "";
      return;
    }
    const selected = selectedFiles.map((file) => ({
      id: "",
      localId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      addedAt: "",
      addedByAccountId: "",
      addedBy: "",
      file,
    }));

    if (selected.length > 0) {
      setForm((current) => {
        const evidence = [...current.evidence];
        const knownFiles = new Set(
          evidence.map((attachment) => `${attachment.name}:${attachment.size}`),
        );

        selected.forEach((attachment) => {
          const key = `${attachment.name}:${attachment.size}`;
          if (!knownFiles.has(key)) {
            evidence.push(attachment);
            knownFiles.add(key);
          }
        });

        return { ...current, evidence };
      });
      setErrors((current) => {
        if (!current.attachment) return current;
        const next = { ...current };
        delete next.attachment;
        return next;
      });
    }

    event.target.value = "";
  };

  const removeAttachment = (index) => {
    setForm((current) => ({
      ...current,
      evidence: current.evidence.filter((_, attachmentIndex) => attachmentIndex !== index),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const cleaned = {
      ...form,
      title: form.title.trim(),
      criterion: form.criterion.trim(),
      owner: form.owner.trim(),
      ownerRole: form.ownerRole.trim(),
      blocker: form.blocker.trim(),
      notes: form.notes.trim(),
      fileVersion: form.fileVersion.trim(),
      evidence: normalizeEvidence(form.evidence),
    };

    if (canEditDefinition && !cleaned.title) {
      setErrors({ title: "请输入事项名称" });
      return;
    }

    if (cleaned.status === "blocked" && !cleaned.blocker) {
      setErrors({ blocker: "状态为阻塞时，请填写阻塞原因" });
      return;
    }

    const patch = {};
    EDITABLE_FIELDS.forEach((field) => {
      if (!areEqual(cleaned[field], initialForm[field])) patch[field] = cleaned[field];
    });
    const initialAttachmentIds = new Set(
      normalizeEvidence(initialForm.evidence).map(({ id }) => id).filter(Boolean),
    );
    const currentAttachmentIds = new Set(
      cleaned.evidence.map(({ id }) => id).filter(Boolean),
    );
    const deleteIds = [...initialAttachmentIds].filter((id) => !currentAttachmentIds.has(id));
    const pendingFiles = cleaned.evidence.filter(({ file }) => file).map(({ file }) => file);
    const attachmentsChanged = !areEqual(
      evidenceIdentity(cleaned.evidence),
      evidenceIdentity(initialForm.evidence),
    );

    setBusy(true);
    try {
      const saved = await onSave?.({
        patch,
        attachmentChanges: attachmentsChanged ? {
          files: pendingFiles,
          deleteIds,
          legacyEvidence: persistedEvidence(cleaned.evidence).filter(({ id }) => !id),
        } : null,
      });
      if (saved === false) return;
      setInitialForm(cleaned);
      onClose?.();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        save: error instanceof Error ? error.message : "保存失败",
      }));
    } finally {
      setBusy(false);
    }
  };

  const materialCode = getMaterialCode(material, task);
  const definitionName = getDefinitionName(definition, task);

  return (
    <div
      className="drawer-backdrop task-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <aside
        className="drawer task-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="drawer-header">
          <div className="drawer-heading">
            <span className="drawer-icon" aria-hidden="true">
              <FileText size={20} />
            </span>
            <div>
              <h2 id={titleId}>{drawerTitle}</h2>
              <p id={descriptionId}>{drawerDescription}</p>
            </div>
          </div>
          <button
            className="icon-button drawer-close"
            type="button"
            aria-label="关闭任务抽屉"
            onClick={requestClose}
          >
            <X size={20} />
          </button>
        </header>

        <dl className="task-context" aria-label="当前任务">
          <div className="task-context-item">
            <dt>{primaryContextLabel}</dt>
            <dd>{materialCode}</dd>
          </div>
          <div className="task-context-item">
            <dt>{secondaryContextLabel}</dt>
            <dd>{definitionName}</dd>
          </div>
        </dl>

        <form className="drawer-form task-drawer-form" onSubmit={handleSubmit} noValidate>
          {canEditDefinition ? (
            <div className="workflow-definition-fields">
              <div className="form-field">
                <label htmlFor={`${titleId}-workflow-title`}>事项名称</label>
                <input
                  id={`${titleId}-workflow-title`}
                  type="text"
                  value={form.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  maxLength={500}
                  autoComplete="off"
                  aria-invalid={Boolean(errors.title)}
                  autoFocus
                  required
                />
                {errors.title ? <p className="form-error" role="alert">{errors.title}</p> : null}
              </div>
              <div className="form-field">
                <label htmlFor={`${titleId}-workflow-criterion`}>交付 / 验收标准</label>
                <textarea
                  id={`${titleId}-workflow-criterion`}
                  rows="3"
                  value={form.criterion}
                  onChange={(event) => updateField("criterion", event.target.value)}
                  maxLength={10_000}
                />
              </div>
            </div>
          ) : null}

          {showFileVersion ? (
            <div className="form-field file-version-field">
              <label htmlFor={`${titleId}-file-version`}>文件版本</label>
              <input
                id={`${titleId}-file-version`}
                type="text"
                value={form.fileVersion}
                onChange={(event) => updateField("fileVersion", event.target.value)}
                placeholder="例如 R01、V1.2"
                maxLength={500}
                autoComplete="off"
                autoFocus={!canEditDefinition}
              />
              <p className="form-help">手动维护文件当前版本；更新版本不需要重新上传附件。</p>
            </div>
          ) : null}

          <div className="form-field">
            <label htmlFor={`${titleId}-status`}>状态</label>
            <select
              id={`${titleId}-status`}
              value={form.status}
              onChange={(event) => updateField("status", event.target.value)}
              autoFocus={!showFileVersion && !canEditDefinition}
              required
            >
              {STATUS_OPTIONS.map((option) => {
                const value = option.value ?? option.code;
                const label = option.label ?? option.name ?? value;
                return (
                  <option key={value} value={value}>
                    {label}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-owner`}>责任人</label>
              <select
                id={`${titleId}-owner`}
                value={form.ownerAccountId}
                onChange={(event) => updateOwner(event.target.value)}
                disabled={!canManage}
              >
                <option value="">未分配</option>
                {assignableAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.jobRole} · {account.department}{account.active ? "" : "（已停用）"}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label htmlFor={`${titleId}-role`}>角色</label>
              <input
                id={`${titleId}-role`}
                type="text"
                list={roleListId}
                value={form.ownerRole}
                onChange={(event) => updateField("ownerRole", event.target.value)}
                autoComplete="off"
                disabled={!canManage}
              />
              <datalist id={roleListId}>
                {JOB_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-baseline-date`}>基准日期</label>
              <input
                id={`${titleId}-baseline-date`}
                type="date"
                value={form.baselineDate}
                onChange={(event) => updateField("baselineDate", event.target.value)}
                disabled={!canManage}
              />
            </div>

            <div className="form-field">
              <label htmlFor={`${titleId}-forecast-date`}>预测日期</label>
              <input
                id={`${titleId}-forecast-date`}
                type="date"
                value={form.forecastDate}
                onChange={(event) => updateField("forecastDate", event.target.value)}
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor={`${titleId}-block-reason`}>阻塞原因</label>
            <textarea
              id={`${titleId}-block-reason`}
              rows="3"
              value={form.blocker}
              onChange={(event) => updateField("blocker", event.target.value)}
              aria-invalid={Boolean(errors.blocker)}
              aria-describedby={
                errors.blocker ? `${titleId}-block-reason-error` : undefined
              }
            />
            {errors.blocker ? (
              <p className="form-error" id={`${titleId}-block-reason-error`} role="alert">
                <AlertTriangle size={16} aria-hidden="true" />
                {errors.blocker}
              </p>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor={`${titleId}-notes`}>备注</label>
            <textarea
              id={`${titleId}-notes`}
              rows="4"
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
            />
          </div>

          <fieldset className="attachment-fieldset">
            <legend>附件</legend>
            <label className="attachment-picker" htmlFor={`${titleId}-attachments`}>
              <Paperclip size={16} aria-hidden="true" />
              选择附件
            </label>
            <input
              ref={fileInputRef}
              id={`${titleId}-attachments`}
              className="attachment-input"
              type="file"
              multiple
              onChange={handleFiles}
              disabled={busy}
              aria-describedby={`${titleId}-attachment-help`}
            />
            <p className="form-help" id={`${titleId}-attachment-help`}>
              支持 PDF、图片、文本、CSV、Excel、Word 和 PowerPoint；单次新增总量不超过 10 MB，最多 {MAX_ATTACHMENTS_PER_ENTITY} 个。
            </p>
            {errors.attachment ? <p className="form-error" role="alert"><AlertTriangle size={15} />{errors.attachment}</p> : null}

            {form.evidence.length > 0 ? (
              <ul className="attachment-list" aria-label="已选择附件">
                {form.evidence.map((attachment, index) => (
                  <li
                    className={`attachment-item ${attachment.file ? "is-pending" : ""}`}
                    key={attachment.id || attachment.localId || `${attachment.name}-${attachment.size}-${index}`}
                  >
                    <button
                      className="attachment-open"
                      type="button"
                      onClick={() => setPreviewAttachment(attachment)}
                      title={`预览 ${attachment.name}`}
                    >
                      <Eye size={14} />
                      <span className="attachment-name">{attachment.name}</span>
                    </button>
                    {attachment.file ? <span className="attachment-pending">待上传</span> : null}
                    <span className="attachment-size">{formatFileSize(attachment.size)}</span>
                    <button
                      className="icon-button attachment-remove"
                      type="button"
                      aria-label={`移除附件 ${attachment.name}`}
                      onClick={() => removeAttachment(index)}
                      disabled={busy}
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="attachment-empty">暂无附件</p>
            )}
          </fieldset>

          <footer className="drawer-actions">
            {errors.save ? <p className="drawer-save-error" role="alert">{errors.save}</p> : null}
            <button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={busy}>
              <Save size={16} aria-hidden="true" />
              {busy ? "正在保存…" : "保存更改"}
            </button>
          </footer>
        </form>
      </aside>
      <AttachmentPreviewDialog
        key={previewAttachment?.id || previewAttachment?.localId || "attachment-preview"}
        attachment={previewAttachment}
        open={Boolean(previewAttachment)}
        onClose={() => setPreviewAttachment(null)}
      />
    </div>
  );
}
