import { useId, useState } from "react";
import { Copy, KeyRound, LogOut, ShieldCheck, Trash2, UserPlus, Users, X } from "lucide-react";
import { JOB_ROLE_OPTIONS } from "../../domain/accounts.js";
import { useModalFocus } from "../../hooks/useModalFocus.js";

const EMPTY_ACCOUNT = Object.freeze({
  username: "",
  name: "",
  department: "",
  jobRole: "",
  systemRole: "member",
});

function roleLabel(role) {
  return role === "admin" ? "管理员" : "成员";
}

export function AccountDialog({
  open,
  accounts = [],
  currentAccountId,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onResetPassword,
  onLogout,
  onChangePassword,
}) {
  const titleId = useId();
  const dialogRef = useModalFocus(open, onClose);
  const [form, setForm] = useState(EMPTY_ACCOUNT);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [credential, setCredential] = useState(null);
  const currentAccount = accounts.find(({ id }) => id === currentAccountId) ?? null;
  const isAdmin = currentAccount?.systemRole === "admin";

  if (!open) return null;

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
  }

  async function handleCreate(event) {
    event.preventDefault();
    const cleaned = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]));
    if (Object.values(cleaned).some((value) => !value)) {
      setError("请完整填写账号、姓名、部门、岗位和系统角色");
      return;
    }
    setBusyId("create");
    setError("");
    try {
      const result = await onCreate?.(cleaned);
      if (!result) throw new Error("账号创建失败");
      setCredential({ username: result.account.username, password: result.initialPassword });
      setForm(EMPTY_ACCOUNT);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "账号创建失败");
    } finally {
      setBusyId("");
    }
  }

  async function handleAccountAction(accountId, action) {
    setBusyId(`${action}:${accountId}`);
    setError("");
    try {
      const result = action === "reset"
        ? await onResetPassword?.(accountId)
        : await onUpdate?.(accountId, action);
      if (action === "reset" && result) {
        setCredential({ username: result.account.username, password: result.initialPassword });
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setBusyId("");
    }
  }

  async function handleDelete(account) {
    const confirmed = window.confirm(
      `确定永久删除账号“${account.name}”（@${account.username}）吗？\n\n`
      + "删除后无法恢复；如账号已有项目、任务、BOM、材料确认或责任提交记录，系统会拒绝删除，请改为停用。",
    );
    if (!confirmed) return;
    setBusyId(`delete:${account.id}`);
    setError("");
    try {
      const result = await onDelete?.(account.id);
      if (!result) throw new Error("账号删除失败");
      setCredential(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "账号删除失败");
    } finally {
      setBusyId("");
    }
  }

  async function copyCredential() {
    if (!credential) return;
    await navigator.clipboard?.writeText(`账号：${credential.username}\n初始密码：${credential.password}`);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog account-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading">
            <span className="dialog-icon"><Users size={20} /></span>
            <div><h2 id={titleId}>{isAdmin ? "账号与权限管理" : "我的账号"}</h2><p className="dialog-subtitle">当前身份由服务端登录会话确定，不能直接切换</p></div>
          </div>
          <button className="icon-button dialog-close" type="button" onClick={onClose} aria-label="关闭账号窗口"><X size={20} /></button>
        </header>

        <div className="account-dialog__body">
          <section className="signed-account-card" aria-label="当前登录账号">
            <span className="account-avatar" aria-hidden="true">{currentAccount?.name?.slice(0, 1) ?? "—"}</span>
            <span><b>{currentAccount?.name ?? "未知账号"}</b><small>@{currentAccount?.username} · {currentAccount?.department} · {currentAccount?.jobRole}</small></span>
            <span className={`system-role-badge system-role-badge--${currentAccount?.systemRole}`}>{roleLabel(currentAccount?.systemRole)}</span>
            <div className="signed-account-actions">
              <button className="button button-secondary" type="button" onClick={onChangePassword}><KeyRound size={15} />修改密码</button>
              <button className="button button-secondary account-logout" type="button" onClick={onLogout}><LogOut size={15} />退出登录</button>
            </div>
          </section>

          {credential ? (
            <section className="credential-reveal" role="status">
              <ShieldCheck size={18} />
              <div><b>初始密码仅显示这一次</b><p>账号：<code>{credential.username}</code></p><p>初始密码：<code>{credential.password}</code></p><small>请安全发送给本人；首次登录后系统会强制修改。</small></div>
              <button className="button button-secondary" type="button" onClick={copyCredential}><Copy size={15} />复制</button>
            </section>
          ) : null}

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          {isAdmin ? (
            <>
              <section className="account-list-section" aria-label="成员账号列表">
                <div className="account-section-heading"><div><h3>成员账号</h3><p>{accounts.filter(({ active }) => active).length} 个启用账号</p></div></div>
                <ul className="account-list account-list--secure">
                  {accounts.map((account) => {
                    const current = account.id === currentAccountId;
                    return (
                      <li key={account.id} className={`${current ? "is-current" : ""} ${account.active ? "" : "is-disabled"}`}>
                        <span className="account-avatar" aria-hidden="true">{account.name.slice(0, 1)}</span>
                        <span className="account-list__copy"><b>{account.name}</b><small>@{account.username} · {account.department} · {account.jobRole}</small></span>
                        <span className={`system-role-badge system-role-badge--${account.systemRole}`}>{roleLabel(account.systemRole)}</span>
                        <span className="account-status-text">{account.active ? "启用" : "停用"}</span>
                        <span className="account-secure-actions">
                          <button type="button" disabled={current || Boolean(busyId)} onClick={() => handleAccountAction(account.id, "reset")}>重置密码</button>
                          <button type="button" disabled={current || Boolean(busyId)} onClick={() => handleAccountAction(account.id, { active: !account.active })}>{account.active ? "停用" : "启用"}</button>
                          <button className="account-action--danger" type="button" disabled={current || Boolean(busyId)} onClick={() => handleDelete(account)}><Trash2 size={12} />删除</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <form className="account-create-form" onSubmit={handleCreate} noValidate>
                <div className="account-section-heading"><div><h3><UserPlus size={17} />新增账号</h3><p>系统自动生成一次性初始密码</p></div></div>
                <div className="form-grid form-grid-two-columns">
                  <label className="form-field"><span>登录账号</span><input name="username" value={form.username} onChange={updateField} placeholder="例如：lifang" autoComplete="off" /></label>
                  <label className="form-field"><span>姓名</span><input name="name" value={form.name} onChange={updateField} placeholder="例如：李芳" autoComplete="name" /></label>
                  <label className="form-field"><span>部门</span><input name="department" value={form.department} onChange={updateField} placeholder="例如：采购部" autoComplete="organization" /></label>
                  <label className="form-field"><span>岗位</span><select name="jobRole" value={form.jobRole} onChange={updateField}><option value="">请选择岗位</option>{JOB_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                  <label className="form-field"><span>系统角色</span><select name="systemRole" value={form.systemRole} onChange={updateField}><option value="member">成员：只提交本人事项</option><option value="admin">管理员：配置与分配</option></select></label>
                </div>
                <div className="account-create-actions"><button className="button button-primary" type="submit" disabled={busyId === "create"}><UserPlus size={16} />{busyId === "create" ? "正在创建…" : "创建账号"}</button></div>
              </form>
            </>
          ) : (
            <p className="member-permission-note"><ShieldCheck size={17} />成员可查看本人负责的产品和相关阶段总览，只能提交分配给自己的事项、任务及 BOM 材料；项目配置、导入、责任人分配和账号管理由管理员完成。</p>
          )}
        </div>
      </section>
    </div>
  );
}

export default AccountDialog;
