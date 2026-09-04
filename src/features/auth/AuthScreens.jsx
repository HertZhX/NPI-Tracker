import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, LogIn, ShieldCheck, X } from "lucide-react";
import { Brand } from "../../components/ui/Brand.jsx";
import { useModalFocus } from "../../hooks/useModalFocus.js";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  autoFocus = false,
  minLength,
  maxLength = 128,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}</span>
      <span className="auth-password-input">
        <LockKeyhole size={17} aria-hidden="true" />
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          minLength={minLength}
          maxLength={maxLength}
          required
        />
        <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </span>
    </label>
  );
}

export function AuthLoading({ message = "正在验证登录状态…" }) {
  return (
    <main className="auth-shell auth-loading" aria-busy="true">
      <Brand />
      <span className="auth-spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}

export function LoginPage({ onLogin }) {
  const usernameId = useId();
  const passwordId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onLogin?.({ username: username.trim(), password });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <header className="auth-card__header">
          <Brand />
          <span className="auth-card__icon"><ShieldCheck size={22} /></span>
          <h1 id="login-title">登录 NPI 协同平台</h1>
          <p>使用管理员分配的账号提交各自负责的任务和材料。</p>
        </header>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field" htmlFor={usernameId}>
            <span>账号</span>
            <span className="auth-text-input">
              <LogIn size={17} aria-hidden="true" />
              <input
                id={usernameId}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </span>
          </label>
          <PasswordField
            id={passwordId}
            label="密码"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="button button-primary auth-submit" type="submit" disabled={submitting || !username.trim() || !password}>
            <LogIn size={17} />{submitting ? "正在登录…" : "登录"}
          </button>
        </form>
        <footer className="auth-card__footer">
          首次登录请使用管理员提供的初始密码，登录后必须设置新密码。忘记密码请联系管理员重置。
        </footer>
      </section>
    </main>
  );
}

function PasswordChangeForm({ account, forced, onChangePassword, onCancel }) {
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onChangePassword?.({ currentPassword, newPassword });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "密码修改失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form password-change-form" onSubmit={handleSubmit}>
      <p className="password-account"><b>{account?.name}</b><span>@{account?.username}</span></p>
      <PasswordField id={`${id}-current`} label={forced ? "初始密码" : "当前密码"} value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" autoFocus />
      <PasswordField id={`${id}-new`} label="新密码" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={8} />
      <PasswordField id={`${id}-confirm`} label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" minLength={8} />
      <p className="auth-help">密码至少 8 位即可，不限制字符组合。</p>
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
      <div className="password-change-actions">
        {!forced ? <button className="button button-secondary" type="button" onClick={onCancel}>取消</button> : null}
        <button className="button button-primary" type="submit" disabled={submitting || !currentPassword || !newPassword || !confirmPassword}>
          <KeyRound size={17} />{submitting ? "正在修改…" : forced ? "修改密码并进入系统" : "保存新密码"}
        </button>
      </div>
    </form>
  );
}

export function ForcedPasswordPage({ account, onChangePassword }) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="password-title">
        <header className="auth-card__header">
          <Brand />
          <span className="auth-card__icon"><KeyRound size={22} /></span>
          <h1 id="password-title">首次登录，请设置新密码</h1>
          <p>为保护账号安全，修改初始密码后才能进入系统。</p>
        </header>
        <PasswordChangeForm account={account} forced onChangePassword={onChangePassword} />
      </section>
    </main>
  );
}

export function PasswordDialog({ open, account, onClose, onChangePassword }) {
  const titleId = useId();
  const dialogRef = useModalFocus(open, onClose);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dialog password-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div className="dialog-heading"><span className="dialog-icon"><KeyRound size={20} /></span><div><h2 id={titleId}>修改密码</h2><p className="dialog-subtitle">修改后其他已登录设备会自动退出</p></div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭修改密码窗口"><X size={20} /></button>
        </header>
        <PasswordChangeForm account={account} forced={false} onCancel={onClose} onChangePassword={onChangePassword} />
      </section>
    </div>
  );
}
