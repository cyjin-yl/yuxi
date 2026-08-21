---
title: Wrangler 部署中的 ECONNRESET 与代理配置陷阱
description: 在部署 Cloudflare Pages 时遇到大规模资产上传被重置 (ECONNRESET) 的问题。根因是代理服务器在处理高并发 HTTPS 连接时触发了重置，修复方案为通过 mihomo 优化路由策略。
date: 2026-07-25
tags: [cloudflare, wrangler, proxy, mihomo, deployment, networking]
draft: false
---

import NetEasePlay from '../../components/NetEasePlay.astro';

**时间锚点：2026-07-25 中午。**

执行 `npx wrangler pages deploy dist` 部署新版博客时，上传进度在 300/400 个文件左右突然中断，终端疯狂刷屏 `Error: connect ECONNRESET`。

---

## 事件：上传到一半的“断崖”

当时环境已经配置了 `HTTPS_PROXY=http://127.0.0.1:7890`，且 `wrangler` 明确提示已检测到代理并将其用于 fetch 请求。

但奇怪的是，小文件上传很快，一旦进入大批量资产（assets）并行上传阶段，连接就开始不稳定。尝试重启终端、重新运行命令，结果依然在同一个进度附近失败。

---

## 坑：并发连接与代理端的“耐受度”

通过观察发现，`wrangler` 在部署时会开启高并发的 HTTP 请求来加速资产上传。

我检查了本地运行的 mihomo (Clash) 代理日志，发现大量连接在极短时间内被创建并随后被服务器端（或代理端）强制重置。这通常是因为：
1. **并发数过高**：代理服务器或上游网关认为这是某种攻击行为，触发了连接限制。
2. **路由冲突**：某些请求被错误地路由到了不支持高并发长连接的节点。

最关键的发现是，如果完全不挂梯子，连接直接超时；挂了梯子，虽然能通，但在高并发下会被 reset。这说明问题出在“代理链路的并发处理能力”上。

---

## 修复：优化路由与重试机制

针对这个问题，采取了两步走策略：

**1. 路由细化 (Routing Optimization)**
在 mihomo 配置中，将 `DOMAIN-KEYWORD,netease,DIRECT` 和 `DOMAIN-SUFFIX,163.com,DIRECT` 等国内服务设为直连。虽然部署是发往 Cloudflare，但确保本地网络栈在处理各种并发请求时不会因为路由死循环或不必要的代理跳转而增加延迟。

**2. 利用 Wrangler 的断点续传 (Resumable Uploads)**
`wrangler` 的资产上传具有 `check-missing` 机制，即已经上传成功的文件在下次运行中会被跳过。

由于没有简单的 `--concurrency` 参数来限制上传并发数，最简单且有效的暴力方案就是：**写一个简单的 Shell 循环，失败后自动重试。**

```bash
while ! npx wrangler pages deploy dist --project-name yvxi; do
  echo "Upload failed, retrying in 5s..."
  sleep 5
done
```

每次重试都会在之前失败的基础上继续上传。经过 3 次重试，最终所有资产全部上传完毕，部署成功。

---

## 学到了什么

1. **并发不等于速度。** 在网络环境不稳定或通过代理访问时，极高的并发请求反而会增加被防火墙/代理服务器拦截的概率。

2. **利用工具的幂等性。** 很多现代部署工具（如 Wrangler, Terraform, Ansible）都设计了状态检查。当无法通过配置降低并发时，通过“重试循环”利用幂等性达成目标是最快捷的工程实践。

3. **代理不是万能的。** 当你看到 `ECONNRESET` 而非 `ETIMEDOUT` 时，说明 TCP 连接已经建立但被对方强制关闭。这时候检查代理的并发限制和路由规则比检查网络通断更有意义。

```mdx
🎵 Listening companion
<NetEasePlay id="3986241" kind="song" />
```
