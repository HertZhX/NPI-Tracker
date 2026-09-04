import { describe, expect, it } from "vitest";
import { TASK_STATUS } from "./statuses.js";
import { clampPercent, formatReadinessPct, isOverdue, summarizeTasks } from "./metrics.js";

function task(status, baselineDate, overrides = {}) {
  return { status, baselineDate, forecastDate: null, ...overrides };
}

describe("isOverdue", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("returns true only for an open task past its baseline date", () => {
    expect(isOverdue(task(TASK_STATUS.IN_PROGRESS, "2026-07-23"), now)).toBe(true);
    expect(isOverdue(task(TASK_STATUS.IN_PROGRESS, "2026-07-24"), now)).toBe(false);
    expect(isOverdue(task(TASK_STATUS.NOT_STARTED, "2026-07-25"), now)).toBe(false);
  });

  it("does not mark done or not-applicable tasks overdue", () => {
    expect(isOverdue(task(TASK_STATUS.DONE, "2026-07-01"), now)).toBe(false);
    expect(isOverdue(task(TASK_STATUS.NA, "2026-07-01"), now)).toBe(false);
  });

  it("falls back to forecast date when baseline is missing", () => {
    expect(isOverdue(task(TASK_STATUS.BLOCKED, null, { forecastDate: "2026-07-20" }), now)).toBe(true);
    expect(isOverdue(task(TASK_STATUS.BLOCKED, "not-a-date"), now)).toBe(false);
  });
});

describe("summarizeTasks", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");

  it("excludes N/A from the readiness denominator", () => {
    const summary = summarizeTasks([
      task(TASK_STATUS.DONE, "2026-07-20"),
      task(TASK_STATUS.DONE, "2026-07-21"),
      task(TASK_STATUS.IN_PROGRESS, "2026-07-30"),
      task(TASK_STATUS.NA, "2026-07-01"),
    ], now);

    expect(summary.rawTotal).toBe(4);
    expect(summary.total).toBe(3);
    expect(summary.excluded).toBe(1);
    expect(summary.completed).toBe(2);
    expect(summary.readinessPct).toBe(67);
  });

  it("counts status, overdue, risk and blocked items", () => {
    const summary = summarizeTasks([
      task(TASK_STATUS.RISK, "2026-07-30"),
      task(TASK_STATUS.BLOCKED, "2026-07-20"),
      task(TASK_STATUS.PENDING_REVIEW, "2026-07-21"),
      task(TASK_STATUS.NOT_REPORTED, null),
    ], now);

    expect(summary.risk).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.atRisk).toBe(2);
    expect(summary.pendingReview).toBe(1);
    expect(summary.overdue).toBe(2);
    expect(summary.statusCounts.not_reported).toBe(1);
  });

  it("returns safe zero percentages for empty or all-N/A input", () => {
    expect(summarizeTasks([], now).readinessPct).toBe(0);
    expect(summarizeTasks([task(TASK_STATUS.NA, null)], now).readinessPct).toBe(0);
  });
});

describe("percent helpers", () => {
  it("clamps and formats values", () => {
    expect(clampPercent(112.4)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(66.6)).toBe(67);
    expect(formatReadinessPct(66.6)).toBe("67%");
  });
});
