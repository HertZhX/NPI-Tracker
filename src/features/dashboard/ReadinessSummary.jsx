import {
  CheckCircle2,
  CircleMinus,
  Clock3,
  TriangleAlert,
} from "lucide-react";
import { clampPercent } from "../../domain/metrics.js";

const EMPTY_SUMMARY = Object.freeze({
  readinessPct: 0,
  completed: 0,
  applicable: 0,
  overdue: 0,
  blocked: 0,
  risk: 0,
});

function asNonNegativeNumber(value) {
  const number = Number(value);

  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * Shows current-stage readiness and the four exception/completion metrics used
 * by the project overview. The SVG uses pathLength so CSS can style the ring
 * without coupling its geometry to the percentage calculation.
 */
export function ReadinessSummary({ summary = EMPTY_SUMMARY }) {
  const readinessPct = Math.round(clampPercent(summary?.readinessPct));
  const completed = asNonNegativeNumber(summary?.completed);
  const applicable = asNonNegativeNumber(summary?.applicable);
  const metrics = [
    {
      key: "completed",
      label: "已完成",
      value: `${completed}/${applicable}`,
      icon: CheckCircle2,
      tone: "positive",
    },
    {
      key: "overdue",
      label: "逾期",
      value: asNonNegativeNumber(summary?.overdue),
      icon: Clock3,
      tone: "danger",
    },
    {
      key: "risk",
      label: "风险",
      value: asNonNegativeNumber(summary?.risk),
      icon: TriangleAlert,
      tone: "warning",
    },
    {
      key: "blocked",
      label: "阻塞",
      value: asNonNegativeNumber(summary?.blocked),
      icon: CircleMinus,
      tone: "danger",
    },
  ];

  return (
    <section className="readiness-summary" aria-labelledby="readiness-summary-title">
      <h2 id="readiness-summary-title" className="readiness-summary__title">
        阶段就绪度
      </h2>

      <div
        className="readiness-summary__ring"
        role="img"
        aria-label={`阶段就绪度 ${readinessPct}%`}
      >
        <svg
          className="readiness-summary__ring-chart"
          viewBox="0 0 120 120"
          aria-hidden="true"
          focusable="false"
        >
          <circle
            className="readiness-summary__ring-track"
            cx="60"
            cy="60"
            r="48"
            pathLength="100"
          />
          <circle
            className="readiness-summary__ring-value"
            cx="60"
            cy="60"
            r="48"
            pathLength="100"
            strokeDasharray={`${readinessPct} ${100 - readinessPct}`}
          />
        </svg>
        <span className="readiness-summary__ring-label" aria-hidden="true">
          <strong>{readinessPct}</strong>
          <span>%</span>
        </span>
      </div>

      <dl className="readiness-summary__metrics">
        {metrics.map(({ key, label, value, icon: Icon, tone }) => (
          <div
            className={`readiness-summary__metric readiness-summary__metric--${tone}`}
            key={key}
          >
            <dt className="readiness-summary__metric-label">
              <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
              <span>{label}</span>
            </dt>
            <dd className="readiness-summary__metric-value">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default ReadinessSummary;
