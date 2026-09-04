import { useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileUp,
  Link2,
  ReceiptText,
  Trash2,
  X,
} from "lucide-react";
import { isAssignedToAccount } from "../../domain/accounts.js";
import { BOM_STATUS } from "../../domain/bom.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";
import { npiApi } from "../../services/api.js";
import { matchQuotationRows, parseQuotationTable } from "../../services/quotation.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = new Set(["xlsx", "csv"]);
const MAX_PREVIEW_ROWS = 12;

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function matchCount(quotation) {
  if (quotation.matchedItemCount) return quotation.matchedItemCount;
  if (quotation.matches?.length) return new Set(quotation.matches.map(({ bomItemId }) => bomItemId)).size;
  return quotation.bomItemId ? 1 : 0;
}

export function QuotationDialog({
  open,
  onClose,
  items = [],
  initialItemId = "",
  quotations = [],
  accounts = [],
  currentAccount = null,
  canManage = false,
  onUpload,
  onDelete,
}) {
  const titleId = useId();
  const dialogRef = useModalFocus(open, onClose);
  const fileInputRef = useRef(null);
  const allowedItems = useMemo(() => items.filter((item) => (
    item.status !== BOM_STATUS.REMOVED
    && (canManage || isAssignedToAccount(item, currentAccount, accounts))
  )), [accounts, canManage, currentAccount, items]);
  const focusedItem = allowedItems.find(({ id }) => id === initialItemId) ?? null;
  const [vendor, setVendor] = useState("");
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const matchResult = useMemo(
    () => parsed ? matchQuotationRows(parsed.rows, allowedItems, vendor) : null,
    [allowedItems, parsed, vendor],
  );
  const previewRows = useMemo(() => {
    if (!matchResult) return [];
    return [
      ...matchResult.matches.map((row) => ({ ...row, matched: true, reason: "已匹配" })),
      ...matchResult.unmatched.map((row) => ({ ...row, matched: false })),
    ].toSorted((left, right) => left.sourceRow - right.sourceRow).slice(0, MAX_PREVIEW_ROWS);
  }, [matchResult]);

  if (!open) return null;

  function resetFile() {
    setFile(null);
    setParsed(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(event) {
    const nextFile = event.target.files?.[0] ?? null;
    setError("");
    setParsed(null);
    if (!nextFile) {
      setFile(null);
      return;
    }
    const extension = nextFile.name.includes(".")
      ? nextFile.name.split(".").pop().toLowerCase()
      : "";
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      resetFile();
      setError("整表匹配仅支持 .xlsx 或 .csv 报价单");
      return;
    }
    if (!nextFile.size || nextFile.size > MAX_FILE_BYTES) {
      resetFile();
      setError("报价单必须大于 0 B，且不能超过 10 MB");
      return;
    }
    setFile(nextFile);
    setParsing(true);
    try {
      setParsed(await parseQuotationTable(nextFile));
    } catch (reason) {
      resetFile();
      setError(reason instanceof Error ? reason.message : "报价单解析失败");
    } finally {
      setParsing(false);
    }
  }

  async function submitQuotation() {
    if (!file || !matchResult?.matches.length || busy || parsing) return;
    setBusy(true);
    setError("");
    try {
      const uploaded = await onUpload?.({
        vendor: vendor.trim(),
        file,
        matches: matchResult.matches,
      });
      if (uploaded === false) return;
      resetFile();
      setVendor("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报价单导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuotation(quotationId) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onDelete?.(quotationId);
      setConfirmDeleteId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报价单删除失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog quotation-dialog quotation-dialog--batch" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon"><ReceiptText size={20} /></span>
            <div><h2 id={titleId}>报价单整表导入</h2><p className="dialog-subtitle">上传一张包含全部材料价格的表格，系统按料号自动匹配 BOM</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭报价单窗口"><X size={20} /></button>
        </header>

        <div className="quotation-dialog__body">
          {allowedItems.length ? (
            <>
              <div className="quotation-batch-intro">
                <span><FileSpreadsheet size={18} /></span>
                <div>
                  <b>当前范围：{allowedItems.length} 种可匹配 BOM 材料</b>
                  <p>{focusedItem ? `从料号 ${focusedItem.code} 打开；导入时仍会匹配整张 BOM。` : "系统同时识别 BOM 料号和厂内料号。"}</p>
                </div>
              </div>

              <label className="form-field quotation-vendor-field">
                <span>默认报价供应商 <small>选填</small></span>
                <input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="表内没有供应商列时使用，例如：风华" maxLength={500} />
              </label>

              <label className={`quotation-dropzone ${file ? "has-file" : ""}`}>
                {file ? <FileCheck2 size={24} /> : <FileUp size={24} />}
                <strong>{file ? file.name : "选择整表报价单"}</strong>
                <span>{file ? `${formatSize(file.size)}${parsing ? " · 正在识别料号和单价…" : ""}` : "支持 .xlsx 或 .csv，需包含“料号”和“单价”列，文件不超过 10 MB"}</span>
                <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleFile} disabled={busy || parsing} />
              </label>
              {error ? <p className="form-error" role="alert"><AlertTriangle size={16} />{error}</p> : null}

              {matchResult ? (
                <section className="quotation-preview" aria-label="报价单匹配预览">
                  <header>
                    <div><h3>匹配预览</h3><p>{parsed.sheetName} · 表头第 {parsed.headerRow} 行 · 共读取 {parsed.rows.length} 条报价</p></div>
                    <span>上传前请确认</span>
                  </header>
                  <div className="quotation-preview__metrics">
                    <div><small>匹配材料</small><strong>{matchResult.matchedMaterialCount}</strong></div>
                    <div><small>匹配报价行</small><strong>{matchResult.matches.length}</strong></div>
                    <div className={matchResult.unmatched.length ? "is-warning" : ""}><small>未匹配 / 无效</small><strong>{matchResult.unmatched.length}</strong></div>
                    <div><small>重复料号行</small><strong>{matchResult.duplicateRowCount}</strong></div>
                  </div>
                  <div className="quotation-preview__table-wrap">
                    <table className="quotation-preview__table">
                      <thead><tr><th>来源行</th><th>报价料号</th><th>BOM 材料</th><th>单价</th><th>供应商</th><th>结果</th></tr></thead>
                      <tbody>{previewRows.map((row) => (
                        <tr key={`${row.sourceRow}-${row.materialCode}-${row.bomItemId || "unmatched"}`} className={row.matched ? "is-matched" : "is-unmatched"}>
                          <td>{row.sourceRow}</td>
                          <td><b>{row.materialCode}</b></td>
                          <td>{row.matched ? <><b>{row.bomCode}</b><small>{row.bomName}</small></> : "—"}</td>
                          <td>{row.unitPrice ? <b>{row.unitPrice} {row.currency}</b> : (row.rawPrice || "—")}</td>
                          <td>{row.vendor || vendor || "—"}</td>
                          <td><span>{row.matched ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{row.reason}</span></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  {parsed.rows.length > MAX_PREVIEW_ROWS ? <p className="quotation-preview__more">仅预览前 {MAX_PREVIEW_ROWS} 行；上传时会处理全部 {parsed.rows.length} 行。</p> : null}
                </section>
              ) : null}

              <section className="quotation-history" aria-label="已导入报价单">
                <header><div><h3>已导入报价单</h3><p>原始文件只保存一份，匹配价格分别关联到 BOM 料号</p></div><span>{quotations.length} 份</span></header>
                {quotations.length ? (
                  <ul>
                    {quotations.map((quotation) => {
                      const canDelete = canManage || quotation.uploadedByAccountId === currentAccount?.id;
                      return (
                        <li key={quotation.id}>
                          <span className="quotation-file-icon"><ReceiptText size={18} /></span>
                          <span className="quotation-file-copy"><b>{quotation.fileName}</b><small>{quotation.vendor} · 匹配 {matchCount(quotation)} 种材料 · {formatSize(quotation.size)} · {quotation.uploadedBy} · {formatDateTime(quotation.uploadedAt)}</small></span>
                          <a className="quotation-download" href={npiApi.quotationDownloadUrl(quotation.id)} download><Download size={15} />下载</a>
                          {canDelete ? (
                            confirmDeleteId === quotation.id ? (
                              <span className="quotation-delete-confirm"><button type="button" onClick={() => setConfirmDeleteId("")} disabled={busy}>取消</button><button type="button" onClick={() => deleteQuotation(quotation.id)} disabled={busy}>确认删除</button></span>
                            ) : (
                              <button className="quotation-delete" type="button" onClick={() => setConfirmDeleteId(quotation.id)} disabled={busy} aria-label={`删除报价单 ${quotation.fileName}`}><Trash2 size={15} /></button>
                            )
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : <div className="quotation-empty"><Link2 size={22} /><span>还没有导入整表报价单</span></div>}
              </section>
            </>
          ) : (
            <div className="quotation-empty quotation-empty--large"><AlertTriangle size={24} /><strong>没有可匹配报价的材料</strong><span>请先导入 BOM，或让管理员把材料分配给当前账号。</span></div>
          )}
        </div>

        <footer className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>关闭</button>
          <button className="button button-primary" type="button" onClick={submitQuotation} disabled={!file || !matchResult?.matches.length || busy || parsing}>
            <FileUp size={16} />{busy ? "正在导入…" : matchResult?.matches.length ? `导入并匹配 ${matchResult.matches.length} 条` : "导入报价单"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default QuotationDialog;
