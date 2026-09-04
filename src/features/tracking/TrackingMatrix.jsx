import { useEffect, useMemo, useRef } from "react";
import {
  CheckCircle2,
  Circle,
  CircleDashed,
  CircleMinus,
  ClockAlert,
  Hourglass,
  LoaderCircle,
  Minus,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { isOverdue } from "../../domain/metrics.js";
import {
  STATUS_OPTIONS,
  getStatusMeta as getDomainStatusMeta,
} from "../../domain/statuses.js";

const STATUS_ICONS = Object.freeze({
  not_reported: CircleDashed,
  not_started: Circle,
  in_progress: LoaderCircle,
  pending_review: Hourglass,
  done: CheckCircle2,
  risk: TriangleAlert,
  blocked: CircleMinus,
  na: Minus,
});

const CATEGORY_ORDER = Object.freeze([
  "documents",
  "tooling",
  "material",
]);

const CATEGORY_LABELS = Object.freeze({
  documents: "资料与程序",
  tooling: "工装",
  material: "材料",
});

function getDefinitionId(definition) {
  return (
    definition?.key ??
    definition?.id ??
    definition?.definitionId ??
    definition?.code
  );
}

function getDefinitionLabel(definition) {
  return definition?.label ?? definition?.name ?? definition?.title ?? "未命名任务";
}

function getDefinitionOwner(definition) {
  return (
    definition?.defaultRole ??
    definition?.department ??
    definition?.ownerDepartment ??
    definition?.ownerRole ??
    ""
  );
}

function getMaterialId(material) {
  return material?.id ?? material?.materialId ?? material?.code ?? material?.materialCode;
}

function getMaterialCode(material) {
  return material?.code ?? material?.materialCode ?? material?.partNumber ?? "—";
}

function getMaterialName(material) {
  return material?.name ?? material?.materialName ?? material?.partName ?? "—";
}

function getTaskId(task) {
  return task?.id ?? task?.taskId;
}

function getTaskMaterialId(task) {
  return task?.materialId ?? task?.material?.id ?? task?.materialCode;
}

function getTaskDefinitionId(task) {
  return (
    task?.definitionKey ??
    task?.definitionId ??
    task?.definition?.key ??
    task?.definition?.id ??
    task?.itemId
  );
}

function getTaskStatus(task) {
  return task?.status ?? "not_reported";
}

function getBaselineDate(task) {
  return task?.baselineDate ?? task?.baseDate ?? task?.plannedDate ?? "";
}

function getForecastDate(task) {
  return task?.forecastDate ?? task?.expectedDate ?? task?.dueDate ?? "";
}

function getAttachmentCount(task) {
  if (Array.isArray(task?.evidence) || Array.isArray(task?.attachments)) {
    return Math.max(task?.evidence?.length ?? 0, task?.attachments?.length ?? 0);
  }

  const count = Number(task?.attachmentCount ?? task?.evidenceCount ?? 0);

  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function normalizeCategory(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (
    normalized.includes("材料") ||
    normalized.includes("供应") ||
    normalized.includes("采购") ||
    normalized.includes("material") ||
    normalized.includes("supply") ||
    normalized === "pur"
  ) {
    return "material";
  }

  if (
    normalized.includes("工装") ||
    normalized.includes("tooling") ||
    normalized.includes("fixture") ||
    normalized.includes("tool")
  ) {
    return "tooling";
  }

  // 资料、程序、质量策划、工艺、验证、评审及自定义文档项均归入
  // 第一组，确保矩阵始终保持设计稿规定的三类双层表头。
  return "documents";
}

function groupDefinitions(definitions) {
  const buckets = new Map(CATEGORY_ORDER.map((category) => [category, []]));

  for (const definition of definitions) {
    const category = normalizeCategory(
      definition?.category ?? definition?.categoryName ?? definition?.group,
    );
    buckets.get(category).push(definition);
  }

  return CATEGORY_ORDER.flatMap((category) => {
    const items = buckets.get(category);

    return items.length
      ? [{ key: category, label: CATEGORY_LABELS[category], definitions: items }]
      : [];
  });
}

function makeTaskLookupKey(materialId, definitionId) {
  return `${String(materialId)}::${String(definitionId)}`;
}

function formatShortDate(value) {
  if (!value) {
    return "—";
  }

  const text = String(value);
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  return isoDateMatch ? `${isoDateMatch[2]}-${isoDateMatch[3]}` : text;
}

function getStatusOptionValue(option) {
  if (typeof option === "string") {
    return option;
  }

  return option?.value ?? option?.code ?? option?.id ?? "not_reported";
}

function getStatusMeta(status) {
  const meta = getDomainStatusMeta(status);

  return {
    label: meta?.label ?? "未填报",
    tone: meta?.tone ?? meta?.semantic ?? "neutral",
  };
}

function TaskDates({ baselineDate, forecastDate }) {
  if (!baselineDate && !forecastDate) {
    return <span className="tracking-task__date-empty">—</span>;
  }

  return (
    <span className="tracking-task__dates">
      {forecastDate ? (
        <time
          className="tracking-task__date tracking-task__date--forecast"
          dateTime={String(forecastDate)}
          title={`预测日期：${forecastDate}`}
        >
          <span aria-hidden="true">预 </span>
          {formatShortDate(forecastDate)}
        </time>
      ) : null}
      {baselineDate ? (
        <time
          className="tracking-task__date tracking-task__date--baseline"
          dateTime={String(baselineDate)}
          title={`基准日期：${baselineDate}`}
        >
          <span aria-hidden="true">基 </span>
          {formatShortDate(baselineDate)}
        </time>
      ) : null}
    </span>
  );
}

function focusAdjacentTask(event) {
  const directions = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
  if (!directions.has(event.key)) return;
  const cell = event.currentTarget.closest("td");
  const row = cell?.parentElement;
  if (!cell || !row) return;

  let target = null;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    let sibling = event.key === "ArrowLeft" ? cell.previousElementSibling : cell.nextElementSibling;
    while (sibling && !target) {
      target = sibling.querySelector?.("button.tracking-task:not(:disabled)");
      sibling = event.key === "ArrowLeft" ? sibling.previousElementSibling : sibling.nextElementSibling;
    }
  } else {
    let siblingRow = event.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
    while (siblingRow && !target) {
      target = siblingRow.children[cell.cellIndex]?.querySelector?.("button.tracking-task:not(:disabled)");
      siblingRow = event.key === "ArrowUp" ? siblingRow.previousElementSibling : siblingRow.nextElementSibling;
    }
  }

  if (target) {
    event.preventDefault();
    target.focus();
  }
}

function TaskCell({ task, material, definition, selectedTaskId, onSelectTask, primaryTaskId, filterMatch }) {
  const status = getTaskStatus(task);
  const statusMeta = getStatusMeta(status);
  const StatusIcon = STATUS_ICONS[status] ?? CircleDashed;
  const taskId = getTaskId(task);
  const baselineDate = getBaselineDate(task);
  const forecastDate = getForecastDate(task);
  const attachmentCount = getAttachmentCount(task);
  const overdue = task ? isOverdue(task) : false;
  const selected =
    taskId != null &&
    selectedTaskId != null &&
    String(taskId) === String(selectedTaskId);
  const materialName = getMaterialName(material);
  const definitionLabel = getDefinitionLabel(definition);
  const accessibleDetails = [
    `${materialName}，${definitionLabel}`,
    `状态：${statusMeta.label}`,
    forecastDate ? `预测日期：${forecastDate}` : null,
    baselineDate ? `基准日期：${baselineDate}` : null,
    attachmentCount ? `附件 ${attachmentCount} 个` : null,
    overdue ? "已逾期" : null,
  ]
    .filter(Boolean)
    .join("；");

  return (
    <button
      className={`tracking-task tracking-task--${statusMeta.tone ?? "neutral"}${
        selected ? " is-selected" : ""
      }${overdue ? " is-overdue" : ""}`}
      type="button"
      onClick={() => onSelectTask?.(taskId)}
      onKeyDown={focusAdjacentTask}
      disabled={!task || taskId == null}
      tabIndex={taskId === primaryTaskId ? 0 : -1}
      aria-label={accessibleDetails}
      aria-pressed={selected}
      data-status={status}
      data-filter-match={filterMatch ? "true" : undefined}
    >
      <span className="tracking-task__status">
        <StatusIcon aria-hidden="true" size={18} strokeWidth={1.8} />
        <span>{statusMeta.label}</span>
      </span>

      <TaskDates baselineDate={baselineDate} forecastDate={forecastDate} />

      {attachmentCount || overdue ? (
        <span className="tracking-task__badges" aria-hidden="true">
          {attachmentCount ? (
            <span className="tracking-task__badge tracking-task__badge--attachment">
              <Paperclip size={13} />
              {attachmentCount}
            </span>
          ) : null}
          {overdue ? (
            <span className="tracking-task__badge tracking-task__badge--overdue">
              <ClockAlert size={13} />
              逾
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

function StatusLegend() {
  return (
    <ul className="tracking-matrix__legend-list">
      {STATUS_OPTIONS.map((option) => {
        const status = getStatusOptionValue(option);
        const meta = getStatusMeta(status);
        const Icon = STATUS_ICONS[status] ?? CircleDashed;

        return (
          <li className={`tracking-matrix__legend-item is-${meta.tone}`} key={status}>
            <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>{meta.label}</span>
          </li>
        );
      })}
      <li className="tracking-matrix__legend-item">
        <Paperclip aria-hidden="true" size={16} />
        <span>有附件</span>
      </li>
      <li className="tracking-matrix__legend-item is-danger">
        <ClockAlert aria-hidden="true" size={16} />
        <span>逾期</span>
      </li>
    </ul>
  );
}

export function TrackingMatrix({
  definitions = [],
  materials = [],
  tasks = [],
  visibleTaskIds = null,
  selectedTaskId,
  onSelectTask,
}) {
  const viewportRef = useRef(null);
  const categoryGroups = useMemo(
    () => groupDefinitions(definitions),
    [definitions],
  );
  const orderedDefinitions = useMemo(
    () => categoryGroups.flatMap((group) => group.definitions),
    [categoryGroups],
  );
  const tasksByCell = useMemo(() => {
    const lookup = new Map();

    for (const task of tasks) {
      lookup.set(
        makeTaskLookupKey(getTaskMaterialId(task), getTaskDefinitionId(task)),
        task,
      );
    }

    return lookup;
  }, [tasks]);
  const primaryTaskId = useMemo(() => {
    if (selectedTaskId && (!visibleTaskIds || visibleTaskIds.has(selectedTaskId))) {
      return selectedTaskId;
    }
    const first = tasks.find((task) => !visibleTaskIds || visibleTaskIds.has(getTaskId(task)));
    return getTaskId(first);
  }, [selectedTaskId, tasks, visibleTaskIds]);

  useEffect(() => {
    if (!visibleTaskIds?.size) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      const firstMatch = viewport?.querySelector('[data-filter-match="true"]');
      if (!viewport || !firstMatch) return;
      const targetLeft = firstMatch.closest("td")?.offsetLeft ?? 0;
      viewport.scrollLeft = Math.max(0, targetLeft - 260);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [visibleTaskIds]);

  return (
    <section className="tracking-matrix" aria-labelledby="tracking-matrix-title">
      <h2 id="tracking-matrix-title" className="sr-only">
        项目资料、工装与材料进度矩阵
      </h2>

      <div
        className="tracking-matrix__viewport"
        ref={viewportRef}
        role="region"
        aria-label="可横向滚动的进度矩阵"
        tabIndex={0}
      >
        <table className="tracking-matrix__table">
          <caption className="sr-only">
            每行代表一个物料，每列代表一项资料、程序、工装或材料任务。
          </caption>
          <thead>
            <tr className="tracking-matrix__category-row">
              <th
                className="tracking-matrix__sticky tracking-matrix__sticky--code"
                scope="col"
                rowSpan="2"
              >
                物料编码
              </th>
              <th
                className="tracking-matrix__sticky tracking-matrix__sticky--name"
                scope="col"
                rowSpan="2"
              >
                物料名称
              </th>
              {categoryGroups.map((group) => (
                <th
                  className={`tracking-matrix__category tracking-matrix__category--${group.key}`}
                  scope="colgroup"
                  colSpan={group.definitions.length}
                  key={group.key}
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr className="tracking-matrix__definition-row">
              {orderedDefinitions.map((definition) => {
                const definitionId = getDefinitionId(definition);
                const owner = getDefinitionOwner(definition);

                return (
                  <th
                    className="tracking-matrix__definition"
                    scope="col"
                    key={definitionId}
                    title={getDefinitionLabel(definition)}
                  >
                    <span className="tracking-matrix__definition-label">
                      {getDefinitionLabel(definition)}
                    </span>
                    {owner ? (
                      <span className="tracking-matrix__definition-owner">{owner}</span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {materials.length ? (
              materials.map((material) => {
                const materialId = getMaterialId(material);

                return (
                  <tr className="tracking-matrix__material-row" key={materialId}>
                    <th
                      className="tracking-matrix__sticky tracking-matrix__sticky--code tracking-matrix__material-code"
                      scope="row"
                      title={String(getMaterialCode(material))}
                    >
                      {getMaterialCode(material)}
                    </th>
                    <td
                      className="tracking-matrix__sticky tracking-matrix__sticky--name tracking-matrix__material-name"
                      title={String(getMaterialName(material))}
                    >
                      {getMaterialName(material)}
                    </td>
                    {orderedDefinitions.map((definition) => {
                      const definitionId = getDefinitionId(definition);
                      const task = tasksByCell.get(
                        makeTaskLookupKey(materialId, definitionId),
                      );
                      const taskId = getTaskId(task);
                      const matchesFilter = !visibleTaskIds || visibleTaskIds.has(taskId);

                      return (
                        <td
                          className="tracking-matrix__task-cell"
                          key={definitionId}
                        >
                          {matchesFilter ? (
                            <TaskCell
                              task={task}
                              material={material}
                              definition={definition}
                              selectedTaskId={selectedTaskId}
                              onSelectTask={onSelectTask}
                              primaryTaskId={primaryTaskId}
                              filterMatch={Boolean(visibleTaskIds)}
                            />
                          ) : (
                            <span className="tracking-task tracking-task--filtered" aria-hidden="true">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  className="tracking-matrix__empty"
                  colSpan={Math.max(2, orderedDefinitions.length + 2)}
                >
                  暂无物料数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="tracking-matrix__footer">
        <div className="tracking-matrix__legend" aria-label="任务状态图例">
          <StatusLegend />
        </div>
        <p className="tracking-matrix__row-count" aria-live="polite">
          共 {materials.length} 条
        </p>
      </footer>
    </section>
  );
}

export default TrackingMatrix;
