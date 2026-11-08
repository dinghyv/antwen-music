# 部署到中国大陆服务器（music.antwen.cn）

部署方式：**一个 Node 进程（pm2 托管）+ nginx 反代 HTTPS**。Node 同时提供接口和前端页面，数据全在项目的 `data/` 目录（SQLite + 插件），不依赖 MySQL / Redis。

```
浏览器 ──HTTPS──► nginx :443 ──► 127.0.0.1:5175  antwen music（pm2）
                                     │
                                     ├─ 登录：服务器 → https://www.antwen.cn（主站 OIDC）
                                     └─ 插件：服务器 → music.163.com 等（大陆服务器直连网易云）
```

## 0. 部署前确认

- **备案**：大陆服务器用域名对外提供网页，`antwen.cn` 需要在**这台服务器的云厂商**有 ICP 备案（主域已备案的话，子域名 `music` 不用另备）。没备案时 80/443 会被云厂商拦截。
- **DNS**：`music.antwen.cn` 加一条 A 记录指向服务器 IP。
- **HTTPS 证书**：云厂商的免费证书，或 acme.sh。主站登录要求回调地址必须是 `https`。
- **服务器能访问主站**：在服务器上执行下面这条，能看到 JSON 就行：

  ```bash
  curl -s https://www.antwen.cn/.well-known/openid-configuration | head -c 300
  ```

## 1. 在主站注册登录应用（GTA 数据库）

1. 用你的账号登录 www.antwen.cn，进入「开放平台 → OAuth 应用」（`/oauth-apps`），创建应用：
   - 名称：例如「MyGo 音乐」（规则：不能包含站名或「官方」）
   - 类型：**confidential**（有密钥）
   - 回调地址（逐字一致，可以填两条）：
     ```
     https://music.antwen.cn/api/auth/callback
     http://localhost:5173/api/auth/callback      ← 可选，本地调试主站登录用
     ```
   - scope：`openid profile email`
2. 复制 **Client ID** 和 **Client Secret**（Secret 只显示一次）。
3. （可选）让应用变成「可信」：自助创建的应用是不可信的，授权页会显示「未验证应用」，也拿不到 `is_admin`。如果后台 `/admin/content/oauth-clients` 能把它标成可信，就标上；这样**主站管理员会自动成为音乐站管理员**。不标也没关系，用 `.env` 的 `ADMIN_USERS` 指定管理员即可。

音乐站拿到的身份字段：`sub`（主站用户 ID）、`preferred_username`（用户名）、`email`，可信应用还有 `is_admin`。白名单按这三者之一匹配。

## 2. 服务器环境（以 Ubuntu / Debian 为例）

```bash
# Node 22.13+（用国内镜像装 nvm 里的 Node）
export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
nvm install 22 && nvm alias default 22
node -v                      # 确认 ≥ v22.13

# pnpm、pm2，并把 npm 源换成国内镜像
npm config set registry https://registry.npmmirror.com
npm i -g pnpm pm2
pnpm config set registry https://registry.npmmirror.com

# nginx
sudo apt install -y nginx
```

项目没有需要编译的依赖，不用装 build-essential / Python。

## 3. 放代码

推荐把项目推到 GitHub（AGPL 开源，`.env` 和 `data/` 已在 `.gitignore`，不会上传），服务器上 clone：

```bash
sudo mkdir -p /srv && sudo chown $USER /srv && cd /srv
git clone https://github.com/<你>/antwen-music.git
cd antwen-music
```

服务器访问 GitHub 慢的话，也可以在本地把项目（不含 `node_modules`、`data`、`dist`）打成 zip，用 scp 传上去解压。

## 4. 配置 `.env`

```bash
cp .env.example .env && nano .env
```

```ini
PORT=5175
HOST=127.0.0.1
PUBLIC_URL=https://music.antwen.cn
DATA_DIR=./data

AUTH_MODE=oidc
OIDC_ISSUER=https://www.antwen.cn          # 必须和主站 OAUTH_ISSUER 逐字一致，结尾不带 /
OIDC_CLIENT_ID=<第 1 步的 Client ID>
OIDC_CLIENT_SECRET=<第 1 步的 Client Secret>
OIDC_SCOPES=openid profile email
ALLOWED_USERS=<允许使用的主站用户名，逗号分隔；* 表示所有主站用户>
ADMIN_USERS=<你的主站用户名>
# OIDC_SITE_ADMINS=0                       # 不想让主站管理员自动成为这里的管理员时打开

# 大陆服务器：网易云直连，不需要国内代理
CN_PROXY_URL=
# 想用 Spotify：填一个海外 HTTP 代理（比如在海外服务器上跑 gost），把 Spotify 插件设成「经海外代理」
GLOBAL_PROXY_URL=
# 安装插件要访问 GitHub：服务器连不上时填个代理，或者在设置里「上传 zip」安装
GITHUB_PROXY_URL=
GITHUB_TOKEN=

DEFAULT_PLUGINS=AkinoKaede/mygo-music-netease-cloud-music
```

`.env` 里有密钥，设成只有自己能读：`chmod 600 .env`。

## 5. 构建并启动

```bash
pnpm install --frozen-lockfile
pnpm build
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup          # 按提示执行它打印的那条 sudo 命令，开机自启
pm2 logs antwen-music --lines 30 # 看到 “antwen music on 127.0.0.1:5175 · … · auth oidc” 就对了
```

本机自查：`curl -s 127.0.0.1:5175/api/auth/status` 应返回 `{"signedIn":false,"authMode":"oidc"}`。

## 6. nginx

```bash
sudo cp deploy/nginx-music.antwen.cn.conf /etc/nginx/conf.d/music.antwen.cn.conf
# 改里面的证书路径
sudo nginx -t && sudo systemctl reload nginx
```

云厂商安全组只放行 80 / 443，5175 不要对外开放。

## 7. 上线后检查

1. 打开 https://music.antwen.cn → 跳到主站授权页 → 同意 → 回到音乐站首页。
2. 左下角齿轮 → 插件：网易云已自动安装（服务器连不上 GitHub 时，点「+」→「上传 zip」，zip 从插件仓库的 Releases 下载）。
3. 网易云 → 「测试网络」：应显示出口 IP 在中国大陆。
4. 扫码登录网易云，播放一首歌。如果报 -460（网易风控），说明这台机房 IP 被网易限制了，换台服务器或等风控解除；这不是部署的问题。
5. 主站导航加入口：在 gta-db-next 的导航里加一个「音乐」链接到 https://music.antwen.cn（只给白名单用户显示）。

## 更新

```bash
cd /srv/antwen-music && bash deploy/update.sh
```

## 备份

只需要备份 `data/` 和 `.env`。`data/antwen-music.db` 正在运行时直接拷贝可能不完整，用：

```bash
sqlite3 data/antwen-music.db ".backup data-backup.db"   # 或先 pm2 stop 再拷整个 data/
```

## 排障

| 现象 | 处理 |
| --- | --- |
| 进程启动就退出，日志说 `AUTH_MODE=oidc needs OIDC_ISSUER…` | `.env` 没填全 |
| 主站授权页报 `redirect_uri` 不匹配 | 主站应用里的回调地址和 `PUBLIC_URL` + `/api/auth/callback` 不一致（注意 https、末尾斜杠） |
| 回到音乐站显示「换取令牌失败」 | Client Secret 错了，或服务器连不上 www.antwen.cn |
| 「账号 xxx 没有使用权限」 | 把用户名加进 `ALLOWED_USERS`，`pm2 restart antwen-music` |
| 二维码一直不出来 | nginx 没关 `proxy_buffering`，SSE 被缓冲了 |
| 登录后又被要求登录（反复跳转） | 用 http 或 IP 访问了：`PUBLIC_URL` 是 https 时登录 Cookie 只在 https://music.antwen.cn 下有效 |
