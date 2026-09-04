import { useEffect, useId, useState } from "react";
import { AlertTriangle, Download, FileQuestion, LoaderCircle, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";
import { npiApi } from "../../services/api.js";
import {
  attachmentPreviewKind,
  parseAttachmentPreview,
} from "../../services/attachmentPreview.js";

export function AttachmentPreviewDialog({ attachment, open, onClose }) {
  const titleId = useId();
  const dialogRef = useModalFocus(open, onClose);
  const kind = attachmentPreviewKind(attachment);
  const shouldLoad = Boolean(
    open && attachment && kind !== "unsupported" && (attachment.id || attachment.file),
  );
  const [state, setState] = useState({
    loading: shouldLoad,
    error: "",
    url: "",
    data: null,
  });

  useEffect(() => {
    if (!shouldLoad) return undefined;
    let cancelled = false;
    let objectUrl = "";
    const load = async () => {
      try {
        const blob = attachment.file ?? await npiApi.getAttachmentPreview(attachment.id);
        if (cancelled) return;
        if (kind === "image" || kind === "pdf") {
          objectUrl = URL.createObjectURL(blob);
          setState({ loading: false, error: "", url: objectUrl, data: null });
          return;
        }
        const data = await parseAttachmentPreview(blob, attachment.name);
        if (!cancelled) setState({ loading: false, error: "", url: "", data });
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            error: error instanceof Error ? error.message : "附件预览加载失败",
            url: "",
            data: null,
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, kind, shouldLoad]);

  if (!open || !attachment) return null;
  const downloadUrl = attachment.id ? npiApi.attachmentDownloadUrl(attachment.id) : "";

  return (
    <div
      className="attachment-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className="attachment-preview-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="attachment-preview-header">
          <div>
            <h2 id={titleId}>{attachment.name}</h2>
            <p>{attachment.id ? "已上传附件" : attachment.file ? "待上传附件" : "历史附件记录"}</p>
          </div>
          <div className="attachment-preview-actions">
            {downloadUrl ? (
              <a className="button button-secondary" href={downloadUrl} download>
                <Download size={15} />下载
              </a>
            ) : null}
            <button className="icon-button" type="button" aria-label="关闭附件预览" onClick={onClose}>
              <X size={19} />
            </button>
          </div>
        </header>

        <div className="attachment-preview-body">
          {!attachment.id && !attachment.file ? (
            <div className="attachment-preview-message">
              <FileQuestion size={34} />
              <strong>该历史记录没有文件内容</strong>
              <span>请删除后重新选择并上传原文件。</span>
            </div>
          ) : kind === "unsupported" ? (
            <div className="attachment-preview-message">
              <FileQuestion size={34} />
              <strong>该格式暂不支持在线预览</strong>
              <span>可以下载后使用本机的 Word、PowerPoint 或 Excel 打开。</span>
            </div>
          ) : state.loading ? (
            <div className="attachment-preview-message">
              <LoaderCircle className="attachment-preview-spinner" size={32} />
              <strong>正在加载预览…</strong>
            </div>
          ) : state.error ? (
            <div className="attachment-preview-message is-error" role="alert">
              <AlertTriangle size={32} />
              <strong>无法打开附件</strong>
              <span>{state.error}</span>
            </div>
          ) : kind === "image" && state.url ? (
            <img className="attachment-preview-image" src={state.url} alt={attachment.name} />
          ) : kind === "pdf" && state.url ? (
            <iframe className="attachment-preview-frame" src={state.url} title={attachment.name} />
          ) : kind === "text" && state.data ? (
            <div className="attachment-preview-text-wrap">
              <pre>{state.data.text || "（空文件）"}</pre>
              {state.data.truncated ? <p>内容较长，仅显示前 200,000 个字符。</p> : null}
            </div>
          ) : kind === "table" && state.data ? (
            <div className="attachment-preview-table-layout">
              <p>
                {state.data.sheetName} · {state.data.totalRows} 行 · {state.data.totalColumns} 列
                {state.data.truncated ? " · 仅显示前 100 行、30 列" : ""}
              </p>
              <div className="attachment-preview-table-wrap">
                <table>
                  <tbody>
                    {state.data.rows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        <th>{rowIndex + 1}</th>
                        {row.map((cell, columnIndex) => (
                          <td key={`cell-${rowIndex}-${columnIndex}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export default AttachmentPreviewDialog;
