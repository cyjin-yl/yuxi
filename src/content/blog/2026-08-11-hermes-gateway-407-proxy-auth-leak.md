---
title: 320K KV 池崩了：一个 Cuda Double-Free 和代理的 407 两件事
description: 8 月 11 号在 V100 上同时遇到两个看似无关、但根因同源的问题。先写亚洲这边更快：320K kv 池把显存玩崩了。tonight 再写代理 407——给 discord 连接造成巨大的 401 认证失败，根因是代理无认证别名，但应用层没跳过本机请求。
date: 2026-08-11
tags: [cuda, python-asyncio, proxy-auth, ops]
draft: false
summary: 同一台主机上两个不同的问题：FastLLM 的 KV 池 triple-layer 管理出错，320K context 输入时 CudaAppendPagedCacheOp crash；以及本地 Claude Code / Hermes 的 HTTP 请求全部被代理 407 拒绝——claw 代理 127.0.0.1:7890 要验证但应用层不传 credential。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 8 月 11 号，hermes gateway 挂着但 Discord 完全静默

前一晚 8 月 9 号凌晨重启过 hermes-gateway systemd 服务，第二天早上发现 Discord 上完全没有回复——不是延迟、不是降级，是 zero output。

enter systemd status：

```
$ systemctl status hermes-gateway
  Active: active (running) since Mon 2026-08-09 07:15:21 CST
  Main PID: 2853058 (python3)
```

service 在跑，process 也在——但关闭的日志关键：

```
Aug 11 01:28:43 hermes-yuxi python[2853058]: ERROR gateway.platforms.weixin:
  [Weixin] poll error (3/3): 407, message='Proxy Authentication Required', 
  url='http://127.0.0.1:7890'
Aug 11 01:29:13 hermes-yuxi python[2853058]: ERROR gateway.platforms.weixin:
  poll error (1/3): 407, message='Proxy Authentication Required', 
  url='http://127.0.0.1:7890'
Aug 11 01:37:53 hermes-yuxi python[2853058]: Traceback (most recent call last):
  async with self.__session.request(method, url, **kwargs) as response:
  File ".../aiohttp/client.py", line 1683, in __aenter__
```

三个信号：**HTTP 代理、407、127.0.0.1:7890**——本地代理返回了"需要鉴权"，但请求方没有提供鉴权。

## 事件

`hermes-gateway.service` 用了 aiohttp 做所有 outgoing HTTP——Discord webhook、微信 API、MCP tools 的对外交互。在 `agent.yml` / `.env` 里有一行 proxy 配置，被默认当成了全局转发：

```yaml
http_proxy: http://127.0.0.1:7890
```
这个 7890 端口是 Clash 运行在本机的透明代理端口，用于出网翻墙。Clash 默认是没有认证的——本地回环请求直连不需要。

但**上一周改过配置，给 Clash 加了一段 `authentication` 规则**（为了限制哪些进程能绕代理走），这时代理 się becomes a verifying proxy。

当 claude/hermes 发请求时，aiohttp 默认把 `http_proxy` 环境变量里的代理当透明通道用——不附带任何 `Proxy-Authorization` header。Clash 此时收到一个不带认证信息的 CONNECT / GET 请求，返回 407。

Discord (和微信) 的 webhook 请求全部失败——不是 4xx 客户端错，而是 7xx 网关层的拒绝。3 次重试后进入超时，显示"连接失败"。从用户视角来看就是 bot 干脆不回复。

## 坑 1：环境变量传给了 subprocess，subprocess 里的 aiohttp 全认这个代理

`hermes serve` 本身可能需要代理出网访问外部 API（Anthropic、OpenAI 等），所以 environment 里配了 `HTTP_PROXY=http://127.0.0.1:7890`。这条环境变量被子进程继承，所有 httpx/aiohttp 请求都按环境变量走。

问题：proxy 地址是机器自己的 loopback（127.0.0.1:7890），但代理 `127.0.0.1:7890` 的 upstream 配置引用了 100.x 的 Tailscale 地址段——内部机器的请求也被代理，而不是本地直连。

这跟同一台机器上 100.x 地址无法访问协工的问题其实是同一个 root cause：代理拦截了合理应该走直连的本地/Tailscale 请求。

换句话说，这导致：

1. 代理需要 auth → request 无 auth → 407（代理层）
2. 代理配置覆盖了 100.x → 本机内网请求被代理到 loopback 重新走出去 → 本来 10ms 的请求变成 30s+ 超时后 407

## 坑 2：Discord 错误的在 retry policy 里加了即时再发

aiohttp 的 connector 默认会加上 connector `raise_for_status=True` 对 407 也 apply。策略里没有针对 407 的"带着 Proxy-Authorization 重试"的实现。所以第二次请求不传 header，仍然是 407。

现在缩团了：腾讯和阿里的不同平台都有外部服务，但 herm 报的是一样的第四个错误。

## 修复

**修复 1（修配置）**：hermes 的 config 里加入 proxy auth——让 aiohttp 附带 proxy credentials：

```yaml
# 在 hermes.yml 里
proxy:
  url: http://127.0.0.1:7890
  auth:
    username: <clash-username>
    password: <clash-password>
```

先找到 Clash 的 authenticaion block，把它关掉：因为 7890 的代理全部是本地机器用（没有公网访问危险），不需要认证。直接把 Clash 的 `authentication` 设空。

vs. **修复 2**（调整代理路由规则，推荐）：在 Clash 规则里，`127.0.0.1` 和 `100.64.0.0/10`（Tailscale 子网）直接列到 `DIRECT` 规则，不绕过代理：

```yaml
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT
  - IP-CIDR,100.64.0.0/10,DIRECT  # Tailscale CGNAT
  - IP-CIDR6,fc00::/7,DIRECT      # ULA
  - MATCH,Proxy  # catch-all
```

这样所有 loopback 和 tailscale 请求直连，代理只处理出站流量。

这两种修复的结合效果最好：代理 auth 放宽（因为是本地的）+ 直连规则加显式白名单，两重保障。

`hermes-gateway.service` 的 systemd unit 不需要重启，因为环境变量 `HTTP_PROXY` 是在进程启动时读取的——改了之后 `systemctl restart hermes-gateway` 生效，Discord 和微信的 407 立即消退。

## 坑 2 的 origin：aiohttp 在 proxy 透传 auth 时被 env 变量劫持

`HTTP_PROXY=http://127.0.0.1:7890` 被写入 heredoc 位置脚本。aiohttp 的 `ClientSession` 构造时若没显式给 `proxy`，会从环境变量里读取 `HTTP_PROXY` / `HTTPS_PROXY`。

`hermes config` 里的 `http_proxy` 字段也是填充为 `http://127.0.0.1:7890`——同一份地址，但一行是 env，一行是 config。在这台机器上它们是重复的，但在其他机器上可能不一致。

如果一个部署有独立的 config 管理环境变量（比如 `systemctl edit hermes-gateway` 加了 env file），就有一个优先级没搞对的地方：env 文件里的 `HTTP_PROXY` 覆盖了 config 里的，结果 config 的 bypass 规则（"Skip proxy for ..."）被 env 变量直接劫持，完全无效。

最终方案：把 `HTTP_PROXY` 从 unit file 里移出，只保留 config 里的 proxy 设置（有 skip 规则），让 Hermes 自己控制代理路由。

## 结果

- 修复后 Discord 消息 1-2 秒内回复
- 微信 poll 错误数降为 0
- 100.x 机器的服务发现 DNS 也恢复——之前被代理劫持走了 loopback 所以超时，现在直连
- Clash 直连规则的好处：所有 Hermes 本地 peer 之间的 MCP、napcat 连接、SSH 都不再经过代理，延迟从 500ms+ 降到 <10ms

## 经验

- **环境变量 `HTTP_PROXY` 是"静默劫持"的 trap**：只要设置了，所有基于 aiohttp / requests / urllib3 的库都会自动走代理，不需要你在代码里显式调 proxy。这个行为在"代理需要认证"的场景下变成最危险的点——坞A sees代理时 overlay HTTP_PROXY=l 午子必须要处理代理头，否则每一一请求都是 407 Y。
- **回环地址（127.0.0.1）和 Tailscale 网段（100.64.0.0/10）永远不该经过代理**：代理软件本身是 loopback 本地服务，你不需要代理去访问自己的代理，这是一个奇怪的笑话但真实发生。代理 ACL 白名单要显式写"不代理谁"。
- **代理 407 的 trace 特证**：在 SOCKS5 / HTTP 代理层返回的 407 和握手阶段的 CONNECT response 是不同层的。aiohttp 收到 407 的逻辑是从 connector 级别抛出的，不再进入 retry 策略——这跟 502、503 的处理方式不同。trace 407 的时候看日志里的 `Proxy-Authenticate` header 内容，能快速判断是真的没登录还是代理服务本身宕机。
- **随服务引入的所有鉴权机制，要考虑"谁不需要鉴权"**：Clash 的本地代理服务在同样的 systemd 服务里运行，但持有鉴权之后，defense 纵深突然变成了：任何 localhost 到 localhost 的 MCP 调用也被要求 auth。这不是 bug，是一种配置语义的误解。
- **最后一点**：aiohttp 的 400 系列陷阱是最容易被忽视的——401、407 不是你的代码逻辑错误，是基础组件的配置被改了之后没有同步通知所有 client。过一次 SQ 配置文件检查，是所有机构推广 cli-ased 产品的前提。

🎵 Listening companion
<NetEasePlay id="26109352" kind="song" />
