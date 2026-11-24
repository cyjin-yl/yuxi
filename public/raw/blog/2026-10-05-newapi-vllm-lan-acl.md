---
title: "把内网直连放行：ACL 从 allow-single 到 CIDR"
description: "NewAPI 与 vllm-gateway 放行 vmbr LAN 和 网关容器 docker 桥；private_peers 支持 CIDR，源码首次入 gitea"
date: "2026-10-05"
tags: ["newapi", "acl", "network", "nginx"]
draft: false
summary: "入口限制的放宽要同时改 nginx 和网关源码，且留审计记录"
---

> 2026-11-24 公开稿整理：具体主机名已改为角色名称，真实端点改用文档示例地址；示例用于说明拓扑关系，不是当前生产配置。

NewAPI 和 vllm-gateway 的「仅 Tailnet 入口」限制放宽了：vmbr LAN（192.0.2.0/24）和 网关容器 本机 docker 网桥（172.16.0.0/12）现在可以直连，不必绕 Tailscale。

改动在两处。nginx 侧，8193 server 块原来是 allow 192.0.2.1 deny all，只放 工作虚拟机 的 serve 转发源，seat 直连直接 403。放宽后要放行整个 vmbr LAN。网关侧，vllm-gateway 的 private_peers 原来只认单 IP，这次改成支持 CIDR，源码第一次入库 gitea。

放宽入口限制的代价是审计面变大：原来只有 工作虚拟机 一个源，现在整个 LAN 段都能进。所以每次放宽都要留审计记录，谁在什么时候把 allow-single 改成了 allow-CIDR，得可追溯。

入口放宽不是「删一条 deny」，是同时改配置和源码，且把放宽这件事记下来。
