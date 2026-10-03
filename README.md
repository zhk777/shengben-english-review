# 30天专升本英语复习

## 本地运行

```bash
npm install
npm run dev
```

不配置 `VITE_API_BASE_URL` 时，账号和学习记录只保存在当前浏览器的 `localStorage`，适合离线测试。开发服务器固定使用 `http://127.0.0.1:5173`；更换域名、端口或清理站点数据前，请先在“学习报告”导出备份。

生产构建：

```bash
npm run build
```

## 正式账号模式

项目的 `server/` 提供服务器端注册、登录、退出和会话校验。配置 `VITE_API_BASE_URL` 后，前端会自动切换到服务器账号模式：

1. 创建 PostgreSQL 数据库和专用用户；
2. 复制 `server/.env.example` 为 `server/.env`，填写 `DATABASE_URL`、`ALLOWED_ORIGINS`、`SESSION_DAYS` 等变量；
3. 前端构建环境填写 `VITE_API_BASE_URL=https://api.your-domain.example`，重新执行 `npm run build`；
4. `npm start` 首次启动会自动创建 `users`、`sessions`、`study_states` 表；
5. 密码只以 bcrypt 哈希保存，浏览器只持有 HttpOnly 会话 Cookie；`/api/state` 始终按会话用户读写，不能依赖设备标识跨用户访问。有效会话会在页面重新打开或回到前台时续期。

本地前后端联调时，将 `ALLOWED_ORIGINS` 临时设为 `http://127.0.0.1:5173`；生产环境只填写真实前端域名，禁止留空或使用通配符。

## 移动端兼容性

- 网页自带发音使用浏览器的系统英语语音，代码会优先选择英语系统音色，并在浏览器未启动或拒绝播放时提示原因。部分安卓 WebView、内置浏览器不提供稳定的网页语音能力；若需要所有设备播放同一套标准音频，应在服务端接入 TTS，并通过 HTML `<audio>` 播放缓存后的 MP3/WAV。
- 正式账号的 Cookie 已设置有效期并会在重新回到页面时续期。若安卓浏览器短时间退到后台仍频繁要求登录，通常是浏览器清理了 HTTP/IP 站点的 Cookie。上线时应使用域名和 HTTPS，设置 `COOKIE_SECURE=true`、`COOKIE_SAME_SITE=lax`，并避免在内置浏览器或“退出即清理数据”模式中使用。

认证接口：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

学习状态接口：`GET/PUT/DELETE /api/state`。登录和注册接口带请求频率限制，服务端还会检查账号格式、请求体大小、CORS 来源，并输出 JSON 访问日志。

未配置 `DATABASE_URL` 时，后端仍保留旧的设备/文件兼容模式，方便本地联调；此模式不适合多人生产环境。

## 千问与每日内容

服务端会在每天 `08:00 Asia/Shanghai` 尝试生成翻译题和语法巩固题。`DASHSCOPE_API_KEY`、模型名和网关地址只能放在服务器环境变量，不能写入前端或 `VITE_*` 文件；生成失败时前端继续使用本地备用题。

## 服务器上线清单

- 使用 `server/nginx.example.conf` 配置域名、HTTPS 和反向代理，Node.js 仅监听内网端口；
- 使用 `npm run start:prod` 通过 PM2 自动重启，并保留 `server/logs/` 访问与错误日志；
- 服务器安装 PostgreSQL 客户端后，在 `server/` 执行 `npm run backup:db`，备份写入 `BACKUP_DIR`，再由系统计划任务复制到异地或另一块持久化磁盘；恢复时使用 PostgreSQL 的 `pg_restore` 流程；
- 生产环境所有数据库密码、Cookie 会话配置和 API Key 都放在服务器环境变量，不要提交 `.env`；
- 上线前补充隐私政策、数据保存期限、账号注销和数据删除流程。

健康检查：访问 `/health` 应返回 `ok: true`，并显示 `databaseConfigured`、`databaseReady`、存储类型和认证模式。前端仍保留导出、恢复和清除学习数据功能。
