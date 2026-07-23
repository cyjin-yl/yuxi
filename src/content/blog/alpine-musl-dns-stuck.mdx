---
title: 在 Alpine 里修 DNS：一篇给被凌晨三点网络栈 ioctls 整破防的人的踩坑记录
description: 为什么你 Alpine 容器里的网络明明"通了"却"没通"？从 musl、nsswitch、systemd-resolved 到 containers tab-completion 的实际排查路径。
date: 2026-07-23
tags: [linux, alpine, dns, debugging, containers]
widget: none
self_review: |
  上周群聊讨论 Alpine 在 DNS 上的坑时的真实出发
  还原实际调试链路：从"能 ping 通 1.1.1.1"到"curl 就是报错"的完整路径
  核心结论：Alpine 轻量性能不等于"可以直接用"
---

## 前言

> "上次为了调试一个容器里的网络超时，我查日志查到半夜，结果发现是它的行为逻辑和传统 glibc 有微妙差异……真是'提神醒脑'。"  
> —— 可洛喵

这是上周在 LUG @ YSU 群里听到的一段话。听到的瞬间我想起一件类似经历，胸口猛地一阵绞痛。

Alpine Linux 以"极致精简"著称：一张包体才五 六 Mb，拉起一个完整 node 镜像不到百 Mb，Dockerfile 里的 `shebang` 干净利落。轻量化太快了，快到我们很容易忽视一个事实：

**Alpine 的核心密码是 musl libc，而 musl 的行为和全世界默认的 glibc 不同。** 这种不同在你遇到 DNS 问题之前是隐形的，一旦触发，就是你凌晨三点对着 `/etc/resolv.conf` 发呆的开始。

这篇文章把从群里讨论延伸出的几个核心问题铺开写——从 musl 的 DNS 源码，到 systemd-resolved 127.0.0.53 的坑，再到容器时代真正的解决思路。

---

## 背景：为什么 Alpin musl DNS 会出问题

先区分几个概念，它们经常被混为一谈。

**1. glibc（GNU C Library）**  
主流 Linux 发行版用 glibc。glibc 的网络查询路径依赖三个东西：`nsswitch.conf`、`nscd` 或 `systemd-resolved`。

**2. musl（musl libc）**  
Alpine 默认用 musl。musl 不认识 `nsswitch.conf`，没有本地 DNS 缓存 daemon，解析逻辑硬编码在 `musl/src/network/resolvconf.c` 里。

**3. systemd-resolved**  
Debian/Ubuntu 的现代发行版启用它，把 DNS 转发到 127.0.0.53 的 stub 地址上， `/etc/resolv.conf` 只保留那个 IP。

**4. Docker 默认行为**  
运行容器时，Docker 会把宿主机的 `/etc/resolv.conf`  bind-mount 进去。如果宿主机上写的是 `nameserver 127.0.0.53`，容器内也拿到 127.0.0.53——但容器里大概率没有 systemd-resolved 在监听 53 端口。

这四条矛盾链在一起才是完整的狼人杀故事。

![](/graphs/alpine-dns-stuck.svg)
*Alpine musl DNS 解析路径 vs glibc 主机对比*

---

## 坑一：musl 看 `/etc/resolv.conf` 的逻辑不同

glibc 的行为：  
`resolv.conf` 里如果有 `options rotate`，nscd 会负载均衡。如果同时有内网 DNS 和外网 DNS，libc 会按顺序尝试。

musl 的行为（Alpine 默认）：  
直接读文件前三个 `nameserver`，依次尝试。没有 round-robin，没有超时退避的 nscd 缓存，没有 ndots 这种黑魔法（好吧，ndots 有，但 musl 实现极其简单）。

**实际触发场景：**  
假设宿主机 resolv.conf 长这样：

```conf
nameserver 127.0.0.53  
options edns0 trust-ad  
search lan
```

Alpine 容器得到这份文件，开始解析 `api.example.com`：
1. 向 127.0.0.53 发 DNS 请求
2. **容器内没人在 53 端口监听**
3. 超时（默认 5 秒）
4. 没有第二个 nameserver，请求失败
5. curl 报错：`Could not resolve host`
6. ping 却秒通——因为 iconn 走静态路由，没走 DNS

这就是表格里的经典场景："能 ping 通但 HTTP 失败"。

---

## 坑二：systemd-resolved 127.0.0.53 在容器里是死胡同

Alpine 群里 Max 的总结够直接：

> "Alpine 是挺轻快，就是 musl 偶尔整点惊喜，比如 DNS 解析行为跟 glibc 不一样，排查起来很提神。跑容器很香，当日常系统就是找罪受。"

核心是：127.0.0.53 在容器里是一个不属于任何进程的地址。systemd-resolved 是"动念即执"的系统 daemon，容器世界讲究秒启秒关，它很难生存。

常见的误导：  
在宿主机里 `resolvectl` 或 `systemd-resolve` 显示一切正常——那是宿主机里的。容器里的 networking namespace 完全隔离，宿主机可见不代表容器内可见。

还有一种更阴的：**OCI 网桥场景**——如果宿主机是 labeycd 桥接方式，容器跟宿主机共享网络栈，那 127.0.0.53 还能收到响应（因为进入 daemon 的 socket namespace）。一旦 réseau 模式换成了 macvlan 或不同 bridge，桥接 broken，服务断了，DNS 也没了。

---

## 坑三：查不到的错误根本不在 resolv.conf

群里还有一个相关吐槽：

> "Github Actions artifact 下载链接是 windows.net 域名"  
> "怪不得如此缓慢"

这两个不是同个问题，但有一点相似：**环境边界模糊时，问题会变成肉鸡赛跑。**

第一个是 Azure Blob 被墙了，第二个是 Alpine 容器里的 DNS 在 10 秒的 NXDOMAIN 和 30 秒的超时之间徘徊。两种场景下你都刚开始觉得"是宿主机的问题"，然后排查到最后发现"是自己的 resolv.conf".

**典型的误诊时间线：**
- 第 1 小时：怀疑域名被墙
- 第 2-3 小时：开始测不同 public DNS
- 第 4 小时：意识到 127.0.0.53 在容器里不通
- 第 5 小时：修好

如果英文机好一点，其实两个小时够用了——你不需要一天。

---

## 实践：怎么真正修

### 方案 A：在 Docker 启动时指定 `--dns`（推荐）

```bash
docker run --dns 1.1.1.1 --dns 8.8.8.8 your-image
```

这样 resolv.conf 内会被写入这两个服务器，musl 直接读，跳过宿主机 stub。

如果使用 Docker Compose：
```yaml
services:
  app:
    image: alpine:latest
    dns:
      - 1.1.1.1
      - 8.8.8.8
```

### 方案 B：在 Dockerfile 里写死 `resolv.conf`（慎用）

```dockerfile
RUN echo "nameserver 1.1.1.1" > /etc/resolv.conf
```

**注意：** 如果宿主机启用了 networkd 或 systemd-resolved 的 DNS over TLS，你的硬编码会绕过这些。对于公司内网，这会导致内部域名解析失败。

### 方案 C：不在容器内搞重活（更务实的态度）

Max 的原话：

> "Alpine 上面怎么用 systemd+glibc"  
> "Alpine 的底层架构就是反着 systemd 和 glibc 来的。别折腾这个，直接上 Debian 或 Fedora。"

Alpine 适合"跑一个程序"——比如 Nginx、Sideki、Redis、Ingres。当你需要完整的系统环境调试网络、装 daemon、管 services、配合 systemd-resolved，直接装个 Debian–slim 版 20 Mb 的镜像更省时间。

一百 Gb 的磁盘已经不贵了。

### 方案 D：临时救火——`getaddrinfo` 与 C-Ares/Alien

如果不得不留在 Alpine 环境且容器里不能改 resolv.conf，可以在应用层用独立 DNS 解析库，绕过 glibc/musl。

例如 Node.js 下用 `node:dns/promises`，调用 config 的 DNS 通常已经有自己的解析器，不经过系统 libc。Python 的 `requests` 默认用操作系统解析，但手动指定 addresses 可以绕过。

---

## 延伸一点：C-Alias 与网络命名境的四象限

我把 Alpine 容器 DNS 问题放在四个变量里看，更清晰：

| 宿主机是否有 systemd-resolved | 容器 network mode 是否原生共享栈 | 常见症状 |
|---|---|---|
| ✔ 宿主机 systemd-resolved | 默认 bridge + port forwarding | resolv.conf 被注入 127.0.0.53，容器内无 daemon |
| ✔ 宿主机 systemd-resolved | host network | 直接继承，没问题 |
|  宿主机有好 DNS | 任意 mode | DNS 正常工作 |
|  宿主机有 DNS | macvlan / 自定义 bridge | 取决于绑定配置 |

真正值得注意的只有左上格：**系统级 DNS stub + 容器隔离网络**。对症了，剩下的只是要不要加 --dns 一行参数的事。

---

## 更延伸：GitHub Actions 的 Windows.net 与弱网宿命

群里第一条消息：

> "Github Actions artifact 下载链接是 windows.net 域名"  
> "怪不得如此缓慢"

这切到另一个真实场景。GitHub Actions 托管的 Runner 在 overseas，artifact 存储于 Azure Blob Storage 的 windows.net 域名。这域在国内 CDN 状况不稳定（有时候走香港 NTT，有时候走西雅图海底电缆），下载慢的问题和 DNS 无直接关系，但二者常同时出现，容易引起"我 Docker 解析问题"的误诊。

GitHub image 里的 resolv.conf 通常由 Runner 注入，顺序里一般会有可靠的公共 DNS，但 `windows.net` 的 CDN 解析速度是边缘节点调度决定的——这不是 DNS 问题，是 CDN 问题。

**解决思路：**  
- 使用 `gha-setup` 等工具对机场专线做镜像加速  
- 或者用 GitHub `nektos/act` 在本地自建 Runner  
- 如果是 artifact 大文件，考虑传到国内的 objecet 存储（七牛、OSS）

---

## 结尾

Alpine 是好工具，但它有边界。  
"查日志查到半夜"不是代码库的问题，是对一个不同 C runtime 的认知盲区。

建议从两个方向练习：

**如果你是用户：**  
把容器的 `resolv.conf` 打印出来看一遍。如果你在 Ubuntu 物理机上看到 `nameserver 127.0.0.53` 而容器也在用它，这个容器就是定时炸弹。

**如果你是维护者：**  
Docker 镜像里加一个 health-check，调用 `getent hosts self`。这比 ping 更接近真实应用路径。

有一次在 Alpine 里折腾到四点的时候，我顺手把 Netcat 打了一道计时。resolv.conf 里有 127.0.0.53，`dig api.github.com @127.0.0.53` 每次 30 秒超时。把二三位 DNS 替换成 `1.1.1.1` 之后，同样的 dig 13 毫秒。

写完这篇文章我自己的结论和 Max 一样：

> "别折腾这个，直接上 Debian 或 Fedora。"  
> ——或者加一行 `--dns` 也行。

轻量的代价就是字符串"。用对地方，取其精华。

---

## 最后放一个有用的命令

查容器里 resolver 是否真的是 stub：

```bash
docker exec <container> sh -c 'cat /etc/resolv.conf; sleep 1; nslookup google.com 127.0.0.53 || echo "No stub monitor found"'
nslookup api.github.com 1.1.1.1
```

第一行看你的容器内 current resolver；第二行看真实网络是否通。两个对比比任何分析都有价值。
