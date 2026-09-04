NPI Tracker Windows x64 便携部署说明
====================================

一、环境要求

1. 推荐 Windows Server 2016 或更高版本，64 位系统。
2. 安装包已经内置 Node.js，无需另外安装 Node、npm 或数据库。
3. 请将整个文件夹解压到固定位置，例如 D:\Apps\NPI-Tracker。

二、直接启动（局域网 HTTP）

1. 双击 start-npi.cmd。
2. 第一次启动会自动创建 data\npi-tracker.sqlite 数据库。
3. 在服务器本机访问：http://127.0.0.1:4173
4. 局域网电脑访问：http://服务器IP:4173
5. 默认管理员账号：admin；首次初始密码：admin123。登录后必须立即修改密码。
6. 启动窗口不能关闭；按 Ctrl+C 可安全停止服务。

如果其他电脑无法访问，请由服务器管理员为 TCP 4173 端口添加入站防火墙规则。不要把这个 HTTP 端口直接暴露到公网。

三、修改端口或部署 HTTPS

运行前用记事本打开 config.cmd：

- NPI_HOST=0.0.0.0：允许局域网直接访问。
- NPI_HOST=127.0.0.1：只允许本机访问，适合放在 IIS/Nginx 反向代理后面。
- NPI_PORT=4173：服务监听端口。
- NPI_COOKIE_SECURE=0：直接 HTTP 模式。
- NPI_COOKIE_SECURE=1：HTTPS 反向代理模式。
- NPI_ALLOWED_ORIGINS：HTTPS 对外地址，例如 https://npi.example.com。

使用 IIS HTTPS 反向代理时，建议设置：

NPI_HOST=127.0.0.1
NPI_COOKIE_SECURE=1
NPI_ALLOWED_ORIGINS=https://实际访问域名

反向代理需要保留原始 Host，并传递 X-Forwarded-Proto=https。

四、数据备份与升级

1. 所有业务数据、账号、审计记录和报价单原始文件都在 data\npi-tracker.sqlite。
2. 数据库使用 WAL 模式，运行时还可能出现 -wal 和 -shm 文件。
3. 最稳妥的备份方式：先按 Ctrl+C 停止服务，再复制整个 data 文件夹。
4. 升级程序时，先备份 data 文件夹，再用新程序替换 app 和 runtime；不要覆盖原 data 文件夹。

五、管理员密码恢复

先停止 NPI Tracker，再双击 reset-admin-password.cmd。脚本会显示一次性临时密码，管理员下次登录后必须修改。

如果 start-npi.cmd 提示启动检查失败，请双击 diagnose-npi.cmd，并把 logs\diagnostic.log 和 logs\server.log 发给维护人员。诊断会检查内置 Node、程序文件、SQLite、数据目录写入权限和端口占用。

六、长期运行建议

直接双击适合首次部署和验证。正式长期运行时，建议由服务器管理员使用 NSSM、WinSW 或 Windows 任务计划程序托管 start-npi.cmd，并将输出写入受控日志目录。
