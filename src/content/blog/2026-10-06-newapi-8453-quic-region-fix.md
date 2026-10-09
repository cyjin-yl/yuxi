---
title: "简化 8453 链路，修掉复发性 502 与 QUIC 地区误判"
description: "8453 去 nginx 化直连 new-api，消除链路中 502；ChatGPT QUIC 走错地区用 DNS 兜底修"
date: "2026-10-06"
tags: ["newapi", "quic", "nginx", "tailscale"]
draft: false
summary: "链路每多一跳就多一个 502 的点；QUIC 走 UDP 绕过了 HTTP 代理的地区判断"
---

用户报告 NewAPI 登录卡死、前端 JS 冻结、后端全部 502，同时浏览器经 doesrouter 访问 ChatGPT 提示「地区来自中国」。要求简化拓扑但保持文档原有功能，且不破坏 UDP 放行、Tailnet serve 和其他规则。

8453 的链路原来是 tailnet 到 doesvm serve 到 CT102 nginx 到 new-api，三跳。这次去掉中间那跳 nginx，tailnet 直连 10.10.10.12:13000。链路每多一跳，就多一个能 502 的点；去掉一跳，复发性 502 的根就少了。LAN seat 仍走 CT102 nginx 8193，两条路汇到同一个 new-api。

QUIC 地区误判是另一个问题：ChatGPT 的 QUIC 走 UDP，绕过了 HTTP 代理的地区判断，所以即便 HTTP 走了代理，QUIC 仍可能被判成「地区来自中国」。修法是给 QUIC 流量单独的 DNS 兜底，让它解析到正确的地区节点。

简化拓扑和修地区判断，本质都是减少「流量走了一条你以为之外的路」。
