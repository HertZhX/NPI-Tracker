import {
  ArrowRight,
  FileSpreadsheet,
  KeyRound,
  Settings2,
  UsersRound,
} from "lucide-react";

export function SystemManagementPage({
  accountCount = 0,
  definitionCount = 0,
  onOpenAccounts,
  onOpenTemplates,
  onChangePassword,
}) {
  return (
    <div className="system-management-page">
      <header>
        <h1>系统管理</h1>
        <p>集中维护账号权限、交付模板和当前账号安全设置。</p>
      </header>
      <section className="settings-list" aria-label="系统管理功能">
        <button type="button" onClick={onOpenAccounts}>
          <span className="settings-list__icon"><UsersRound size={21} /></span>
          <span><strong>账号与权限</strong><small>创建成员、调整系统角色、停用账号和重置密码</small></span>
          <b>{accountCount} 个账号</b><ArrowRight size={17} />
        </button>
        <button type="button" onClick={onOpenTemplates}>
          <span className="settings-list__icon"><FileSpreadsheet size={21} /></span>
          <span><strong>交付模板</strong><small>维护资料、程序、工装与材料的标准跟踪项</small></span>
          <b>{definitionCount} 个模板项</b><ArrowRight size={17} />
        </button>
        <button type="button" onClick={onChangePassword}>
          <span className="settings-list__icon"><KeyRound size={21} /></span>
          <span><strong>修改当前密码</strong><small>更新当前登录账号的访问密码</small></span>
          <b>账号安全</b><ArrowRight size={17} />
        </button>
      </section>
      <aside className="settings-note">
        <Settings2 size={19} aria-hidden="true" />
        <div><strong>项目数据操作保留在业务页面</strong><p>Excel、BOM 和报价单导入仍从对应产品的任务、材料页面执行，避免跨项目误操作。</p></div>
      </aside>
    </div>
  );
}

export default SystemManagementPage;
