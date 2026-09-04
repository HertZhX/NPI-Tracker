import { useId, useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";
import { parseNpiWorkbook } from "../../services/excel.js";

export function ImportDialog({ open, onClose, onImport, currentProject, currentPhase }) {
  const titleId = useId();
  const [preview, setPreview] = useState(null);
  const [selectedCode, setSelectedCode] = useState(currentProject?.code || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const dialogRef = useModalFocus(open, onClose);

  const codes = useMemo(
    () => [...new Set((preview?.materials || []).map((material) => material.projectCode).filter(Boolean))],
    [preview],
  );
  const selectedMaterials = useMemo(
    () => (preview?.materials || []).filter((material) => !selectedCode || material.projectCode === selectedCode),
    [preview, selectedCode],
  );
  const projectMismatch = Boolean(
    selectedCode && currentProject?.code && selectedCode !== currentProject.code,
  );

  if (!open) return null;

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const result = await parseNpiWorkbook(file);
      setPreview(result);
      const currentMatch = result.materials.some((material) => material.projectCode === currentProject?.code);
      setSelectedCode(currentMatch ? currentProject.code : result.projectCodeHint || result.materials[0]?.projectCode || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Excel读取失败");
      setPreview(null);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog import-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading"><span className="dialog-icon"><FileSpreadsheet size={20} /></span><h2 id={titleId}>导入Excel推进表</h2></div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭导入窗口"><X size={20} /></button>
        </header>
        <div className="import-dialog__body">
          <p className="import-target">导入到 <strong>{currentProject?.code}</strong> · <strong>{currentPhase?.label}</strong></p>
          <label className="import-dropzone">
            <Upload size={22} />
            <strong>{loading ? "正在解析…" : "选择 .xlsx 推进表"}</strong>
            <span>识别第2行交付物、第3行职责、第4行起物料</span>
            <input type="file" accept=".xlsx" onChange={handleFile} disabled={loading} />
          </label>
          {error ? <p className="form-error" role="alert"><AlertTriangle size={16} />{error}</p> : null}
          {preview ? (
            <div className="import-preview">
              <div className="import-preview__summary"><b>{preview.fileName}</b><span>{preview.definitions.length} 个交付项</span><span>{preview.materials.length} 条物料</span></div>
              {codes.length > 1 ? (
                <label className="form-field"><span>本次导入的项目行</span><select value={selectedCode} onChange={(event) => setSelectedCode(event.target.value)}>{codes.map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
              ) : null}
              {projectMismatch ? (
                <p className="form-error" role="alert"><AlertTriangle size={16} />当前打开的是 {currentProject.code}，请先切换到 {selectedCode} 项目后再导入，避免资料落入错误项目。</p>
              ) : null}
              {preview.warnings.length ? <ul className="import-warnings">{preview.warnings.map((warning) => <li key={warning}><AlertTriangle size={15} />{warning}</li>)}</ul> : null}
              <div className="import-table-wrap"><table><thead><tr><th>物料编码</th><th>物料名称</th><th>数量</th><th>交期</th></tr></thead><tbody>{selectedMaterials.slice(0, 8).map((material) => <tr key={`${material.sourceRow}-${material.code}`}><td>{material.code}</td><td>{material.name}</td><td>{material.quantity || "—"}</td><td>{material.dueDate || "—"}</td></tr>)}</tbody></table></div>
            </div>
          ) : null}
        </div>
        <footer className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>取消</button>
          <button
            className="button button-primary"
            type="button"
            disabled={!preview || !selectedMaterials.length || projectMismatch}
            onClick={() => onImport?.({
              definitions: preview.definitions,
              materials: selectedMaterials,
              projectCode: selectedCode,
            })}
          >
            导入 {selectedMaterials.length || ""} 条物料
          </button>
        </footer>
      </section>
    </div>
  );
}
