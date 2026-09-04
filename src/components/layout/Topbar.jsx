import { useMemo } from "react";
import {
  Bell,
  CheckCircle2,
  CircleHelp,
  FolderKanban,
  Package,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { calculateSelectWidth, productOptionLabel, projectOptionLabel } from "./topbarSizing.js";

export function Topbar({
  scope = "global",
  projects = [],
  currentProjectId = "",
  onSelectProject,
  products = [],
  currentProductId = "",
  onSelectProduct,
  phases = [],
  currentPhaseId = "",
  onSelectPhase,
  search = "",
  onSearchChange,
  onNewProject,
  onRenameProject,
  projectStatus = "active",
  onChangeProjectStatus,
  onDeleteProject,
  onNotifications,
  onHelp,
  currentAccount,
  onOpenAccounts,
}) {
  const showContext = scope === "workspace";
  const projectSelectStyle = useMemo(() => ({
    "--project-select-width": calculateSelectWidth(projects.map(projectOptionLabel), {
      minimum: 150,
      maximum: 240,
    }),
  }), [projects]);
  const productSelectStyle = useMemo(() => ({
    "--product-select-width": calculateSelectWidth(products.map(productOptionLabel), {
      minimum: 190,
      maximum: 320,
    }),
  }), [products]);

  function handlePhaseKeyDown(event, index) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = phases.length - 1;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + phases.length) % phases.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % phases.length;
    const nextPhase = phases[nextIndex];
    if (!nextPhase) return;
    onSelectPhase?.(nextPhase.id);
    event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
  }

  return (
    <header className={`topbar topbar--${scope}`}>
      {showContext ? (
        <div className="topbar-context" aria-label="当前项目上下文">
          <label className="context-select context-select--project" style={projectSelectStyle}>
            <FolderKanban size={17} aria-hidden="true" />
            <span className="sr-only">选择项目</span>
            <select value={currentProjectId} onChange={(event) => onSelectProject?.(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{projectOptionLabel(project)}</option>)}
            </select>
          </label>
          <label className="context-select context-select--product" style={productSelectStyle}>
            <Package size={17} aria-hidden="true" />
            <span className="sr-only">选择产品</span>
            <select value={currentProductId} onChange={(event) => onSelectProduct?.(event.target.value)}>
              {products.map((product) => (
                <option key={product.id} value={product.id}>{productOptionLabel(product)}</option>
              ))}
            </select>
          </label>
        </div>
      ) : <div className="topbar-spacer" />}

      {showContext ? (
        <div className="phase-tabs phase-tabs--context" role="tablist" aria-label="项目阶段">
          {phases.map((phase, index) => (
            <button
              key={phase.id}
              type="button"
              role="tab"
              aria-selected={phase.id === currentPhaseId}
              tabIndex={phase.id === currentPhaseId ? 0 : -1}
              className={phase.id === currentPhaseId ? "is-active" : ""}
              onClick={() => onSelectPhase?.(phase.id)}
              onKeyDown={(event) => handlePhaseKeyDown(event, index)}
            >
              <span>{phase.type}</span>
              <b>{phase.label.replace(`${phase.type} `, "")}</b>
            </button>
          ))}
        </div>
      ) : null}

      <label className="global-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">搜索项目、产品、任务或文档</span>
        <input
          value={search}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder={showContext ? "搜索当前产品的任务或文档…" : "搜索项目、产品、任务或文档…"}
        />
      </label>
      <button className="icon-button notification-button" type="button" aria-label="通知" onClick={onNotifications}>
        <Bell size={19} />
        <span>3</span>
      </button>
      <button className="icon-button topbar-help" type="button" aria-label="帮助" onClick={onHelp}>
        <CircleHelp size={19} />
      </button>
      <button className="icon-button topbar-account" type="button" aria-label={`当前登录账号：${currentAccount?.name ?? "未设置"}，打开账号菜单`} onClick={onOpenAccounts}>
        <UserRound size={18} />
        <span aria-hidden="true">{currentAccount?.name?.slice(0, 1) ?? "—"}</span>
      </button>
      {onRenameProject ? (
        <button className="icon-button project-rename-button" type="button" onClick={onRenameProject} aria-label="重命名当前项目" title="重命名当前项目">
          <PencilLine size={17} aria-hidden="true" />
        </button>
      ) : null}
      {onChangeProjectStatus ? (
        <button
          className="icon-button project-status-button"
          type="button"
          onClick={onChangeProjectStatus}
          aria-label={projectStatus === "completed" ? "恢复当前项目" : "提前完结当前项目"}
          title={projectStatus === "completed" ? "恢复当前项目" : "提前完结当前项目"}
        >
          {projectStatus === "completed" ? <RotateCcw size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
        </button>
      ) : null}
      {onDeleteProject ? (
        <button className="icon-button project-delete-button" type="button" onClick={onDeleteProject} aria-label="删除当前项目" title="删除当前项目">
          <Trash2 size={17} aria-hidden="true" />
        </button>
      ) : null}
      {onNewProject ? (
        <button className="primary-button topbar-create" type="button" onClick={onNewProject}>
          <Plus size={17} /> 新建项目
        </button>
      ) : null}
    </header>
  );
}
