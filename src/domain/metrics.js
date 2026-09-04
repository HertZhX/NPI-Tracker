import { STATUS_VALUES, TASK_STATUS } from "./statuses.js";

function toTimestamp(value, endOfDateOnly = false) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      endOfDateOnly ? 23 : 0,
      endOfDateOnly ? 59 : 0,
      endOfDateOnly ? 59 : 0,
      endOfDateOnly ? 999 : 0,
    );
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

export function formatReadinessPct(value) {
  return `${clampPercent(value)}%`;
}

/**
 * 判断尚未关闭的事项是否已越过基准日期。
 * 基准日期优先使用 baselineDate，仅在其为空时退回 forecastDate。
 */
export function isOverdue(task, now = new Date()) {
  if (!task || task.status === TASK_STATUS.DONE || task.status === TASK_STATUS.NA) {
    return false;
  }

  const dueAt = toTimestamp(task.baselineDate || task.forecastDate, true);
  const referenceAt = toTimestamp(now);
  if (dueAt === null || referenceAt === null) return false;

  return dueAt < referenceAt;
}

export function summarizeTasks(tasks, now = new Date()) {
  const taskList = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  const statusCounts = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0]));

  for (const task of taskList) {
    const status = STATUS_VALUES.includes(task.status)
      ? task.status
      : TASK_STATUS.NOT_REPORTED;
    statusCounts[status] += 1;
  }

  const rawTotal = taskList.length;
  const excluded = statusCounts[TASK_STATUS.NA];
  const applicable = rawTotal - excluded;
  const completed = statusCounts[TASK_STATUS.DONE];
  const notReported = statusCounts[TASK_STATUS.NOT_REPORTED];
  const overdue = taskList.filter((task) => isOverdue(task, now)).length;
  const risk = statusCounts[TASK_STATUS.RISK];
  const blocked = statusCounts[TASK_STATUS.BLOCKED];
  const pendingReview = statusCounts[TASK_STATUS.PENDING_REVIEW];
  const active = Math.max(0, applicable - completed);
  const reported = Math.max(0, applicable - notReported);
  const completionRate = applicable === 0 ? 0 : clampPercent((completed / applicable) * 100);
  const reportingRate = applicable === 0 ? 0 : clampPercent((reported / applicable) * 100);

  return {
    rawTotal,
    total: applicable,
    applicable,
    excluded,
    na: excluded,
    completed,
    done: completed,
    active,
    reported,
    notReported,
    overdue,
    risk,
    blocked,
    atRisk: risk + blocked,
    pendingReview,
    completionRate,
    readinessPct: completionRate,
    percent: completionRate,
    reportingRate,
    statusCounts,
    byStatus: statusCounts,
  };
}
