import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  FileCheck2,
  FolderKanban,
} from "lucide-react";
import { summarizeBomItems } from "../../domain/bom.js";
import { isProjectManuallyCompleted } from "../../domain/projects.js";
import {
  isProductWorkflowComplete,
  STANDARD_STAGE_TYPES,
  stageStateFromSummary,
  summarizeWorkflowItems,
} from "../../domain/workflow.js";

const STAGE_LABELS = Object.freeze({
  P: "P",
  EB: "EB",
  PP: "PP",
  MP: "MP",
});

function productKey(projectId, productId) {
  return `${projectId}:${productId}`;
}

function stageLabel(state) {
  if (state === "not-added") return "未配置";
  if (state === "done") return "完成";
  if (state === "blocked") return "阻塞";
  if (state === "risk") return "风险";
  if (state === "active") return "进行中";
  return "未开始";
}

function buildProductRows(projects, workflowItems, bomItems) {
  const workflowByProduct = new Map();
  const bomByProduct = new Map();

  for (const item of workflowItems) {
    const key = productKey(item.projectId, item.productId);
    const list = workflowByProduct.get(key) ?? [];
    list.push(item);
    workflowByProduct.set(key, list);
  }
  for (const item of bomItems) {
    const key = productKey(item.projectId, item.productId);
    const list = bomByProduct.get(key) ?? [];
    list.push(item);
    bomByProduct.set(key, list);
  }

  return projects.flatMap((project) => project.products.map((product, productIndex) => {
    const key = productKey(project.id, product.id);
    const productWorkflow = workflowByProduct.get(key) ?? [];
    const productBom = bomByProduct.get(key) ?? [];
    const overall = summarizeWorkflowItems(productWorkflow);
    const deliverables = productWorkflow.filter(({ kind }) => kind === "deliverable");
    const fileSummary = summarizeWorkflowItems(deliverables);
    const materialSummary = summarizeBomItems(productBom);
    const stages = Object.fromEntries(STANDARD_STAGE_TYPES.map((type) => {
      const phase = product.phases.find((entry) => entry.type === type);
      const summary = summarizeWorkflowItems(
        phase ? productWorkflow.filter((item) => item.phaseId === phase.id) : [],
      );
      return [type, { summary, state: phase ? stageStateFromSummary(summary) : "not-added" }];
    }));
    const exceptionCount = overall.blocked + overall.risk + materialSummary.shortage;

    return {
      project,
      product,
      productIndex,
      productCount: project.products.length,
      overall,
      fileSummary,
      materialSummary,
      stages,
      exceptionCount,
      completed: isProductWorkflowComplete(product, productWorkflow),
      manuallyCompleted: isProjectManuallyCompleted(project),
    };
  }));
}

function PortfolioTable({ id, title, description, rows, totalRows, emptyText, completed = false, onOpenProduct }) {
  return (
    <section className={`portfolio-table-panel ${completed ? "portfolio-table-panel--completed" : ""}`} aria-labelledby={id}>
      <header>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
        <span>显示 {rows.length} / {totalRows}</span>
      </header>
      <div className="portfolio-table-viewport">
        <table className="portfolio-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>产品</th>
              <th>料号</th>
              <th>版本</th>
              <th>负责人</th>
              <th>整体进度</th>
              {STANDARD_STAGE_TYPES.map((type) => <th key={type}>{STAGE_LABELS[type]} 阶段</th>)}
              <th>文件</th>
              <th>材料</th>
              <th>异常</th>
              <th><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={productKey(row.project.id, row.product.id)}>
                <td>
                  <strong>{row.project.name || row.project.code}</strong>
                  <small>{row.project.name && row.project.name !== row.project.code ? `${row.project.code} · ` : ""}{row.manuallyCompleted ? "提前完结" : `${row.productIndex + 1}/${row.productCount}`}</small>
                </td>
                <td>
                  <button
                    className="portfolio-product-link"
                    type="button"
                    onClick={() => onOpenProduct?.(row.project.id, row.product.id)}
                  >
                    {row.product.name}
                  </button>
                </td>
                <td>{row.product.partNumber || "—"}</td>
                <td>{row.product.version || "未填写"}</td>
                <td>{row.product.manager || "待分配"}</td>
                <td>
                  <span className="portfolio-progress">
                    <b>{row.manuallyCompleted ? "提前完结" : row.completed ? "已完成" : `${row.overall.readinessPct}%`}</b>
                    <i><em style={{ width: `${row.overall.readinessPct}%` }} /></i>
                  </span>
                </td>
                {STANDARD_STAGE_TYPES.map((type) => {
                  const stage = row.stages[type];
                  return (
                    <td key={type}>
                      <span className={`portfolio-stage portfolio-stage--${stage.state}`}>
                        <b>{stage.state === "not-added" ? "—" : `${stage.summary.readinessPct}%`}</b>
                        <small>{stageLabel(stage.state)}</small>
                      </span>
                    </td>
                  );
                })}
                <td><b>{row.fileSummary.readinessPct}%</b><small>{row.fileSummary.completed}/{row.fileSummary.applicable}</small></td>
                <td><b>{row.materialSummary.readinessPct}%</b><small>{row.materialSummary.ready}/{row.materialSummary.applicable}</small></td>
                <td><span className={row.exceptionCount ? "portfolio-exception is-active" : "portfolio-exception"}>{row.exceptionCount}</span></td>
                <td>
                  <button
                    className="portfolio-open-button"
                    type="button"
                    onClick={() => onOpenProduct?.(row.project.id, row.product.id)}
                    aria-label={`打开 ${row.project.name || row.project.code} ${row.product.name} 新品导入流程`}
                  >
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr><td className="portfolio-table__empty" colSpan={14}><Boxes size={24} />{emptyText}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ProjectOverviewPage({
  projects = [],
  workflowItems = [],
  bomItems = [],
  search = "",
  onOpenProduct,
}) {
  const rows = useMemo(
    () => buildProductRows(projects, workflowItems, bomItems),
    [bomItems, projects, workflowItems],
  );
  const completedProjectIds = useMemo(() => {
    const completionByProject = new Map(projects.map((project) => (
      [project.id, isProjectManuallyCompleted(project) || Boolean(project.products.length)]
    )));
    rows.forEach((row) => {
      if (!row.manuallyCompleted && !row.completed) completionByProject.set(row.project.id, false);
    });
    return new Set([...completionByProject]
      .filter(([, completed]) => completed)
      .map(([projectId]) => projectId));
  }, [projects, rows]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchesSearch = ({ project, product }) => !normalizedSearch || (
      `${project.code} ${project.name} ${project.completionNote || ""} ${product.partNumber} ${product.version} ${product.manager} ${product.name}`.toLocaleLowerCase().includes(normalizedSearch)
  );
  const activeRows = rows.filter(({ project }) => !completedProjectIds.has(project.id));
  const completedRows = rows.filter(({ project }) => completedProjectIds.has(project.id));
  const visibleActiveRows = activeRows.filter(matchesSearch);
  const visibleCompletedRows = completedRows.filter(matchesSearch);
  const overall = useMemo(() => summarizeWorkflowItems(workflowItems), [workflowItems]);
  const deliverableSummary = useMemo(
    () => summarizeWorkflowItems(workflowItems.filter(({ kind }) => kind === "deliverable")),
    [workflowItems],
  );
  const riskProducts = rows.filter(({ exceptionCount }) => exceptionCount > 0).length;

  return (
    <div className="portfolio-overview">
      <header className="portfolio-overview__heading">
        <div>
          <h1>项目总览</h1>
          <p>集中查看全部项目及产品的阶段门、文件和材料整体进度。</p>
        </div>
        <span>{projects.length} 个项目 · {rows.length} 个产品</span>
      </header>

      <section className="portfolio-metrics" aria-label="全部项目指标">
        <article>
          <FolderKanban size={22} aria-hidden="true" />
          <span>整体就绪度</span>
          <strong>{overall.readinessPct}%</strong>
          <small>{overall.completed}/{overall.applicable} 项完成</small>
        </article>
        <article>
          <CheckCircle2 size={22} aria-hidden="true" />
          <span>已完成项目</span>
          <strong>{completedProjectIds.size}</strong>
          <small>共 {projects.length} 个项目</small>
        </article>
        <article>
          <FileCheck2 size={22} aria-hidden="true" />
          <span>文件收集进度</span>
          <strong>{deliverableSummary.readinessPct}%</strong>
          <small>{deliverableSummary.completed}/{deliverableSummary.applicable} 份完成</small>
        </article>
        <article className={riskProducts ? "is-warning" : ""}>
          <AlertTriangle size={22} aria-hidden="true" />
          <span>异常产品</span>
          <strong>{riskProducts}</strong>
          <small>含风险、阻塞或缺料</small>
        </article>
      </section>

      <PortfolioTable
        id="portfolio-active-table-title"
        title="进行中项目"
        description="仍有已配置阶段未完成的项目保留在这里。"
        rows={visibleActiveRows}
        totalRows={activeRows.length}
        emptyText={normalizedSearch ? "没有匹配的进行中项目" : "当前没有进行中的项目"}
        onOpenProduct={onOpenProduct}
      />

      <PortfolioTable
        id="portfolio-completed-table-title"
        title="已完成项目"
        description="全部适用阶段完成，或由管理员提前完结的项目归入此列表。"
        rows={visibleCompletedRows}
        totalRows={completedRows.length}
        emptyText={normalizedSearch ? "没有匹配的已完成项目" : "当前还没有已完成项目"}
        completed
        onOpenProduct={onOpenProduct}
      />
    </div>
  );
}

export default ProjectOverviewPage;
