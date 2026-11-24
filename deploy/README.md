# 余隙服务维护

`yvxi.cyjin.dev` 通过 Cloudflare 代理访问 OVH。Caddy 提供 Astro 静态页面，并将音乐与房间 API 转发到本机 Node 服务。后端使用 SQLite，网易云请求由服务端匿名访客会话处理。

## 路径

| 路径 | 用途 |
| --- | --- |
| `/srv/yuxi/releases/RELEASE_ID/site` | Astro 构建结果，root 所有，Caddy 可读。 |
| `/srv/yuxi/releases/RELEASE_ID/server` | Node 后端，root 所有，服务账户可读。 |
| `/srv/yuxi/current` | 指向当前完整发布目录。 |
| `/var/lib/yuxi/yuxi.sqlite` | 房间、队列、聊天与浏览器身份数据。 |
| `/var/lib/yuxi/audio` | 原有本地音频。 |
| `/etc/yuxi/backend.env` | 可选环境配置，root 所有，权限 `0600`。 |

服务以 `yuxi` 账户运行，状态目录权限为 `0700`，API 只监听 `127.0.0.1:8787`。Cloudflare 继续提供 DNS、HTTPS 代理和缓存。旧 Worker、KV、Durable Object 代码及部署配置已移除。

## 构建与发布

在独立工作区安装依赖、检查源码并构建：

```sh
npm ci
npx astro check
npm test
NODE_OPTIONS=--max-old-space-size=1024 UV_THREADPOOL_SIZE=2 npm run build
npm run check:site
```

图片保留源文件字节；构建期间关闭批量图片压缩，避免小内存环境中并行转换耗尽内存。

每次发布上传完整的 `site/`、`server/` 和 `deploy/`，并生成逐文件记录路径、字节数和 SHA256 的 `release-manifest.json`。清单覆盖发布目录的全部普通文件，仅排除清单自身；解包时只接纳普通文件和目录。后端只使用 Node 内置模块，服务器无需安装 Astro 或前端依赖。安装脚本先核对完整库存、文件内容和备份单元退役状态，再以服务账户运行临时数据库检查，最后停止旧进程、切换当前目录并启动新后端：

```sh
python3 /srv/yuxi/releases/RELEASE_ID/deploy/install-release.py \
  /srv/yuxi/releases/RELEASE_ID \
  --manifest-sha256 VERIFIED_MANIFEST_SHA256
```

发布目录使用 root 所有权；服务账户只能写入状态目录。打包时将仍在缓存期内的旧 `_astro/` 哈希资源合并到新 `site/_astro/`，并写入发布清单，以供已打开的页面继续访问。确认新站可用后清理旧发布目录与安装缓存。

当前数据库版本为 2。升级会移除旧网易云账号凭据及二维码登录表，保留房间、聊天、队列和浏览器身份。版本 1 的旧后端无法读取版本 2 数据；升级后只使用兼容版本 2 的代码。不要手动降低数据库版本号。

新进程启动前会移除已废弃的环境配置项，数据库升级确认成功后删除旧凭据密钥。若候选链接切换前失败，可恢复尚未迁移数据库的旧进程；新进程一旦开始启动，就保留新发布目录并修复兼容版本 2 的后端。安装脚本不对升级后的数据库运行版本 1 后端，也不复制正式数据库。

## 音乐

网易云匿名访客凭据仅保存在进程内存中，按有效期刷新。默认页面提供公开歌单、搜索、本地收藏和原有本地歌曲。上游限制访问或播放的歌曲会显示相应状态。浏览器无需登录网易云账号。

`/audio/FILE.m4a` 提供本地音频，`/netease/audio/ID` 提供正常可播放的网易云音频，两者均支持字节范围请求。发布后检查一个本地音频 Range 请求、公开歌单、搜索和房间同步。

## 日常检查

```sh
systemctl status yuxi-backend.service
journalctl -u yuxi-backend.service --since '1 hour ago'
curl --fail --silent --show-error https://yvxi.cyjin.dev/api/health
```

修改 Caddy 配置后先验证，再 reload。TLS 证书与私钥保留在现有受限目录，独立于发布目录。

自动备份已按站主要求关闭，原有博客备份及备份定时器已删除。发布流程不创建数据库副本，也不安装备份服务。
