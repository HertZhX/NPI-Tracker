export const BOM_STATUS = Object.freeze({
  PENDING: "pending",
  PREPARING: "preparing",
  READY: "ready",
  SHORTAGE: "shortage",
  NA: "na",
  REMOVED: "removed",
});

export const BOM_STATUS_OPTIONS = Object.freeze([
  { value: BOM_STATUS.PENDING, label: "待确认", tone: "neutral" },
  { value: BOM_STATUS.PREPARING, label: "准备中", tone: "progress" },
  { value: BOM_STATUS.READY, label: "已完成", tone: "success" },
  { value: BOM_STATUS.SHORTAGE, label: "缺料", tone: "danger" },
  { value: BOM_STATUS.NA, label: "不适用", tone: "muted" },
]);

const VALID_STATUSES = new Set(Object.values(BOM_STATUS));

export function isBomStatus(value) {
  return VALID_STATUSES.has(value);
}

export function getBomStatusMeta(value) {
  if (value === BOM_STATUS.REMOVED) {
    return { value, label: "已移出 BOM", tone: "muted" };
  }
  return BOM_STATUS_OPTIONS.find((option) => option.value === value)
    ?? BOM_STATUS_OPTIONS[0];
}

export function summarizeBomItems(items = []) {
  const summary = {
    total: 0,
    applicable: 0,
    ready: 0,
    pending: 0,
    preparing: 0,
    shortage: 0,
    na: 0,
    removed: 0,
    readinessPct: 0,
  };

  for (const item of items) {
    const status = isBomStatus(item?.status) ? item.status : BOM_STATUS.PENDING;
    if (status === BOM_STATUS.REMOVED) {
      summary.removed += 1;
      continue;
    }
    summary.total += 1;
    if (status === BOM_STATUS.NA) {
      summary.na += 1;
      continue;
    }
    summary.applicable += 1;
    if (status === BOM_STATUS.READY) summary.ready += 1;
    else if (status === BOM_STATUS.PREPARING) summary.preparing += 1;
    else if (status === BOM_STATUS.SHORTAGE) summary.shortage += 1;
    else summary.pending += 1;
  }

  summary.readinessPct = summary.applicable
    ? Math.round((summary.ready / summary.applicable) * 100)
    : 0;
  return summary;
}

export function bomSummaryToTaskStatus(items = []) {
  const summary = summarizeBomItems(items);
  if (!summary.total) return "not_reported";
  if (!summary.applicable) return "na";
  if (summary.shortage > 0) return "blocked";
  if (summary.ready === summary.applicable) return "done";
  if (summary.ready > 0 || summary.preparing > 0) return "in_progress";
  return "not_reported";
}

export function bomItemFingerprint(item = {}) {
  return JSON.stringify([
    item.name ?? "",
    item.internalCode ?? "",
    item.comment ?? "",
    item.spec ?? "",
    item.type ?? "",
    item.pad ?? "",
    item.description ?? "",
    Number(item.unitQuantity) || 0,
    item.designator ?? "",
    item.vendors ?? [],
    item.mpns ?? [],
  ]);
}
