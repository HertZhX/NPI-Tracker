export const TASK_STATUS = Object.freeze({
  NOT_REPORTED: "not_reported",
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  PENDING_REVIEW: "pending_review",
  DONE: "done",
  RISK: "risk",
  BLOCKED: "blocked",
  NA: "na",
});

export const STATUS_META = Object.freeze({
  [TASK_STATUS.NOT_REPORTED]: Object.freeze({
    label: "待确认",
    semantic: "muted",
    description: "尚未提交当前进度",
    terminal: false,
    sortOrder: 0,
  }),
  [TASK_STATUS.NOT_STARTED]: Object.freeze({
    label: "未开始",
    semantic: "neutral",
    description: "已纳入计划，尚未开始",
    terminal: false,
    sortOrder: 1,
  }),
  [TASK_STATUS.IN_PROGRESS]: Object.freeze({
    label: "进行中",
    semantic: "info",
    description: "责任人正在推进",
    terminal: false,
    sortOrder: 2,
  }),
  [TASK_STATUS.PENDING_REVIEW]: Object.freeze({
    label: "待审核",
    semantic: "review",
    description: "资料或结果已提交，等待确认",
    terminal: false,
    sortOrder: 3,
  }),
  [TASK_STATUS.DONE]: Object.freeze({
    label: "已完成",
    semantic: "success",
    description: "事项已完成并关闭",
    terminal: true,
    sortOrder: 4,
  }),
  [TASK_STATUS.RISK]: Object.freeze({
    label: "有风险",
    semantic: "warning",
    description: "仍可推进，但交付存在风险",
    terminal: false,
    sortOrder: 5,
  }),
  [TASK_STATUS.BLOCKED]: Object.freeze({
    label: "已阻塞",
    semantic: "danger",
    description: "存在阻塞，当前无法继续",
    terminal: false,
    sortOrder: 6,
  }),
  [TASK_STATUS.NA]: Object.freeze({
    label: "不适用",
    semantic: "disabled",
    description: "本项目或物料不适用此事项",
    terminal: true,
    sortOrder: 7,
  }),
});

export const STATUS_OPTIONS = Object.freeze(
  Object.entries(STATUS_META)
    .sort(([, left], [, right]) => left.sortOrder - right.sortOrder)
    .map(([value, meta]) => Object.freeze({ value, ...meta })),
);

export const STATUS_VALUES = Object.freeze(STATUS_OPTIONS.map(({ value }) => value));
export const STATUSES = TASK_STATUS;
export const statusMeta = STATUS_META;

export function getStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META[TASK_STATUS.NOT_REPORTED];
}

export function isTaskStatus(status) {
  return STATUS_VALUES.includes(status);
}

export function isTerminalStatus(status) {
  return Boolean(STATUS_META[status]?.terminal);
}
