import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleMinus,
  ClipboardCheck,
  FileCheck2,
  FolderArchive,
  LockKeyhole,
  PackageCheck,
  Plus,
  RotateCcw,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import { summarizeBomItems } from "../../domain/bom.js";
import { getStatusMeta, TASK_STATUS } from "../../domain/statuses.js";
import {
  getCurrentStandardPhase,
  getStageGateResult,
  MEETING_STATUS,
  MEETING_TYPE,
  STANDARD_STAGE_TYPES,
  STAGE_TEMPLATES,
  summarizeWorkflowItems,
} from "../../domain/workflow.js";

const STATUS_ICON = {
  [TASK_STATUS.DONE]: CheckCircle2,
  [TASK_STATUS.BLOCKED]: CircleMinus,
  [TASK_STATUS.RISK]: TriangleAlert,
  [TASK_STATUS.IN_PROGRESS]: Circle,
  [TASK_STATUS.PENDING_REVIEW]: FileCheck2,
};

const MEETING_STATUS_LABEL = {
  [MEETING_STATUS.PENDING]: "待安排",
  [MEETING_STATUS.SCHEDULED]: "已安排",
  [MEETING_STATUS.COMPLETED]: "已完成",
  [MEETING_STATUS.CANCELLED]: "已取消",
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).replaceAll("/", "-");
}

function StatusText({ status }) {
  const meta = getStatusMeta(status);
  const Icon = STATUS_ICON[status] ?? Circle;
  return <span className={`workflow-status workflow-status--${meta.semantic}`}><Icon size={16} strokeWidth={1.9} aria-hidden="true" />{meta.label}</span>;
}

function WorkflowItemTable({ items, selectedItemId, onSelectItem, canConfigure, onArchiveItem }) {
  return (
    <div className="checkpoint-table-wrap">
      <table className="checkpoint-table">
        <thead><tr><th>序号</th><th>类型</th><th>阶段事项</th><th>状态</th><th>责任人</th><th>计划日期</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{items.map((item, index) => (
          <tr
            key={item.id}
            className={`${selectedItemId === item.id ? "is-selected" : ""} ${item.archivedAt ? "is-archived" : ""} checkpoint-row--${getStatusMeta(item.status).semantic}`}
            onClick={() => !item.archivedAt && onSelectItem?.(item)}
          >
            <td>{index + 1}</td>
            <td><span className={`workflow-kind workflow-kind--${item.kind}`}>{item.kind === "deliverable" ? "交付文件" : "关键任务"}</span></td>
            <td><strong>{item.title}{item.archivedAt ? "（已停用）" : ""}</strong><small>{item.archivedAt ? item.archiveReason || "已从当前阶段配置中移除" : item.criterion}</small></td>
            <td><StatusText status={item.status} /></td>
            <td>{item.owner || "待分配"} <small>{item.ownerRole ? `(${item.ownerRole})` : ""}</small></td>
            <td><time dateTime={item.baselineDate}>{formatDate(item.baselineDate)}</time></td>
            <td>{canConfigure && onArchiveItem ? <button className="icon-button workflow-archive-button" type="button" onClick={(event) => { event.stopPropagation(); onArchiveItem(item); }} aria-label={`${item.archivedAt ? "恢复" : "停用"} ${item.title}`} title={item.archivedAt ? "恢复事项" : "从当前阶段停用"}>{item.archivedAt ? <RotateCcw size={16} /> : <Archive size={16} />}</button> : <ChevronRight size={18} aria-hidden="true" />}</td>
          </tr>
        ))}</tbody>
      </table>
      {!items.length ? <div className="workflow-empty">当前筛选下没有阶段事项。</div> : null}
    </div>
  );
}

function GateCondition({ icon: Icon, title, detail, value, state = "neutral" }) {
  return <div className={`gate-condition gate-condition--${state}`}><Icon size={19} aria-hidden="true" /><span><strong>{title}</strong><small>{detail}</small></span><b>{value}</b></div>;
}

function MeetingCard({ meeting, title, description, onOpen }) {
  const complete = meeting?.status === MEETING_STATUS.COMPLETED;
  return (
    <button className={`stage-meeting-card ${complete ? "is-complete" : ""}`} type="button" onClick={() => meeting && onOpen?.(meeting)} disabled={!meeting}>
      <CalendarCheck2 size={21} />
      <span><strong>{title}</strong><small>{meeting?.subject || description}</small></span>
      <span><b>{MEETING_STATUS_LABEL[meeting?.status] ?? "未创建"}</b><small>{meeting?.evidence?.length ?? 0} 份文件</small></span>
      <ChevronRight size={17} />
    </button>
  );
}

export function StageGateDashboard({
  project,
  product,
  selectedPhase,
  workflowItems = [],
  meetings = [],
  bomItems = [],
  materialTasks = [],
  search = "",
  selectedItemId = "",
  onSelectItem,
  onOpenMaterials,
  onOpenFiles,
  onOpenTasks,
  onOpenMeeting,
  onOpenTransition,
  canManage = false,
  onAddWorkflowItem,
  onArchiveWorkflowItem,
}) {
  const [filter, setFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const isMpStage = selectedPhase.type === "MP";
  const effectiveKindFilter = isMpStage || kindFilter !== "deliverable" ? kindFilter : "all";
  const productItems = useMemo(
    () => workflowItems.filter((item) => item.projectId === project.id && item.productId === product.id),
    [product.id, project.id, workflowItems],
  );
  const selectedItems = useMemo(
    () => productItems.filter((item) => (
      item.phaseId === selectedPhase.id && (isMpStage || item.kind === "checkpoint")
    )),
    [isMpStage, productItems, selectedPhase.id],
  );
  const activeSelectedItems = selectedItems.filter((item) => !item.archivedAt);
  const summary = useMemo(() => summarizeWorkflowItems(activeSelectedItems), [activeSelectedItems]);
  const gate = useMemo(
    () => getStageGateResult(product, selectedPhase, productItems, meetings),
    [meetings, product, productItems, selectedPhase],
  );
  const checkpointSummary = gate.checkpointSummary;
  const selectedDeliverableSummary = summarizeWorkflowItems(activeSelectedItems.filter(({ kind }) => kind === "deliverable"));
  const phaseBomItems = bomItems.filter((item) => item.projectId === project.id && item.productId === product.id && item.phaseId === selectedPhase.id);
  const materialSummary = summarizeBomItems(phaseBomItems);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleItems = selectedItems
    .filter((item) => {
      if (!showArchived && item.archivedAt) return false;
      if (effectiveKindFilter !== "all" && item.kind !== effectiveKindFilter) return false;
      if (filter === "exceptions" && ![TASK_STATUS.RISK, TASK_STATUS.BLOCKED].includes(item.status)) return false;
      if (!normalizedSearch) return true;
      return `${item.title} ${item.criterion} ${item.owner} ${item.ownerRole}`.toLocaleLowerCase().includes(normalizedSearch);
    })
    .toSorted((left, right) => {
      if (Boolean(left.archivedAt) !== Boolean(right.archivedAt)) return left.archivedAt ? 1 : -1;
      if (left.kind !== right.kind) return left.kind === "checkpoint" ? -1 : 1;
      return left.order - right.order;
    });
  const currentPhase = getCurrentStandardPhase(product);
  const isCurrentPhase = currentPhase?.id === selectedPhase.id && product.workflowStatus === "active";
  const canConfigure = canManage && isCurrentPhase;
  const remaining = Math.max(0, checkpointSummary.applicable - checkpointSummary.completed);
  const configuredPhases = product.phases
    .filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
    .toSorted((left, right) => STANDARD_STAGE_TYPES.indexOf(left.type) - STANDARD_STAGE_TYPES.indexOf(right.type));
  const currentStageIndex = configuredPhases.findIndex(({ id }) => id === selectedPhase.id);
  const configuredNextPhase = currentStageIndex >= 0 ? configuredPhases[currentStageIndex + 1] : null;
  const structuralNextType = STANDARD_STAGE_TYPES[STANDARD_STAGE_TYPES.indexOf(selectedPhase.type) + 1] ?? null;
  const transitionLabel = configuredNextPhase || structuralNextType
    ? `完成评审并流转至 ${configuredNextPhase?.type ?? structuralNextType}`
    : "完成 MP 并结束产品流程";
  const archivedCount = selectedItems.filter(({ archivedAt }) => archivedAt).length;
  const evidenceCount = [...materialTasks, ...activeSelectedItems].reduce((total, item) => total + (item.evidence?.length ?? 0), 0);
  const kickoffMeeting = meetings.find((meeting) => meeting.phaseId === selectedPhase.id && meeting.type === MEETING_TYPE.KICKOFF) ?? gate.kickoffMeeting;
  const gateReviewMeeting = meetings.find((meeting) => meeting.phaseId === selectedPhase.id && meeting.type === MEETING_TYPE.GATE_REVIEW) ?? gate.gateReviewMeeting;

  return (
    <div className="stage-gate-page stage-gate-page--simplified">
      <section className="stage-meeting-strip" aria-label="阶段会议">
        <MeetingCard meeting={kickoffMeeting} title="阶段前启动会" description="明确目标、分工和阶段计划" onOpen={onOpenMeeting} />
        <span className="stage-meeting-flow"><ArrowRight size={18} /></span>
        <MeetingCard meeting={gateReviewMeeting} title="阶段后评审会" description="确认阶段结论和准入决定" onOpen={onOpenMeeting} />
      </section>

      <section className="stage-focus-strip" aria-label="当前阶段概况">
        <div className="stage-focus-readiness"><span className="stage-focus-ring" style={{ "--progress": `${checkpointSummary.readinessPct * 3.6}deg` }}><b>{checkpointSummary.readinessPct}%</b></span><span><small>关键任务完成度</small><strong>{checkpointSummary.readinessPct}%</strong><em>{checkpointSummary.completed} / {checkpointSummary.applicable} 项完成</em></span></div>
        <dl><div className={summary.blocked ? "is-danger" : ""}><dt>阻塞</dt><dd>{summary.blocked}</dd><CircleMinus size={22} /></div><div className={summary.risk ? "is-warning" : ""}><dt>风险</dt><dd>{summary.risk}</dd><AlertTriangle size={22} /></div><div><dt>关键任务待完成</dt><dd>{remaining}</dd><ClipboardCheck size={22} /></div></dl>
        <button className="button button-primary" type="button" onClick={onOpenTasks}>查看我的任务 <ArrowRight size={16} /></button>
      </section>

      <div className="stage-overview-grid">
        <section className="stage-checkpoint-panel" aria-labelledby="stage-task-title">
          <header className="workflow-section-heading">
            <div><h2 id="stage-task-title">{isMpStage ? "阶段任务与交付项" : "阶段关键任务"}</h2><p>{STAGE_TEMPLATES[selectedPhase.type]?.description}</p></div>
            <div className="workflow-toolbar">
              {isMpStage ? <label><span className="sr-only">事项类型</span><select value={effectiveKindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">全部类型</option><option value="checkpoint">关键任务</option><option value="deliverable">交付文件</option></select></label> : null}
              <label><span className="sr-only">事项筛选</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部任务</option><option value="exceptions">仅看异常</option></select></label>
              {archivedCount ? <label className="workflow-archived-filter"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /><span>已停用 {archivedCount}</span></label> : null}
              <button className="text-button" type="button" onClick={() => { setFilter("all"); setKindFilter("all"); setShowArchived(false); }}><RotateCw size={15} />重置</button>
              {canConfigure ? <button className="button button-primary workflow-add-button" type="button" onClick={onAddWorkflowItem}><Plus size={15} />新增事项</button> : null}
            </div>
          </header>
          <WorkflowItemTable items={visibleItems} selectedItemId={selectedItemId} onSelectItem={onSelectItem} canConfigure={canConfigure} onArchiveItem={onArchiveWorkflowItem} />
          <footer><button className="text-button" type="button" onClick={onOpenTasks}>查看材料交付进度 <ArrowRight size={15} /></button></footer>
        </section>

        <section className="stage-gate-conditions" aria-labelledby="gate-title">
          <header className="workflow-section-heading"><div><h2 id="gate-title">阶段门条件</h2><p>{selectedPhase.type === "MP" ? "MP 同时检查全部产品交付文件" : "前置阶段只检查关键任务"}</p></div></header>
          <div>
            <GateCondition icon={CalendarCheck2} title="阶段前启动会" detail="会议状态" value={gate.kickoffComplete ? "已完成" : "未完成"} state={gate.kickoffComplete ? "success" : "pending"} />
            <GateCondition icon={ClipboardCheck} title="关键任务" detail="当前阶段必需关键任务" value={`${checkpointSummary.completed} / ${checkpointSummary.applicable}`} state={gate.checkpointReady ? "success" : "pending"} />
            {isMpStage ? <GateCondition icon={FileCheck2} title="全部产品交付文件" detail="全部必需文件在 MP 统一确认" value={`${gate.deliverableSummary.completed} / ${gate.deliverableSummary.applicable}`} state={gate.deliverableReady ? "success" : "pending"} /> : null}
            <GateCondition icon={CalendarCheck2} title="阶段后评审会" detail="完成内容后提交评审结论" value={gate.reviewComplete ? "已完成" : "未完成"} state={gate.reviewComplete ? "success" : "pending"} />
            <GateCondition icon={PackageCheck} title="材料齐套" detail={materialSummary.applicable ? "辅助跟踪，不作为阶段门" : "当前阶段尚未导入 BOM"} value={materialSummary.applicable ? `${materialSummary.readinessPct}%` : "—"} state={materialSummary.applicable && materialSummary.ready === materialSummary.applicable ? "success" : "neutral"} />
          </div>
          <footer>
            <button className="button button-primary" type="button" disabled={!canConfigure || !gate.readyForTransition} onClick={onOpenTransition}>{gate.readyForTransition ? <ArrowRight size={16} /> : <LockKeyhole size={16} />}{transitionLabel}</button>
            {!isCurrentPhase ? <small>请选择产品当前阶段执行流转</small> : !gate.kickoffComplete ? <small>请先完成阶段前启动会</small> : !gate.contentReady ? <small>{selectedPhase.type === "MP" ? "请完成关键任务及全部产品交付文件" : "请完成当前阶段全部关键任务"}</small> : !gate.reviewComplete ? <small>内容已就绪，请完成阶段后评审会</small> : null}
          </footer>
        </section>
      </div>

      <div className={`stage-resource-strip ${isMpStage ? "" : "stage-resource-strip--single"}`}>
        {isMpStage ? <button type="button" onClick={onOpenFiles}><FileCheck2 size={22} aria-hidden="true" /><span><strong>MP 交付物 {selectedDeliverableSummary.completed}/{selectedDeliverableSummary.applicable}</strong><small>全部产品交付文件在 MP 阶段统一确认 · 附件证据 {evidenceCount} 份</small></span><b>查看交付物 <ArrowRight size={15} /></b></button> : null}
        <button type="button" onClick={onOpenMaterials}><PackageCheck size={22} aria-hidden="true" /><span><strong>材料齐套 {materialSummary.readinessPct}%</strong><small>{materialSummary.ready} 项齐套，{materialSummary.shortage} 项缺料</small></span><b>查看材料 <ArrowRight size={15} /></b></button>
      </div>
      {showArchived && archivedCount ? <p className="workflow-archive-hint"><FolderArchive size={15} />已停用事项不会参与阶段门计算，可随时恢复。</p> : null}
    </div>
  );
}

export default StageGateDashboard;
