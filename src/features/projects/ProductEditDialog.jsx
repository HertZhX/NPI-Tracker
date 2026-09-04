import { useId, useState } from "react";
import { PencilLine, X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus.js";

export function ProductEditDialog({ open, project, product, onClose, onSave }) {
  const titleId = useId();
  const [name, setName] = useState(product?.name ?? "");
  const [partNumber, setPartNumber] = useState(product?.partNumber ?? "");
  const [version, setVersion] = useState(product?.version ?? "");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const dialogRef = useModalFocus(open, busy ? undefined : onClose);

  if (!open || !product) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    const input = { name: name.trim(), partNumber: partNumber.trim(), version: version.trim() };
    const nextErrors = {};
    if (!input.name) nextErrors.name = "请输入产品名称";
    if (!input.partNumber) nextErrors.partNumber = "请输入产品料号";
    if (!input.version) nextErrors.version = "请输入产品版本";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    if (
      input.name === product.name
      && input.partNumber === (product.partNumber ?? "")
      && input.version === (product.version ?? "")
    ) {
      onClose?.();
      return;
    }
    setBusy(true);
    try {
      const accepted = await onSave?.(input);
      if (accepted === false) return;
      onClose?.();
    } catch (saveError) {
      setErrors((current) => ({
        ...current,
        save: saveError instanceof Error ? saveError.message : "产品信息保存失败",
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog product-edit-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><PencilLine size={20} /></span>
            <div>
              <h2 id={titleId}>编辑产品信息</h2>
              <p className="dialog-subtitle">{project?.code} · {product.partNumber || "无料号"}</p>
            </div>
          </div>
          <button className="icon-button dialog-close" type="button" aria-label="关闭编辑产品信息对话框" onClick={onClose}><X size={20} /></button>
        </header>

        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={`${titleId}-name`}>产品名称</label>
            <input
              id={`${titleId}-name`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setErrors((current) => ({ ...current, name: "" }));
              }}
              maxLength={500}
              autoComplete="off"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              required
              disabled={busy}
            />
            {errors.name ? <p className="form-error" role="alert">{errors.name}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-part-number`}>产品料号</label>
            <input
              id={`${titleId}-part-number`}
              value={partNumber}
              onChange={(event) => {
                setPartNumber(event.target.value);
                setErrors((current) => ({ ...current, partNumber: "" }));
              }}
              maxLength={500}
              autoComplete="off"
              aria-invalid={Boolean(errors.partNumber)}
              required
              disabled={busy}
            />
            {errors.partNumber ? <p className="form-error" role="alert">{errors.partNumber}</p> : null}
            <p className="form-help">同一项目下以料号和产品名称共同区分产品。</p>
          </div>
          <div className="form-field">
            <label htmlFor={`${titleId}-version`}>产品版本</label>
            <input
              id={`${titleId}-version`}
              value={version}
              onChange={(event) => {
                setVersion(event.target.value);
                setErrors((current) => ({ ...current, version: "" }));
              }}
              maxLength={500}
              placeholder="例如 V1.0"
              autoComplete="off"
              aria-invalid={Boolean(errors.version)}
              required
              disabled={busy}
            />
            {errors.version ? <p className="form-error" role="alert">{errors.version}</p> : null}
            <p className="form-help">版本为手动维护的文本，不需要上传文件，后续可随时更新。</p>
          </div>
          {errors.save ? <p className="form-error" role="alert">{errors.save}</p> : null}
          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>取消</button>
            <button className="button button-primary" type="submit" disabled={busy}><PencilLine size={16} />{busy ? "正在保存…" : "保存产品信息"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default ProductEditDialog;
