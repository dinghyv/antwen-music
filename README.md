# antwen music

[MyGo Music](https://github.com/egoist/mygo-music) 的网页版：界面照原版复刻，MyGo 插件不用改就能装。部署在 `music.antwen.cn`，用主站 antwen 账号登录，只对白名单用户开放。

## 结构

```
apps/web          前端：React 19 + Vite + react-router + zustand + TanStack Query
apps/server       服务端：Node 22.13+ + Fastify 5 + node:sqlite（Node 自带，无需编译）+ undici
  src/plugins/    插件宿主：每个插件一个 worker 线程，每个用户一个 vm 上下文
packages/protocol 前后端共用的类型（对应原版 internal/music/music.go）
docs/reference-frames  原版各页面截图（由原版测试导出），复刻时对照用
```

生产环境只有一个 Node 进程：Fastify 同时提供 `/api` 和前端静态文件。数据（SQLite、已装插件、插件数据）都在 `DATA_DIR`。

## 本地调试

需要 Node 22.13+ 和 pnpm（`npm i -g pnpm`）。仓库里已有一份本地用的 `.env`：不登录、打开即管理员、只监听本机、不走国内代理。

三种启动方式，任选一种：

- **双击 `dev.cmd`**：没有 `.env` 会从 `.env.example` 复制一份；第一次会自动 `pnpm install`；然后启动服务端和前端，并打开浏览器。
- **命令行**：`pnpm install`，然后 `pnpm dev`。服务端在 :5175，前端在 :5173（`/api` 自动转发到服务端）。改代码会自动重载。
- **VS Code 断点调试**：把 `docs/vscode/launch.json` 复制到 `.vscode/launch.json`，按 F5 选「全部调试」。服务端、插件 worker 和前端都能打断点。

打开 http://localhost:5173 ，在「设置 → 插件 → +」里填 `AkinoKaede/mygo-music-netease-cloud-music` 安装网易云插件。在国内本地调试时，网易云直连就能用，不需要国内代理。

- 访问 GitHub 安装插件可以走本机代理：`.env` 里的 `GITHUB_PROXY_URL=http://127.0.0.1:7890`。代理连不上时会自动改为直连。
- 想在本地测试主站登录：把 `AUTH_MODE` 改成 `oidc` 并填好 OIDC 配置，再在主站给这个客户端加一个回调地址 `http://localhost:5173/api/auth/callback`。
- 数据都在 `data/` 目录，删掉它就能从头开始。
- 项目没有需要本地编译的依赖（数据库用 Node 自带的 `node:sqlite`），不用装 Visual Studio。`pnpm install` 下载慢时可以先 `set HTTPS_PROXY=http://127.0.0.1:7890`。

## 部署到中国大陆服务器

见 [docs/deploy-cn.md](docs/deploy-cn.md)（含主站登录接入、nginx、pm2、更新与备份）。

## 部署（海外服务器）

```bash
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env        # 按下面填好
pm2 start ecosystem.config.cjs
```

`.env` 要点：

- `PUBLIC_URL=https://music.antwen.cn`，`HOST=127.0.0.1`，由 nginx 反代。
- `AUTH_MODE=oidc`，`OIDC_ISSUER` 填主站地址（会读 `/.well-known/openid-configuration`）。
- 在主站后台注册一个 OAuth 客户端：回调地址 `https://music.antwen.cn/api/auth/callback`，scope `openid profile email`，把 client id / secret 填进 `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`。
- `ALLOWED_USERS`：允许使用的主站用户（sub、用户名或邮箱，逗号分隔）。`ADMIN_USERS`：能安装插件、设置出网方式的人。
- `CN_PROXY_URL`：国内服务器上的 HTTP 代理，见下。
- 可选 `GITHUB_TOKEN`：安装插件时调 GitHub API，避免限流。

nginx：

```nginx
server {
  server_name music.antwen.cn;
  listen 443 ssl http2;
  # ssl_certificate ...;
  client_max_body_size 20m;
  location / {
    proxy_pass http://127.0.0.1:5175;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;              # /api/events 是 SSE，/api/media 是音频流
    proxy_read_timeout 1h;
  }
}
```

## 国内代理（可选）

不配置也能运行：所有插件都直连。只有部署在海外服务器、又要用网易云这类国内音源时才需要。网易云按请求 IP 判断地区和风控（海外/机房 IP 拿播放地址会报 `-460`，很多歌变灰）。所以插件调接口的请求要从国内服务器出去；拿到播放地址后，音频由浏览器直接从网易 CDN 拉，不经过两台服务器。

在国内服务器上跑一个带密码的 HTTP 代理，比如 gost：

```bash
gost -L "http://user:pass@:8080"
```

建议用防火墙只放行海外服务器的 IP。然后在海外服务器的 `.env` 里填 `CN_PROXY_URL=http://user:pass@国内IP:8080`，在「设置 → 插件 → 网易云音乐 → 出网方式」选「经国内代理」，再点「测试代理」确认。Spotify 这类插件保持「直连」。

## 插件兼容性

插件格式与 MyGo Music 完全一致（`plugin.json` + 一个 JS/TS 文件，导出 `search`、`stream` 等函数），网页版对外声明兼容 MyGo `0.1.22`。宿主 API 的差异：

| API | 网页版 |
| --- | --- |
| `storage` / `setting` / `t` / `language` / `crypto` / `dir` / `dataDir` / `removeDataDir` | 完全兼容，按用户隔离 |
| `fetch` + `network` 权限 | 兼容，重定向也逐跳校验域名；`*` 不能访问内网地址；可走国内代理 |
| `signInPrompt` | 兼容，二维码推到浏览器显示 |
| `openURL` | 在浏览器新标签页打开 |
| `requestHeaders` | 兼容，需要请求头的图片和音频改由服务器转发 |
| `waitForRedirect` | 登录后把跳转失败的回调地址粘贴回来 |
| `webSignIn` | 在官网登录后把 Cookie 粘贴回来 |
| `spawn` | 不支持 |
| `playback: "remote"` | 兼容，调用 `remote*` 并轮询 `remoteState` |

## 许可证

AGPL-3.0-or-later，与 MyGo Music 相同。界面、图标、文案、歌词解析移植自 MyGo Music（© egoist）。
