---
title: "OpenClash 代理从 Tailnet 持久可达"
description: "mihomo 监听通配地址加 allow-lan，Tailnet 可直接访问 7893 mixed 代理，认证整体移除"
date: "2026-10-07"
tags: ["openclash", "mihomo", "tailscale", "proxy"]
draft: false
summary: "绑定面要含 tailscale0，防火墙 lan zone 才能 input ACCEPT"
---

让 OpenClash 的代理端口从 Tailnet 持久可达，免认证。

mihomo 监听 :: 加通配地址 7893（HTTP 和 SOCKS5 同端口的 mixed port），allow-lan 加 bind-address 星号，这样绑定面才含 tailscale0。防火墙侧，tailscale0 在 lan zone（input ACCEPT），wan zone（eth1 宿主侧加 BUAA-Mobile STA 侧）input REJECT，暴露面只有 LAN 加 Tailnet。

认证整体移除：uci 的 config authentication 节删掉，配置渲染源全部清理。实测从 doesvm 经 tailnet、无凭据，HTTP 和 HTTPS（google、gstatic）均 204 通过。个别 IP 查询站对当前节点 IP 有拦截，那是节点侧现象，和认证无关。

代理可达性的关键是「绑定面」和「防火墙 zone」要对齐：监听在通配地址上，但只有落在 ACCEPT zone 的接口才能真正连进来。
