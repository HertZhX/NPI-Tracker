import { useId, useState } from "react";
import { PackagePlus, Plus, Trash2, X } from "lucide-react";
import { STANDARD_STAGE_TYPES, STAGE_TEMPLATES } from "../../domain/workflow.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

const DEFAULT_STAGE_TYPES = [STANDARD_STAGE_TYPES[0]];

function today() {
  return new Date().toLocaleDateString("en-CA");
}

function defaultManager(accounts, currentAccountId) {
  return accounts.find((account) => account.id === currentAccountId && account.active)
    ?? accounts.find(({ active }) => active)
    ?? null;
}

function createProductDraft(key, manager) {
  return {
    key,
    name: "",
    partNumber: "",
    version: "",
    manager: manager?.name ?? "",
    managerAccountId: manager?.id ?? "",
    stageTypes: [...DEFAULT_STAGE_TYPES],
  };
}

function createEmptyForm(accounts, currentAccountId) {
  const manager = defaultManager(accounts, currentAccountId);
  return {
    code: "",
    name: "",
    startDate: today(),
    products: [createProductDraft("product-1", manager)],
  };
}

function ManagerOptions({ accounts }) {
  return (
    <>
      <option value="">请选择成员</option>
      {accounts.filter(({ active }) => active).map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {account.jobRole} · {account.department}
        </option>
      ))}
    </>
  );
}

function ManagerSelect({ id, value, accounts, error, onChange, label = "产品负责人" }) {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={onChange}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        required
      >
        <ManagerOptions accounts={accounts} />
      </select>
      {error ? <p className="form-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}

function StageTypeSelector({ id, value, error, onChange }) {
  function selectEndStage(type) {
    const endIndex = STANDARD_STAGE_TYPES.indexOf(type);
    onChange(STANDARD_STAGE_TYPES.slice(0, endIndex + 1));
  }

  return (
    <fieldset className="stage-type-selector" aria-describedby={error ? `${id}-error` : undefined}>
      <legend>预计推进范围</legend>
      <div>
        {STANDARD_STAGE_TYPES.map((type) => (
          <label key={type} className={value.includes(type) ? "is-selected" : ""}>
            <input
              type="radio"
              name={`${id}-end-stage`}
              checked={value.at(-1) === type}
              onChange={() => selectEndStage(type)}
            />
            <span><b>{type}</b><small>{STAGE_TEMPLATES[type].shortLabel}</small></span>
          </label>
        ))}
      </div>
      {error ? <p className="form-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </fieldset>
  );
}

export default function ProjectDialog({ open, onClose, onCreate, accounts = [], currentAccountId = "" }) {
  const titleId = useId();
  const [form, setForm] = useState(() => createEmptyForm(accounts, currentAccountId));
  const [errors, setErrors] = useState({});
  const dialogRef = useModalFocus(open, onClose);

  if (!open) return null;

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
    setErrors((current) => ({ ...current, [name]: "" }));
  }

  function updateProduct(key, patch) {
    setForm((current) => ({
      ...current,
      products: current.products.map((product) => product.key === key ? { ...product, ...patch } : product),
    }));
    setErrors((current) => ({ ...current, products: "" }));
  }

  function addProductRow() {
    const manager = defaultManager(accounts, currentAccountId);
    setForm((current) => ({
      ...current,
      products: [
        ...current.products,
        createProductDraft(`product-${Date.now()}-${current.products.length}`, manager),
      ],
    }));
  }

  function removeProductRow(key) {
    setForm((current) => ({
      ...current,
      products: current.products.length > 1
        ? current.products.filter((product) => product.key !== key)
        : current.products,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const cleaned = {
      code: form.code.trim(),
      name: form.name.trim(),
      startDate: form.startDate.trim(),
      products: form.products.map(({ name, partNumber, version, manager, managerAccountId, stageTypes }) => ({
        name: name.trim(),
        partNumber: partNumber.trim(),
        version: version.trim(),
        manager: manager.trim(),
        managerAccountId: managerAccountId.trim(),
        stageTypes,
      })),
    };
    const nextErrors = {};
    if (!cleaned.code) nextErrors.code = "请输入项目代码";
    if (!cleaned.name) nextErrors.name = "请输入项目名称";
    if (!cleaned.startDate) nextErrors.startDate = "请选择项目启动日期";
    if (cleaned.products.some(({ name }) => !name)) {
      nextErrors.products = "请填写每个产品的名称";
    } else if (cleaned.products.some(({ partNumber }) => !partNumber)) {
      nextErrors.products = "请填写每个产品的料号";
    } else if (cleaned.products.some(({ version }) => !version)) {
      nextErrors.products = "请填写每个产品的版本";
    } else if (cleaned.products.some(({ managerAccountId }) => !managerAccountId)) {
      nextErrors.products = "请为每个产品选择负责人";
    } else if (cleaned.products.some(({ stageTypes }) => !stageTypes.length)) {
      nextErrors.products = "请为每个产品至少选择一个适用阶段";
    } else if (new Set(cleaned.products.map(({ name }) => name.toLocaleLowerCase())).size !== cleaned.products.length) {
      nextErrors.products = "同一项目下的产品名称不能重复";
    } else if (new Set(cleaned.products.map(({ partNumber }) => partNumber.toLocaleLowerCase())).size !== cleaned.products.length) {
      nextErrors.products = "同一项目下的产品料号不能重复";
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    const accepted = onCreate?.(cleaned);
    if (accepted === false) return;
    onClose?.();
  }

  return (
    <div className="dialog-backdrop project-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog project-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><Plus size={20} /></span>
            <div><h2 id={titleId}>新建项目</h2><p className="dialog-subtitle">项目下可同时建立多个产品</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" aria-label="关闭新建项目对话框" onClick={onClose}><X size={20} /></button>
        </header>

        <form className="dialog-form project-dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-code`}>项目代码</label>
              <input
                id={`${titleId}-code`}
                name="code"
                type="text"
                value={form.code}
                onChange={handleChange}
                aria-invalid={Boolean(errors.code)}
                aria-describedby={errors.code ? `${titleId}-code-error` : undefined}
                autoComplete="off"
                autoFocus
                required
              />
              {errors.code ? <p className="form-error" id={`${titleId}-code-error`} role="alert">{errors.code}</p> : null}
            </div>
            <div className="form-field">
              <label htmlFor={`${titleId}-name`}>项目名称</label>
              <input
                id={`${titleId}-name`}
                name="name"
                type="text"
                value={form.name}
                onChange={handleChange}
                aria-invalid={Boolean(errors.name)}
                placeholder="例如 智能控制器新品导入"
                autoComplete="off"
                required
              />
              {errors.name ? <p className="form-error" role="alert">{errors.name}</p> : null}
            </div>
          </div>

          <div className="form-grid form-grid-two-columns">
            <div className="form-field">
              <label htmlFor={`${titleId}-start-date`}>项目启动日期</label>
              <input
                id={`${titleId}-start-date`}
                name="startDate"
                type="date"
                value={form.startDate}
                onChange={handleChange}
                aria-invalid={Boolean(errors.startDate)}
                aria-describedby={errors.startDate ? `${titleId}-start-date-error` : undefined}
                required
              />
              {errors.startDate ? <p className="form-error" id={`${titleId}-start-date-error`} role="alert">{errors.startDate}</p> : null}
            </div>
          </div>

          <fieldset className="product-list-fieldset">
            <legend className="sr-only">产品清单</legend>
            <div className="product-list-heading">
              <div><strong>产品清单</strong><p>每个产品可按实际流程选择不同的适用阶段</p></div>
              <button className="button button-secondary product-add-row" type="button" onClick={addProductRow}><Plus size={15} />添加产品</button>
            </div>
            <div className="product-input-columns" aria-hidden="true">
              <span />
              <b>产品名称</b>
              <b>产品料号</b>
              <b>产品版本</b>
              <b>产品负责人</b>
              <span />
            </div>
            <div className="product-input-list">
              {form.products.map((product, index) => (
                <div className="product-input-item" key={product.key}>
                  <div className="product-input-row">
                    <span aria-hidden="true">{index + 1}</span>
                    <label className="sr-only" htmlFor={`${titleId}-${product.key}`}>产品 {index + 1} 名称</label>
                    <input
                      id={`${titleId}-${product.key}`}
                      type="text"
                      value={product.name}
                      onChange={(event) => updateProduct(product.key, { name: event.target.value })}
                      placeholder={`产品 ${index + 1} 名称`}
                      aria-invalid={Boolean(errors.products)}
                      autoComplete="off"
                    />
                    <label className="sr-only" htmlFor={`${titleId}-${product.key}-part-number`}>产品 {index + 1} 料号</label>
                    <input
                      id={`${titleId}-${product.key}-part-number`}
                      type="text"
                      value={product.partNumber}
                      onChange={(event) => updateProduct(product.key, { partNumber: event.target.value })}
                      placeholder={`产品 ${index + 1} 料号`}
                      aria-invalid={Boolean(errors.products && !product.partNumber)}
                      autoComplete="off"
                    />
                    <label className="sr-only" htmlFor={`${titleId}-${product.key}-version`}>产品 {index + 1} 版本</label>
                    <input
                      id={`${titleId}-${product.key}-version`}
                      type="text"
                      value={product.version}
                      onChange={(event) => updateProduct(product.key, { version: event.target.value })}
                      placeholder="例如 V1.0"
                      maxLength={500}
                      aria-invalid={Boolean(errors.products && !product.version)}
                      autoComplete="off"
                    />
                    <label className="sr-only" htmlFor={`${titleId}-${product.key}-manager`}>产品 {index + 1} 负责人</label>
                    <select
                      id={`${titleId}-${product.key}-manager`}
                      value={product.managerAccountId}
                      onChange={(event) => {
                        const manager = accounts.find((account) => account.id === event.target.value);
                        updateProduct(product.key, {
                          manager: manager?.name ?? "",
                          managerAccountId: event.target.value,
                        });
                      }}
                      aria-invalid={Boolean(errors.products && !product.managerAccountId)}
                      required
                    >
                      <ManagerOptions accounts={accounts} />
                    </select>
                    <button
                      className="icon-button product-remove-row"
                      type="button"
                      onClick={() => removeProductRow(product.key)}
                      aria-label={`删除产品 ${index + 1}`}
                      disabled={form.products.length === 1}
                    ><Trash2 size={16} /></button>
                  </div>
                  <StageTypeSelector
                    id={`${titleId}-${product.key}-stages`}
                    value={product.stageTypes}
                    error={errors.products && !product.stageTypes.length ? "至少选择一个阶段" : ""}
                    onChange={(stageTypes) => updateProduct(product.key, { stageTypes })}
                  />
                </div>
              ))}
            </div>
            {errors.products ? <p className="form-error" role="alert">{errors.products}</p> : null}
          </fieldset>

          <p className="form-help">系统只为勾选的阶段生成标准任务和交付文件；未勾选阶段不计入产品完成条件。</p>

          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>取消</button>
            <button className="button button-primary" type="submit">创建项目</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function ProductDialog({
  open,
  project,
  accounts = [],
  currentAccountId = "",
  onClose,
  onCreate,
}) {
  const titleId = useId();
  const initialManager = defaultManager(accounts, currentAccountId);
  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [version, setVersion] = useState("");
  const [managerAccountId, setManagerAccountId] = useState(initialManager?.id ?? "");
  const [startDate, setStartDate] = useState(today());
  const [stageTypes, setStageTypes] = useState([...DEFAULT_STAGE_TYPES]);
  const [errors, setErrors] = useState({});
  const dialogRef = useModalFocus(open, onClose);
  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    const manager = accounts.find((account) => account.id === managerAccountId);
    const input = {
      name: name.trim(),
      partNumber: partNumber.trim(),
      version: version.trim(),
      manager: manager?.name ?? "",
      managerAccountId,
      startDate,
      stageTypes,
    };
    if (!input.name) {
      setErrors({ name: "请输入产品名称" });
      return;
    }
    if (!input.partNumber) {
      setErrors({ partNumber: "请输入产品料号" });
      return;
    }
    if (!input.version) {
      setErrors({ version: "请输入产品版本" });
      return;
    }
    if (!input.managerAccountId) {
      setErrors({ managerAccountId: "请选择产品负责人" });
      return;
    }
    if (!input.stageTypes.length) {
      setErrors({ stageTypes: "请至少选择一个适用阶段" });
      return;
    }
    const accepted = onCreate?.(input);
    if (accepted === false) return;
    onClose?.();
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog product-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon" aria-hidden="true"><PackagePlus size={20} /></span>
            <div><h2 id={titleId}>新增产品</h2><p className="dialog-subtitle">添加到项目 {project?.code}</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" aria-label="关闭新增产品对话框" onClick={onClose}><X size={20} /></button>
        </header>
        <form className="dialog-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={`${titleId}-name`}>产品名称</label>
            <input id={`${titleId}-name`} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: "" })); }} autoFocus autoComplete="off" aria-invalid={Boolean(errors.name)} />
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
              autoComplete="off"
              aria-invalid={Boolean(errors.partNumber)}
            />
            {errors.partNumber ? <p className="form-error" role="alert">{errors.partNumber}</p> : null}
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
              placeholder="例如 V1.0"
              maxLength={500}
              autoComplete="off"
              aria-invalid={Boolean(errors.version)}
              required
            />
            {errors.version ? <p className="form-error" role="alert">{errors.version}</p> : null}
          </div>
          <ManagerSelect
            id={`${titleId}-manager`}
            value={managerAccountId}
            accounts={accounts}
            error={errors.managerAccountId}
            onChange={(event) => {
              setManagerAccountId(event.target.value);
              setErrors((current) => ({ ...current, managerAccountId: "" }));
            }}
          />
          <div className="form-field">
            <label htmlFor={`${titleId}-date`}>产品启动日期</label>
            <input id={`${titleId}-date`} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
          </div>
          <StageTypeSelector
            id={`${titleId}-stages`}
            value={stageTypes}
            error={errors.stageTypes}
            onChange={(value) => {
              setStageTypes(value);
              setErrors((current) => ({ ...current, stageTypes: "" }));
            }}
          />
          <p className="form-help">选择预计结束阶段，系统会按 P → EB → PP → MP 连续建立；后续仍可继续补充下一阶段。</p>
          <footer className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>取消</button>
            <button className="button button-primary" type="submit">新增产品</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
