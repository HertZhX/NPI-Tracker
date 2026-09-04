import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleMinus,
  ClipboardCheck,
  PackageX,
} from "lucide-react";
import { isAssignedToAccount } from "../../domain/accounts.js";
import { BOM_STATUS, summarizeBomItems } from "../../domain/bom.js";
import { isOverdue } from "../../domain/metrics.js";
import { getStatusMeta, TASK_STATUS } from "../../domain/statuses.js";
import {
  isProductWorkflowComplete,
  STANDARD_STAGE_TYPES,
  stageStateFromSummary,
  summarizeWorkflowItems,
} from "../../domain/workflow.js";

const CLOSED_STATUSES = new Set([TASK_STATUS.DONE, TASK_STATUS.NA]);
const PRIORITY = new Map([
  [TASK_STATUS.BLOCKED, 0],
  [TASK_STATUS.RISK, 1],
  [TASK_STATUS.PENDING_REVIEW, 2],
  [TASK_STATUS.IN_PROGRESS, 3],
]);

function formatDate(value) {
  if (!value) return "未设置";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : String(value);
}

function itemDueDate(item) {
  return item.baselineDate || item.forecastDate || "";
}

function isDueThisWeek(item, now = new Date()) {
  const value = itemDueDate(item);
  if (!value || CLOSED_STATUSES.has(item.status)) return false;
  const due = new Date(`${String(value).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(due.getTime())) return false;
  const upper = new Date(now);
  upper.setDate(upper.getDate() + 7);
  return due >= now && due <= upper;
}

function buildContextMaps(projects) {
  const projectById = new Map();
  const productById = new Map();
  const phaseById = new Map();
  projects.forEach((project) => {
    projectById.set(project.id, project);
    project.products.forEach((product) => {
      productById.set(product.id, product);
      product.phases.forEach((phase) => phaseById.set(phase.id, phase));
    });
  });
  return { projectById, productById, phaseById };
}

function WorkStatus({ status, overdue }) {
  const meta = getStatusMeta(status);
  return (
    <span className={`workbench-status workbench-status--${overdue ? "danger" : meta.semantic}`}>
      <i aria-hidden="true" />{overdue ? "已逾期" : meta.label}
    </span>
  );
}

export function WorkbenchPage({
  projects = [],
  materials = [],
  definitions = [],
  tasks = [],
  workflowItems = [],
  bomItems = [],
  accounts = [],
  currentAccount,
  search = "",
  onOpenItem,
  onOpenProduct,
  onOpenProjects,
}) {
  const data = useMemo(() => {
    const { projectById, productById, phaseById } = buildContextMaps(projects);
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const materialById = new Map(materials.map((material) => [material.id, material]));
    const normalizeItem = (item, source) => {
      const project = projectById.get(item.projectId);
      const product = productById.get(item.productId);
      const phase = phaseById.get(item.phaseId);
      const definition = definitionByKey.get(item.definitionKey);
      const material = materialById.get(item.materialId);
      return {
        id: `${source}:${item.id}`,
        source,
        raw: item,
        project,
        product,
        phase,
        title: item.title || definition?.label || "未命名任务",
        detail: item.criterion || material?.name || "",
        status: item.status,
        dueDate: itemDueDate(item),
        overdue: isOverdue(item),
      };
    };
    const allWork = [
      ...workflowItems.map((item) => normalizeItem(item, "workflow")),
      ...tasks.map((item) => normalizeItem(item, "task")),
    ].filter(({ project, product }) => project && product);
    const assignedWork = allWork.filter(({ raw }) => (
      isAssignedToAccount(raw, currentAccount, accounts) && !CLOSED_STATUSES.has(raw.status)
    ));
    const mine = (currentAccount?.systemRole === "admin"
      ? allWork.filter(({ raw }) => !CLOSED_STATUSES.has(raw.status))
      : assignedWork)
      .toSorted((left, right) => (
        Number(right.overdue) - Number(left.overdue)
        || (PRIORITY.get(left.status) ?? 9) - (PRIORITY.get(right.status) ?? 9)
        || String(left.dueDate).localeCompare(String(right.dueDate))
      ));
    const query = search.trim().toLocaleLowerCase();
    const visibleMine = mine.filter((item) => !query || [
      item.project.code,
      item.project.name,
      item.product.name,
      item.product.version,
      item.title,
      item.detail,
      item.phase?.label,
    ].join(" ").toLocaleLowerCase().includes(query));

    const workExceptions = allWork
      .filter(({ status }) => [TASK_STATUS.BLOCKED, TASK_STATUS.RISK].includes(status))
      .map((item) => ({
        ...item,
        exceptionType: item.status === TASK_STATUS.BLOCKED ? "blocked" : "risk",
      }));
    const bomExceptions = bomItems
      .filter(({ status }) => status === BOM_STATUS.SHORTAGE)
      .map((item) => ({
        id: `bom:${item.id}`,
        source: "bom",
        raw: item,
        project: projectById.get(item.projectId),
        product: productById.get(item.productId),
        phase: phaseById.get(item.phaseId),
        title: item.name || item.code,
        detail: item.issue || "材料缺料",
        exceptionType: "shortage",
      }))
      .filter(({ project, product }) => project && product);
    const exceptions = [...workExceptions, ...bomExceptions].slice(0, 7);

    const productRows = projects.flatMap((project) => project.products.map((product) => {
      const productWorkflow = workflowItems.filter((item) => item.projectId === project.id && item.productId === product.id);
      const productBom = bomItems.filter((item) => item.projectId === project.id && item.productId === product.id);
      const stageSummaries = STANDARD_STAGE_TYPES.map((type) => {
        const phase = product.phases.find((entry) => entry.type === type);
        const summary = summarizeWorkflowItems(phase ? productWorkflow.filter((item) => item.phaseId === phase.id) : []);
        return { type, phase, summary, state: phase ? stageStateFromSummary(summary) : "not-added" };
      });
      const currentStage = stageSummaries.find(({ state }) => !["done", "not-added"].includes(state))
        ?? stageSummaries.findLast(({ phase }) => phase)
        ?? stageSummaries[0];
      const overall = summarizeWorkflowItems(productWorkflow);
      const materialSummary = summarizeBomItems(productBom);
      return {
        project,
        product,
        currentStage,
        overall,
        materialSummary,
        completed: isProductWorkflowComplete(product, productWorkflow),
        exceptions: overall.blocked + overall.risk + materialSummary.shortage,
      };
    })).filter((row) => !row.completed).slice(0, 6);

    return {
      mine,
      visibleMine,
      exceptions,
      productRows,
      overdue: mine.filter(({ raw }) => isOverdue(raw)).length,
      blocked: mine.filter(({ status }) => status === TASK_STATUS.BLOCKED).length,
      dueThisWeek: mine.filter(({ raw }) => isDueThisWeek(raw)).length,
    };
  }, [accounts, bomItems, currentAccount, definitions, materials, projects, search, tasks, workflowItems]);

  return (
    <div className="workbench-page">
      <header className="workbench-heading">
        <div><h1>工作台</h1><p>先处理最需要关注的事项。</p></div>
      </header>

      <section className="workbench-focus" aria-label="我的工作概况">
        <dl>
          <div><ClipboardCheck size={22} aria-hidden="true" /><dt>{currentAccount?.systemRole === "admin" ? "团队待办" : "我的待办"}</dt><dd>{data.mine.length}</dd></div>
          <div className="is-danger"><CalendarClock size={22} aria-hidden="true" /><dt>逾期</dt><dd>{data.overdue}</dd></div>
          <div className="is-warning"><CircleMinus size={22} aria-hidden="true" /><dt>阻塞</dt><dd>{data.blocked}</dd></div>
          <div><CheckCircle2 size={22} aria-hidden="true" /><dt>本周到期</dt><dd>{data.dueThisWeek}</dd></div>
        </dl>
        <button className="button button-primary" type="button" disabled={!data.visibleMine.length} onClick={() => data.visibleMine[0] && onOpenItem?.(data.visibleMine[0])}>
          继续处理 <ArrowRight size={16} />
        </button>
      </section>

      <div className="workbench-primary-grid">
        <section className="workbench-panel workbench-priority" aria-labelledby="priority-title">
          <header><h2 id="priority-title">优先处理</h2><span>{data.visibleMine.length} 项</span></header>
          <div className="workbench-table-wrap">
            <table className="workbench-table">
              <thead><tr><th>项目 / 产品</th><th>任务</th><th>阶段</th><th>状态</th><th>到期日期</th><th><span className="sr-only">打开</span></th></tr></thead>
              <tbody>
                {data.visibleMine.slice(0, 7).map((item) => (
                  <tr key={item.id} onClick={() => onOpenItem?.(item)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenItem?.(item)}>
                    <td><strong>{item.project.name || item.project.code}</strong><small>{item.project.name && item.project.name !== item.project.code ? `${item.project.code} · ` : ""}{item.product.name}{item.product.version ? ` · ${item.product.version}` : ""}</small></td>
                    <td><strong>{item.title}</strong><small>{item.detail}</small></td>
                    <td>{item.phase?.type ?? "—"}</td>
                    <td><WorkStatus status={item.status} overdue={item.overdue} /></td>
                    <td className={item.overdue ? "is-danger" : ""}>{formatDate(item.dueDate)}</td>
                    <td><ArrowRight size={16} aria-hidden="true" /></td>
                  </tr>
                ))}
                {!data.visibleMine.length ? <tr><td className="workbench-empty" colSpan="6">当前没有符合条件的待办事项。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="workbench-panel workbench-exceptions" aria-labelledby="exception-title">
          <header><h2 id="exception-title">项目异常</h2><span>{data.exceptions.length} 项</span></header>
          <div className="workbench-exception-list">
            {data.exceptions.map((item) => {
              const Icon = item.exceptionType === "blocked" ? CircleMinus : item.exceptionType === "risk" ? AlertTriangle : PackageX;
              const label = item.exceptionType === "blocked" ? "阻塞" : item.exceptionType === "risk" ? "风险" : "缺料";
              return (
                <button type="button" key={item.id} className={`workbench-exception workbench-exception--${item.exceptionType}`} onClick={() => onOpenItem?.(item)}>
                  <Icon size={18} aria-hidden="true" />
                  <span><b>{label} · {item.project.name || item.project.code}</b><small>{item.project.name && item.project.name !== item.project.code ? `${item.project.code} · ` : ""}{item.product.name}{item.product.version ? ` · ${item.product.version}` : ""} · {item.title}</small></span>
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              );
            })}
            {!data.exceptions.length ? <p className="workbench-empty">当前没有阻塞、风险或缺料。</p> : null}
          </div>
        </section>
      </div>

      <section className="workbench-panel workbench-projects" aria-labelledby="active-project-title">
        <header><h2 id="active-project-title">进行中的项目</h2><button type="button" onClick={onOpenProjects}>查看全部项目 <ArrowRight size={15} /></button></header>
        <div className="workbench-table-wrap">
          <table className="workbench-table">
            <thead><tr><th>项目 / 产品</th><th>当前阶段</th><th>阶段就绪度</th><th>下一里程碑</th><th>异常</th><th><span className="sr-only">打开</span></th></tr></thead>
            <tbody>
              {data.productRows.map((row) => (
                <tr key={`${row.project.id}:${row.product.id}`} onClick={() => onOpenProduct?.(row.project.id, row.product.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpenProduct?.(row.project.id, row.product.id)}>
                  <td><strong>{row.project.name || row.project.code}</strong><small>{row.project.name && row.project.name !== row.project.code ? `${row.project.code} · ` : ""}{row.product.name}{row.product.version ? ` · ${row.product.version}` : ""}</small></td>
                  <td>{row.currentStage?.phase ? `${row.currentStage.type} · ${row.currentStage.phase.label.replace(`${row.currentStage.type} `, "")}` : "待添加阶段"}</td>
                  <td><span className="workbench-progress"><i><em style={{ width: `${row.currentStage?.summary.readinessPct ?? 0}%` }} /></i><b>{row.currentStage?.summary.readinessPct ?? 0}%</b></span></td>
                  <td>{formatDate(row.currentStage?.phase?.planDate)}</td>
                  <td><span className={row.exceptions ? "workbench-exception-count is-active" : "workbench-exception-count"}>{row.exceptions}</span></td>
                  <td><ArrowRight size={16} aria-hidden="true" /></td>
                </tr>
              ))}
              {!data.productRows.length ? <tr><td className="workbench-empty" colSpan="6">当前没有进行中的项目。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default WorkbenchPage;
