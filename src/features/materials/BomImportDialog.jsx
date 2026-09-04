import { useId, useMemo, useState } from "react";
import { AlertTriangle, FileSpreadsheet, PackageSearch, Upload, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";
import { parseBomWorkbook } from "../../services/bom.js";

const CREATE_PARENT = "__create_parent__";

export function BomImportDialog({
  open,
  onClose,
  onImport,
  currentProject,
  currentPhase,
  materials = [],
}) {
  const titleId = useId();
  const dialogRef = useModalFocus(open, onClose);
  const [preview, setPreview] = useState(null);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [parentMaterialId, setParentMaterialId] = useState(CREATE_PARENT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedSheet = useMemo(
    () => preview?.sheets.find((sheet) => sheet.name === selectedSheetName) ?? null,
    [preview, selectedSheetName],
  );
  const projectMismatch = Boolean(
    selectedSheet?.projectCode
    && currentProject?.code
    && selectedSheet.projectCode !== currentProject.code,
  );

  if (!open) return null;

  function selectSheet(result, sheetName) {
    const sheet = result.sheets.find((item) => item.name === sheetName) ?? result.sheets[0];
    setSelectedSheetName(sheet.name);
    const matchingMaterial = materials.find((material) => (
      sheet.assemblyCode
      && material.code.toLocaleLowerCase() === sheet.assemblyCode.toLocaleLowerCase()
    ));
    setParentMaterialId(matchingMaterial?.id ?? CREATE_PARENT);
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const result = await parseBomWorkbook(file);
      setPreview(result);
      selectSheet(result, result.defaultSheetName);
    } catch (reason) {
      setPreview(null);
      setSelectedSheetName("");
      setError(reason instanceof Error ? reason.message : "BOM 读取失败");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  function submitImport() {
    if (!preview || !selectedSheet || projectMismatch) return;
    const accepted = onImport?.({
      parentMaterialId: parentMaterialId === CREATE_PARENT ? null : parentMaterialId,
      meta: {
        fileName: preview.fileName,
        sheetName: selectedSheet.name,
        productModel: selectedSheet.productModel,
        projectCode: selectedSheet.projectCode,
        assemblyCode: selectedSheet.assemblyCode,
        assemblyName: selectedSheet.assemblyName,
        version: selectedSheet.version,
      },
      items: selectedSheet.items,
    });
    if (accepted !== false) onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog bom-import-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon"><FileSpreadsheet size={20} /></span>
            <div><h2 id={titleId}>导入 BOM 材料</h2><p className="dialog-subtitle">逐个料号确认当前阶段是否准备完成</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭 BOM 导入窗口"><X size={20} /></button>
        </header>

        <div className="bom-import-dialog__body">
          <p className="import-target">导入到 <strong>{currentProject?.code}</strong> · <strong>{currentPhase?.label}</strong></p>
          <label className="import-dropzone">
            <Upload size={22} />
            <strong>{loading ? "正在解析…" : "选择 .xlsx BOM 文件"}</strong>
            <span>自动识别 CODE、NAME、SPEC、Quantity、供应商及 MPN</span>
            <input type="file" accept=".xlsx" onChange={handleFile} disabled={loading} />
          </label>
          {error ? <p className="form-error" role="alert"><AlertTriangle size={16} />{error}</p> : null}

          {selectedSheet ? (
            <div className="bom-import-preview">
              <div className="bom-import-preview__summary">
                <span><b>{selectedSheet.items.length}</b><small>种有效材料</small></span>
                <span><b>{selectedSheet.productModel || "—"}</b><small>产品型号</small></span>
                <span><b>{selectedSheet.version || "—"}</b><small>BOM 版本</small></span>
                <span><b>{selectedSheet.assemblyCode || "—"}</b><small>成品料号</small></span>
              </div>

              <div className="bom-import-preview__options">
                <label className="form-field">
                  <span>读取工作表</span>
                  <select value={selectedSheetName} onChange={(event) => selectSheet(preview, event.target.value)}>
                    {preview.sheets.map((sheet) => <option key={sheet.name} value={sheet.name}>{sheet.name}（{sheet.items.length} 种）</option>)}
                  </select>
                </label>
                <label className="form-field">
                  <span>归属组件</span>
                  <select value={parentMaterialId} onChange={(event) => setParentMaterialId(event.target.value)}>
                    <option value={CREATE_PARENT}>自动新建：{selectedSheet.assemblyCode || currentProject.code} · {selectedSheet.assemblyName}</option>
                    {materials.map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name}</option>)}
                  </select>
                </label>
              </div>

              {projectMismatch ? (
                <p className="form-error" role="alert"><AlertTriangle size={16} />BOM 属于 {selectedSheet.projectCode}，当前打开的是 {currentProject.code}。请先切换或新建正确项目，避免材料混入其他项目。</p>
              ) : null}
              {selectedSheet.warnings.length ? (
                <ul className="import-warnings">{selectedSheet.warnings.slice(0, 5).map((warning) => <li key={warning}><AlertTriangle size={15} />{warning}</li>)}</ul>
              ) : null}

              <div className="bom-preview-table-wrap">
                <table>
                  <thead><tr><th>物料编码</th><th>名称 / 规格</th><th>厂内编码</th><th>单位用量</th><th>供应商</th></tr></thead>
                  <tbody>{selectedSheet.items.slice(0, 8).map((item) => (
                    <tr key={`${item.sourceRow}-${item.code}`}>
                      <td>{item.code}</td>
                      <td><b>{item.name}</b><small>{item.comment || item.spec || "—"}</small></td>
                      <td>{item.internalCode || "—"}</td>
                      <td>{item.unitQuantity || "—"}</td>
                      <td>{item.vendors.join(" / ") || "—"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="bom-preview-note"><PackageSearch size={15} />导入后全部为“待确认”；再次导入时保留未变化料号的确认结果，已变化料号会重新待确认。</p>
            </div>
          ) : null}
        </div>

        <footer className="dialog-actions">
          <button className="button button-secondary" type="button" onClick={onClose}>取消</button>
          <button className="button button-primary" type="button" disabled={!selectedSheet || projectMismatch || loading} onClick={submitImport}>
            导入 {selectedSheet?.items.length || ""} 种材料
          </button>
        </footer>
      </section>
    </div>
  );
}

export default BomImportDialog;
