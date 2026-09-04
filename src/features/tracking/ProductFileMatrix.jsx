import { useMemo } from "react";
import {
  CheckCircle2,
  Circle,
  CircleMinus,
  Clock3,
  FileCheck2,
  Hourglass,
  Paperclip,
  TriangleAlert,
} from "lucide-react";
import { summarizeTasks } from "../../domain/metrics.js";
import { isProductFileRecord } from "../../domain/productFiles.js";
import { getStatusMeta, TASK_STATUS } from "../../domain/statuses.js";

const STATUS_PRIORITY = Object.freeze({
  [TASK_STATUS.BLOCKED]: 7,
  [TASK_STATUS.RISK]: 6,
  [TASK_STATUS.PENDING_REVIEW]: 5,
  [TASK_STATUS.IN_PROGRESS]: 4,
  [TASK_STATUS.NOT_STARTED]: 3,
  [TASK_STATUS.NOT_REPORTED]: 2,
  [TASK_STATUS.DONE]: 1,
  [TASK_STATUS.NA]: 0,
});

const STATUS_ICONS = Object.freeze({
  [TASK_STATUS.DONE]: CheckCircle2,
  [TASK_STATUS.IN_PROGRESS]: Clock3,
  [TASK_STATUS.PENDING_REVIEW]: Hourglass,
  [TASK_STATUS.RISK]: TriangleAlert,
  [TASK_STATUS.BLOCKED]: CircleMinus,
});

function rollupDefinition(definition, tasks) {
  const applicable = tasks.filter(({ status }) => status !== TASK_STATUS.NA);
  let status = TASK_STATUS.NOT_REPORTED;
  if (tasks.length && !applicable.length) status = TASK_STATUS.NA;
  else if (applicable.length && applicable.every(({ status: value }) => value === TASK_STATUS.DONE)) status = TASK_STATUS.DONE;
  else if (applicable.length) {
    status = applicable.reduce((worst, task) => (
      STATUS_PRIORITY[task.status] > STATUS_PRIORITY[worst] ? task.status : worst
    ), TASK_STATUS.NOT_REPORTED);
    if (status === TASK_STATUS.DONE) status = TASK_STATUS.IN_PROGRESS;
  }

  const candidateTasks = applicable.filter((task) => task.status === status);
  const primaryTask = candidateTasks[0] ?? applicable[0] ?? tasks[0] ?? null;
  const dates = applicable
    .map((task) => task.actualDate || task.forecastDate || task.baselineDate)
    .filter(Boolean)
    .sort();
  const date = status === TASK_STATUS.DONE ? dates.at(-1) : dates[0];
  const versions = [...new Set(tasks.map(({ fileVersion }) => String(fileVersion || "").trim()).filter(Boolean))];

  return {
    definition,
    status,
    primaryTask,
    date: date || "",
    versionLabel: versions.length > 1 ? "多版本" : versions[0] || "未填写",
    evidenceCount: tasks.reduce((total, task) => total + (task.evidence?.length ?? 0), 0),
    completed: applicable.filter(({ status: value }) => value === TASK_STATUS.DONE).length,
    applicable: applicable.length,
  };
}

function groupDefinitions(definitions) {
  const groups = [];
  for (const definition of definitions) {
    if (definition.category === "材料") continue;
    let group = groups.find(({ category }) => category === definition.category);
    if (!group) {
      group = { category: definition.category || "其他", definitions: [] };
      groups.push(group);
    }
    group.definitions.push(definition);
  }
  return groups;
}

function shortDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : "—";
}

export function ProductFileMatrix({
  project,
  product,
  definitions = [],
  tasks = [],
  search = "",
  selectedTaskId = "",
  onSelectTask,
  onOpenDefinition,
}) {
  const groups = useMemo(() => groupDefinitions(definitions), [definitions]);
  const productFileTasks = useMemo(
    () => tasks.filter(isProductFileRecord),
    [tasks],
  );
  const tasksByDefinition = useMemo(() => {
    const map = new Map();
    for (const task of productFileTasks) {
      const list = map.get(task.definitionKey) ?? [];
      list.push(task);
      map.set(task.definitionKey, list);
    }
    return map;
  }, [productFileTasks]);
  const rollups = useMemo(() => new Map(definitions.map((definition) => [
    definition.key,
    rollupDefinition(definition, tasksByDefinition.get(definition.key) ?? []),
  ])), [definitions, tasksByDefinition]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleGroups = normalizedSearch
    ? groups.map((group) => ({
      ...group,
      definitions: group.definitions.filter((definition) => (
        `${definition.label} ${definition.category} ${rollups.get(definition.key)?.versionLabel ?? ""}`
          .toLocaleLowerCase().includes(normalizedSearch)
      )),
    })).filter(({ definitions: entries }) => entries.length)
    : groups;
  const visibleDefinitions = visibleGroups.flatMap(({ definitions: entries }) => entries);
  const fileDefinitionKeys = useMemo(
    () => new Set(groups.flatMap(({ definitions: entries }) => entries.map(({ key }) => key))),
    [groups],
  );
  const fileTasks = useMemo(
    () => productFileTasks.filter((task) => fileDefinitionKeys.has(task.definitionKey)),
    [fileDefinitionKeys, productFileTasks],
  );
  const summary = useMemo(() => summarizeTasks(fileTasks), [fileTasks]);
  const evidenceCount = fileTasks.reduce((total, task) => total + (task.evidence?.length ?? 0), 0);

  return (
    <section className="product-file-panel" aria-labelledby="product-file-title">
      <header className="product-file-panel__heading">
        <div>
          <h2 id="product-file-title">产品文件收集总表</h2>
          <p>{project.name || project.code}{project.name && project.name !== project.code ? `（${project.code}）` : ""} · {product.partNumber ? `${product.partNumber} · ` : ""}{product.name}{product.version ? ` · 产品版本 ${product.version}` : ""} · MP 阶段统一确认全部资料与工装文件</p>
        </div>
        <dl>
          <div><dt>总体完成度</dt><dd>{summary.readinessPct}%</dd></div>
          <div><dt>完成项</dt><dd>{summary.completed}/{summary.applicable}</dd></div>
          <div><dt>附件</dt><dd><Paperclip size={14} />{evidenceCount}</dd></div>
          <div><dt>风险/阻塞</dt><dd className={summary.risk + summary.blocked ? "is-danger" : ""}>{summary.risk + summary.blocked}</dd></div>
        </dl>
      </header>

      <div className="product-file-matrix__viewport">
        <table className="product-file-matrix">
          <thead>
            <tr>
              <th className="product-file-matrix__product" rowSpan={2}>产品</th>
              {visibleGroups.map((group) => (
                <th key={group.category} colSpan={group.definitions.length}>{group.category}</th>
              ))}
            </tr>
            <tr>
              {visibleDefinitions.map((definition) => <th key={definition.key}>{definition.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="product-file-matrix__product" scope="row">
                <strong>{product.partNumber ? `${product.partNumber} · ` : ""}{product.name}</strong>
                <small>{project.name || project.code}{product.version ? ` · ${product.version}` : ""}</small>
              </th>
              {visibleDefinitions.map((definition) => {
                const item = rollups.get(definition.key);
                const meta = getStatusMeta(item.status);
                const Icon = STATUS_ICONS[item.status] ?? Circle;
                const selected = item.primaryTask?.id === selectedTaskId;
                return (
                  <td key={definition.key}>
                    <button
                      type="button"
                      className={`product-file-cell product-file-cell--${meta.semantic} ${selected ? "is-selected" : ""}`}
                      data-definition-key={definition.key}
                      onClick={() => item.primaryTask
                        ? onSelectTask?.(item.primaryTask)
                        : onOpenDefinition?.(definition)}
                      aria-label={`打开 ${definition.label} 文件跟踪事项`}
                      title={item.primaryTask ? `打开 ${definition.label} 跟踪明细` : `建立并打开 ${definition.label} 跟踪事项`}
                    >
                      <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
                      <strong>{meta.label}</strong>
                      <span className={`product-file-cell__version ${item.versionLabel === "未填写" ? "is-empty" : ""}`}>版本 {item.versionLabel}</span>
                      <time dateTime={item.date}>{shortDate(item.date)}</time>
                      <span className="product-file-cell__progress">{item.completed}/{item.applicable}</span>
                      {item.evidenceCount ? <em><Paperclip size={13} />{item.evidenceCount}</em> : null}
                    </button>
                  </td>
                );
              })}
              {!visibleDefinitions.length ? (
                <td className="product-file-matrix__empty"><FileCheck2 size={22} />没有匹配的文件项</td>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
      <footer>
        <span>单元格汇总当前产品在 MP 阶段统一确认的同类文件状态</span>
        <span>点击单元格可进入对应跟踪事项</span>
      </footer>
    </section>
  );
}

export default ProductFileMatrix;
