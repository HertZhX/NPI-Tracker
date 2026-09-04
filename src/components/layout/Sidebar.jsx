import {
  ChevronsUpDown,
  FolderKanban,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { Brand } from "../ui/Brand";

const NAV_ITEMS = [
  { id: "workbench", label: "工作台", icon: LayoutGrid },
  { id: "projects", label: "项目", icon: FolderKanban },
];

export function Sidebar({
  activeView,
  onViewChange,
  myCount = 0,
  currentAccount,
  onOpenAccounts,
  isAdmin = false,
  collapsed = false,
  onToggleCollapsed,
}) {
  return (
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <div className="sidebar-brand">
        <Brand />
      </div>
      {onToggleCollapsed ? (
        <button
          className="sidebar-collapse-toggle"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      ) : null}
      <nav className="sidebar-nav" aria-label="主导航">
        {NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item ${activeView === id ? "is-active" : ""}`}
            onClick={() => onViewChange(id)}
            aria-current={activeView === id ? "page" : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
            <span>{label}</span>
            {id === "workbench" && myCount > 0 ? <b className="nav-count">{myCount}</b> : null}
          </button>
        ))}
      </nav>
      {isAdmin ? (
        <nav className="sidebar-admin-nav" aria-label="系统管理">
          <button
            type="button"
            className={`nav-item ${activeView === "settings" ? "is-active" : ""}`}
            onClick={() => onViewChange("settings")}
            aria-current={activeView === "settings" ? "page" : undefined}
            title={collapsed ? "系统管理" : undefined}
          >
            <Settings size={19} strokeWidth={1.9} aria-hidden="true" />
            <span>系统管理</span>
          </button>
        </nav>
      ) : null}
      <button className="sidebar-user" type="button" onClick={onOpenAccounts} aria-label={`当前登录账号：${currentAccount?.name ?? "未设置"}，打开账号菜单`}>
        <span className="avatar" aria-hidden="true">{currentAccount?.name?.slice(0, 1) ?? "—"}</span>
        <span className="user-copy"><b>{currentAccount?.name ?? "未登录"}</b><small>{currentAccount ? `${currentAccount.jobRole} · ${currentAccount.systemRole === "admin" ? "管理员" : "成员"}` : "账号菜单"}</small></span>
        <ChevronsUpDown className="sidebar-user__switch" size={15} aria-hidden="true" />
      </button>
    </aside>
  );
}
