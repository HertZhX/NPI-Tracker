import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileUp,
  PackageCheck,
  ReceiptText,
  Search,
  UserCheck,
} from "lucide-react";
import { findAccountForAssignment, isAssignedToAccount } from "../../domain/accounts.js";
import {
  BOM_STATUS,
  BOM_STATUS_OPTIONS,
  getBomStatusMeta,
  summarizeBomItems,
} from "../../domain/bom.js";

const STATUS_ORDER = new Map([
  [BOM_STATUS.SHORTAGE, 0],
  [BOM_STATUS.PENDING, 1],
  [BOM_STATUS.PREPARING, 2],
  [BOM_STATUS.READY, 3],
  [BOM_STATUS.NA, 4],
  [BOM_STATUS.REMOVED, 5],
]);

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function MaterialStatus({ status }) {
  const meta = getBomStatusMeta(status);
  return <span className={`bom-status bom-status--${meta.tone}`}>{meta.label}</span>;
}

function StatusSelect({ item, onUpdateItem }) {
  return (
    <select
      className="bom-status-select"
      value={item.status}
      onChange={(event) => onUpdateItem?.(item.id, { status: event.target.value })}
      aria-label={`设置 ${item.code} 的准备状态`}
    >
      {BOM_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function OwnerSelect({ item, accounts, onUpdateItem }) {
  const assignedAccount = findAccountForAssignment(item, accounts);
  const assignableAccounts = accounts.filter((account) => (
    account.active || account.id === assignedAccount?.id
  ));
  return (
    <select
      className="bom-owner-select"
      value={assignedAccount?.id ?? ""}
      onChange={(event) => {
        const account = accounts.find(({ id }) => id === event.target.value) ?? null;
        onUpdateItem?.(item.id, {
          ownerAccountId: account?.id ?? "",
          owner: account?.name ?? "",
        });
      }}
      aria-label={`设置 ${item.code} 的责任人`}
    >
      <option value="">未分配</option>
      {assignableAccounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} · {account.jobRole}{account.active ? "" : "（已停用）"}
        </option>
      ))}
    </select>
  );
}

function QuotationButton({ item, info, mobile = false, enabled, onOpen }) {
  const price = info?.latestMatch
    ? `${info.latestMatch.unitPrice}${info.latestMatch.currency ? ` ${info.latestMatch.currency}` : ""}`
    : "";
  const label = mobile
    ? (price ? `最新报价 ${price} · ${info.count} 份` : info ? `报价单 ${info.count} 份` : "导入整表报价单")
    : (price || (info ? `${info.count} 份` : "导入"));
  return (
    <button
      className={`${mobile ? "bom-mobile-quotation" : "bom-quotation-button"} ${info ? "has-files" : ""}`}
      type="button"
      onClick={() => onOpen?.(item.id)}
      disabled={!onOpen || !enabled}
      aria-label={`管理 ${item.code} 的报价单`}
      title={price ? `最新单价 ${price}，共 ${info.count} 份报价单` : "导入整表报价单"}
    >
      <ReceiptText size={mobile ? 15 : 14} />{label}
    </button>
  );
}

export function MaterialReadinessPage({
  project,
  phase,
  materials = [],
  bomItems = [],
  bomImports = [],
  quotations = [],
  accounts = [],
  currentAccount = null,
  canManage = false,
  focusedMaterialId = "",
  onFocusedMaterialChange,
  onImport,
  onUpdateItem,
  onAssignItems,
  onBulkReady,
  onOpenQuotation,
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [mineOnly, setMineOnly] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");
  const [bulkReadyBusy, setBulkReadyBusy] = useState(false);
  const parentIds = useMemo(() => new Set(bomItems.map((item) => item.parentMaterialId)), [bomItems]);
  const parentMaterials = useMemo(
    () => materials.filter((material) => parentIds.has(material.id)),
    [materials, parentIds],
  );
  const effectiveParentId = focusedMaterialId && parentIds.has(focusedMaterialId)
    ? focusedMaterialId
    : "all";
  const scopedItems = useMemo(
    () => bomItems.filter((item) => effectiveParentId === "all" || item.parentMaterialId === effectiveParentId),
    [bomItems, effectiveParentId],
  );
  const summary = useMemo(() => summarizeBomItems(scopedItems), [scopedItems]);
  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return scopedItems
      .filter((item) => {
        if (item.status === BOM_STATUS.REMOVED && statusFilter !== BOM_STATUS.REMOVED) return false;
        if (statusFilter !== "all" && item.status !== statusFilter) return false;
        const assignedAccount = findAccountForAssignment(item, accounts);
        if (ownerFilter === "unassigned" && assignedAccount) return false;
        if (ownerFilter !== "all" && ownerFilter !== "unassigned" && assignedAccount?.id !== ownerFilter) return false;
        if (mineOnly && !isAssignedToAccount(item, currentAccount, accounts)) return false;
        if (!query) return true;
        return [
          item.code,
          item.name,
          item.internalCode,
          item.comment,
          item.spec,
          item.description,
          item.designator,
          ...item.vendors,
          ...item.mpns,
        ].join(" ").toLocaleLowerCase().includes(query);
      })
      .toSorted((a, b) => (
        (STATUS_ORDER.get(a.status) ?? 9) - (STATUS_ORDER.get(b.status) ?? 9)
        || String(a.itemNo).localeCompare(String(b.itemNo), "zh-CN", { numeric: true })
      ));
  }, [accounts, currentAccount, mineOnly, ownerFilter, scopedItems, search, statusFilter]);
  const latestImport = useMemo(
    () => bomImports
      .filter((item) => effectiveParentId === "all" || item.parentMaterialId === effectiveParentId)
      .toSorted((a, b) => b.importedAt.localeCompare(a.importedAt))[0] ?? null,
    [bomImports, effectiveParentId],
  );
  const quotationInfoByItem = useMemo(() => {
    const infoByItem = new Map();
    const addQuotation = (bomItemId, quotation, match = null) => {
      if (!bomItemId) return;
      const info = infoByItem.get(bomItemId) ?? { quotationIds: new Set(), latestMatch: null };
      info.quotationIds.add(quotation.id);
      if (!info.latestMatch && match) info.latestMatch = match;
      infoByItem.set(bomItemId, info);
    };
    quotations.forEach((quotation) => {
      if (quotation.matches?.length) {
        quotation.matches.forEach((match) => addQuotation(match.bomItemId, quotation, match));
      } else {
        addQuotation(quotation.bomItemId, quotation);
      }
    });
    return new Map([...infoByItem].map(([bomItemId, info]) => [bomItemId, {
      count: info.quotationIds.size,
      latestMatch: info.latestMatch,
    }]));
  }, [quotations]);
  const canUploadQuotation = (item) => (
    canManage || isAssignedToAccount(item, currentAccount, accounts)
  );
  const quotationEnabledItems = bomItems.filter((item) => (
    item.status !== BOM_STATUS.REMOVED && canUploadQuotation(item)
  ));
  const bulkReadyItems = scopedItems.filter((item) => ![
    BOM_STATUS.READY,
    BOM_STATUS.NA,
    BOM_STATUS.REMOVED,
  ].includes(item.status));
  const selectedBulkReadyIds = bulkReadyItems
    .filter((item) => selectedItemIds.has(item.id))
    .map(({ id }) => id);

  function toggleReady(item) {
    onUpdateItem?.(item.id, {
      status: item.status === BOM_STATUS.READY ? BOM_STATUS.PENDING : BOM_STATUS.READY,
    });
  }

  function toggleSelection(itemId) {
    setSelectedItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = visibleItems
      .filter((item) => item.status !== BOM_STATUS.REMOVED)
      .map(({ id }) => id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedItemIds.has(id));
    setSelectedItemIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }

  function applyBulkOwner() {
    if (!selectedItemIds.size) return;
    onAssignItems?.([...selectedItemIds], bulkOwnerId || null);
    setSelectedItemIds(new Set());
  }

  async function applyBulkReady(itemIds = null) {
    const targetItems = itemIds
      ? bulkReadyItems.filter((item) => itemIds.includes(item.id))
      : bulkReadyItems;
    if (!targetItems.length || !onBulkReady) return;
    const shortageCount = targetItems.filter(({ status }) => status === BOM_STATUS.SHORTAGE).length;
    const confirmed = globalThis.confirm(
      `确认将 ${targetItems.length} 种材料全部标记为准备完成？${shortageCount ? `\n其中包含 ${shortageCount} 种当前标记为缺料的材料。` : ""}`,
    );
    if (!confirmed) return;
    setBulkReadyBusy(true);
    try {
      const saved = await onBulkReady(itemIds ? targetItems.map(({ id }) => id) : null);
      if (saved !== false) setSelectedItemIds(new Set());
    } finally {
      setBulkReadyBusy(false);
    }
  }

  const selectableVisibleIds = visibleItems
    .filter((item) => item.status !== BOM_STATUS.REMOVED)
    .map(({ id }) => id);
  const allVisibleSelected = selectableVisibleIds.length > 0
    && selectableVisibleIds.every((id) => selectedItemIds.has(id));

  return (
    <div className="material-readiness-page">
      <header className="material-page-heading">
        <div>
          <p className="eyebrow">{project.code} · {phase.label}</p>
          <h1>材料进度</h1>
          <p>从 BOM 导入物料，并逐个确认是否满足当前阶段生产准备。</p>
        </div>
        <div className="material-page-actions">
          {canManage && onBulkReady && bulkReadyItems.length ? (
            <button className="button button-secondary" type="button" onClick={() => applyBulkReady()} disabled={bulkReadyBusy}>
              <PackageCheck size={17} />{bulkReadyBusy ? "正在确认…" : `本阶段全部完成（${bulkReadyItems.length}）`}
            </button>
          ) : null}
          {onOpenQuotation && quotationEnabledItems.length ? (
            <button className="button button-secondary" type="button" onClick={() => onOpenQuotation(quotationEnabledItems[0].id)}>
              <ReceiptText size={17} />导入报价单
            </button>
          ) : null}
          {onImport ? (
            <button className="button button-primary" type="button" onClick={onImport}>
              <FileUp size={17} />导入 BOM
            </button>
          ) : null}
        </div>
      </header>

      {bomItems.length ? (
        <>
          <section className="bom-summary-grid" aria-label="材料齐套概览">
            <article className="bom-readiness-card">
              <div className="bom-readiness-ring" style={{ "--bom-progress": `${summary.readinessPct}%` }} aria-label={`材料齐套率 ${summary.readinessPct}%`}>
                <span>{summary.readinessPct}<small>%</small></span>
              </div>
              <div><small>材料齐套率</small><strong>{summary.ready}/{summary.applicable || 0}</strong><span>按有效料号计算</span></div>
            </article>
            <article className="bom-kpi bom-kpi--success"><CheckCircle2 size={20} /><span>已完成</span><strong>{summary.ready}</strong></article>
            <article className="bom-kpi"><CircleDashed size={20} /><span>待确认</span><strong>{summary.pending}</strong></article>
            <article className="bom-kpi bom-kpi--progress"><Clock3 size={20} /><span>准备中</span><strong>{summary.preparing}</strong></article>
            <article className="bom-kpi bom-kpi--danger"><AlertTriangle size={20} /><span>缺料</span><strong>{summary.shortage}</strong></article>
          </section>

          <section className="bom-list-panel" aria-label="BOM 材料准备明细">
            <div className="bom-list-toolbar">
              <div className="bom-list-toolbar__filters">
                <label className="bom-search">
                  <Search size={17} aria-hidden="true" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="搜索料号、名称、规格、位号或供应商" aria-label="搜索 BOM 材料" />
                </label>
                {parentMaterials.length > 1 ? (
                  <label className="bom-filter-field"><span className="sr-only">按组件筛选</span><select value={effectiveParentId} onChange={(event) => onFocusedMaterialChange?.(event.target.value === "all" ? "" : event.target.value)} aria-label="按组件筛选"><option value="all">全部组件</option>{parentMaterials.map((material) => <option value={material.id} key={material.id}>{material.code} · {material.name}</option>)}</select></label>
                ) : null}
                <label className="bom-filter-field"><span className="sr-only">按准备状态筛选</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="按准备状态筛选"><option value="all">全部状态</option>{BOM_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{summary.removed ? <option value={BOM_STATUS.REMOVED}>已移出 BOM</option> : null}</select></label>
                {canManage ? <label className="bom-filter-field"><span className="sr-only">按责任人筛选</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="按责任人筛选"><option value="all">全部责任人</option><option value="unassigned">未分配</option>{accounts.filter(({ active }) => active).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.jobRole}</option>)}</select></label> : null}
                {canManage ? <label className="bom-mine-filter"><input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} /><span>我的材料</span></label> : null}
              </div>
              <div className="bom-source-meta">
                {latestImport ? <><b>{latestImport.sheetName}</b><span>版本 {latestImport.version || "—"}</span><span>{formatDateTime(latestImport.importedAt)} 导入</span></> : null}
              </div>
            </div>

            {canManage ? <div className={`bom-bulk-bar ${selectedItemIds.size ? "is-active" : ""}`}>
              <button className="button button-secondary" type="button" onClick={toggleVisibleSelection} disabled={!selectableVisibleIds.length}>
                {allVisibleSelected ? "取消当前选择" : `选择当前 ${selectableVisibleIds.length} 项`}
              </button>
              <span><b>{selectedItemIds.size}</b> 项已选</span>
              <label><span className="sr-only">批量分配责任人</span><select value={bulkOwnerId} onChange={(event) => setBulkOwnerId(event.target.value)} aria-label="批量分配责任人"><option value="">取消分配</option>{accounts.filter(({ active }) => active).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.jobRole}</option>)}</select></label>
              <button className="button button-primary" type="button" onClick={applyBulkOwner} disabled={!selectedItemIds.size}><UserCheck size={16} />批量分配</button>
              {onBulkReady ? <button className="button button-secondary" type="button" onClick={() => applyBulkReady(selectedBulkReadyIds)} disabled={!selectedBulkReadyIds.length || bulkReadyBusy}><PackageCheck size={16} />所选全部完成</button> : null}
            </div> : null}

            <div className="bom-table-wrap">
              <table className="bom-table">
                <thead><tr><th>{canManage ? "选择 / 序号" : "序号"}</th><th>物料编码</th><th>材料名称 / 规格</th><th>厂内编码</th><th>单位用量</th><th>阶段需求</th><th>位号</th><th>供应商 / MPN</th><th>报价单</th><th>责任人</th><th>准备状态</th><th>确认操作</th></tr></thead>
                <tbody>{visibleItems.map((item) => (
                  <tr key={item.id} className={item.status === BOM_STATUS.SHORTAGE ? "is-shortage" : ""}>
                    <td>{canManage ? <label className="bom-row-select"><input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => toggleSelection(item.id)} disabled={item.status === BOM_STATUS.REMOVED} aria-label={`选择材料 ${item.code}`} /><span>{item.itemNo || "—"}</span></label> : (item.itemNo || "—")}</td>
                    <td><b className="bom-code">{item.code}</b></td>
                    <td><b>{item.name}</b><small>{item.comment || item.spec || "—"}</small></td>
                    <td>{item.internalCode || "—"}</td>
                    <td>{item.unitQuantity || "—"}</td>
                    <td>{item.unitQuantity && phase.quantity ? (item.unitQuantity * phase.quantity).toLocaleString("zh-CN") : "—"}</td>
                    <td className="bom-clamp" title={item.designator}>{item.designator || "—"}</td>
                    <td><b>{item.vendors.join(" / ") || "—"}</b><small>{item.mpns.join(" / ") || "—"}</small></td>
                    <td><QuotationButton item={item} info={quotationInfoByItem.get(item.id)} enabled={canUploadQuotation(item)} onOpen={onOpenQuotation} /></td>
                    <td>{canManage ? <OwnerSelect item={item} accounts={accounts} onUpdateItem={onUpdateItem} /> : <span className="bom-owner-readonly">{findAccountForAssignment(item, accounts)?.name ?? item.owner ?? "未分配"}</span>}</td>
                    <td><StatusSelect item={item} onUpdateItem={onUpdateItem} /></td>
                    <td><button className={`bom-ready-button ${item.status === BOM_STATUS.READY ? "is-ready" : ""}`} type="button" onClick={() => toggleReady(item)} disabled={item.status === BOM_STATUS.REMOVED} aria-label={`${item.status === BOM_STATUS.READY ? "撤销" : "确认"} ${item.code} 准备完成`}>{item.status === BOM_STATUS.READY ? "已完成" : "确认完成"}</button>{item.confirmedAt ? <small className="bom-confirmation">{item.confirmedBy || "未知账号"}确认<br />{formatDateTime(item.confirmedAt)}</small> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>

            <ul className="bom-mobile-list">
              {visibleItems.map((item) => (
                <li key={item.id} className={item.status === BOM_STATUS.SHORTAGE ? "is-shortage" : ""}>
                  <header>{canManage ? <label className="bom-mobile-select"><input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => toggleSelection(item.id)} disabled={item.status === BOM_STATUS.REMOVED} aria-label={`选择材料 ${item.code}`} /></label> : null}<div><b>{item.code}</b><span>{item.internalCode || `序号 ${item.itemNo || "—"}`}</span></div><MaterialStatus status={item.status} /></header>
                  <h3>{item.name}</h3><p>{item.comment || item.spec || "暂无规格"}</p>
                  <dl><div><dt>单位 / 阶段需求</dt><dd>{item.unitQuantity || "—"} / {item.unitQuantity && phase.quantity ? (item.unitQuantity * phase.quantity).toLocaleString("zh-CN") : "—"}</dd></div><div><dt>供应商</dt><dd>{item.vendors.join(" / ") || "—"}</dd></div><div><dt>位号</dt><dd>{item.designator || "—"}</dd></div></dl>
                  <label className="bom-mobile-owner"><span>责任人</span>{canManage ? <OwnerSelect item={item} accounts={accounts} onUpdateItem={onUpdateItem} /> : <b>{findAccountForAssignment(item, accounts)?.name ?? item.owner ?? "未分配"}</b>}</label>
                  <QuotationButton item={item} info={quotationInfoByItem.get(item.id)} mobile enabled={canUploadQuotation(item)} onOpen={onOpenQuotation} />
                  <footer><StatusSelect item={item} onUpdateItem={onUpdateItem} /><button className={`bom-ready-button ${item.status === BOM_STATUS.READY ? "is-ready" : ""}`} type="button" onClick={() => toggleReady(item)} disabled={item.status === BOM_STATUS.REMOVED} aria-label={`${item.status === BOM_STATUS.READY ? "撤销" : "确认"} ${item.code} 准备完成`}>{item.status === BOM_STATUS.READY ? "撤销完成" : "确认完成"}</button></footer>
                  {item.confirmedAt ? <p className="bom-mobile-confirmation">{item.confirmedBy || "未知账号"}确认 · {formatDateTime(item.confirmedAt)}</p> : null}
                </li>
              ))}
            </ul>
            <div className="bom-list-footer"><span>显示 {visibleItems.length} / {scopedItems.filter((item) => item.status !== BOM_STATUS.REMOVED).length} 种材料</span>{summary.removed ? <span>{summary.removed} 种已移出 BOM</span> : null}</div>
          </section>
        </>
      ) : (
        <section className="material-empty-state">
          <span><PackageCheck size={30} /></span>
          <h2>当前阶段还没有 BOM 材料</h2>
          <p>{canManage ? "导入客户 BOM 或厂内 BOM 后，系统会按料号建立逐项准备确认清单。" : "当前账号还没有被分配本阶段的 BOM 材料，请联系管理员分配。"}</p>
          {onImport ? <button className="button button-primary" type="button" onClick={onImport}><FileUp size={17} />导入第一份 BOM</button> : null}
        </section>
      )}
    </div>
  );
}

export default MaterialReadinessPage;
