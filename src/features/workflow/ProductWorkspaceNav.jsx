import {
  CalendarPlus,
  CalendarX2,
  ClipboardList,
  FileCheck2,
  LayoutDashboard,
  PackageCheck,
  PackagePlus,
  PencilLine,
  Trash2,
} from "lucide-react";
import { STANDARD_STAGE_TYPES } from "../../domain/workflow.js";

const WORKSPACE_TABS = [
  { id: "workflow", label: "概览", icon: LayoutDashboard },
  { id: "tasks", label: "任务", icon: ClipboardList },
  { id: "files", label: "交付物", icon: FileCheck2 },
  { id: "materials", label: "材料", icon: PackageCheck },
];

function formatDate(value) {
  if (!value) return "未设置";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : String(value);
}

export function ProductWorkspaceNav({
  project,
  product,
  phase,
  activeView,
  onViewChange,
  canManage = false,
  canDeleteProduct = false,
  canAddStage = false,
  canDeleteStage = false,
  onNewProduct,
  onAddStage,
  onDeleteStage,
  onEditProduct,
  onDeleteProduct,
}) {
  const workspaceTabs = phase?.type === "MP"
    ? WORKSPACE_TABS
    : WORKSPACE_TABS.filter(({ id }) => id !== "files");
  const finalPhase = product?.phases
    ?.filter(({ type }) => STANDARD_STAGE_TYPES.includes(type))
    .toSorted((left, right) => STANDARD_STAGE_TYPES.indexOf(left.type) - STANDARD_STAGE_TYPES.indexOf(right.type))
    .at(-1);

  return (
    <section className="product-workspace-header" aria-label="产品工作区">
      <div className="product-workspace-heading">
        <div>
          <h1>{product?.name ?? "未命名产品"} <span>·</span> {phase?.label ?? "未设置阶段"}</h1>
          <p>
            <span>项目 <strong>{project?.name || project?.code || "—"}</strong></span>
            {project?.name && project.name !== project.code ? <span>项目代码 <strong>{project.code}</strong></span> : null}
            <span>项目状态 <strong>{project?.status === "completed" ? "提前完结" : "进行中"}</strong></span>
            <span>版本 <strong>{product?.version || "未填写"}</strong></span>
            <span>料号 <strong>{product?.partNumber || "—"}</strong></span>
            <span>产品负责人 <strong>{product?.manager || "待分配"}</strong></span>
            <span>最终阶段 <strong>{finalPhase ? `${finalPhase.type} · ${formatDate(finalPhase.planDate)}` : "未设置"}</strong></span>
          </p>
        </div>
        {canManage ? (
          <div className="product-workspace-actions" role="group" aria-label="产品管理">
            <button type="button" onClick={onNewProduct} title="向当前项目新增产品"><PackagePlus size={16} />新增产品</button>
            <button type="button" onClick={onAddStage} disabled={!canAddStage} title={canAddStage ? "为当前产品补充适用阶段" : "已配置全部标准阶段"}><CalendarPlus size={16} />配置阶段</button>
            <button className="product-workspace-action--danger" type="button" onClick={onDeleteStage} disabled={!canDeleteStage} title={canDeleteStage ? `删除当前 ${phase?.type ?? ""} 阶段` : "产品至少需要保留一个阶段"}><CalendarX2 size={16} /><span className="sr-only">删除当前阶段</span></button>
            <button type="button" onClick={onEditProduct} title="编辑当前产品名称和版本"><PencilLine size={16} /><span className="sr-only">编辑当前产品信息</span></button>
            <button type="button" onClick={onDeleteProduct} disabled={!canDeleteProduct} title={canDeleteProduct ? "删除当前产品" : "项目至少需要保留一个产品"}><Trash2 size={16} /><span className="sr-only">删除当前产品</span></button>
          </div>
        ) : null}
      </div>
      <nav className="product-workspace-tabs" aria-label="产品工作区页面">
        {workspaceTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={activeView === id ? "is-active" : ""}
            onClick={() => onViewChange(id)}
            aria-current={activeView === id ? "page" : undefined}
          >
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>
    </section>
  );
}

export default ProductWorkspaceNav;
