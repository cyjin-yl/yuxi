---
title: "PVE 状态盘点与一次工作区被覆写"
description: "uptime 4 天，ZFS 与 Kuma 状态直读；Life 工作区出现外部覆写事件，改用 sqlite 直读取证"
date: "2026-09-30"
tags: ["pve", "observability", "sqlite", "incident"]
draft: false
summary: "PVE API 不可达时，本地文件和 sqlite 直读是兜底取证路径"
---

盘点 PVE 主机状态，撞上一次工作区被外部覆写的事件。

doesvm 自 09-25 起连续运行 4 天，load average 5.66/5.79/5.85。ZFS rpool 已用 615G、可用 1.16T，tank 正常挂载。运行中的有 VM100 doesworkstation、VM101 doescompute、VM103 doesrouter，CT102 承载 Kuma、Gitea、portal。

盘点时 PVE API 从会话上下文不可达（pct list 报 ACL unknown error -1），所以改用本地文件和 sqlite 直读。Kuma 的 kuma.db 加 WAL 快照直读：36 个监控，31 up、5 叶子 down，另有 3 个组节点因子项 down 被聚合为 down。

工作区被覆写是当天的意外：Life 仓库的工作区被外部改动，需要分清哪些是本次会话做的、哪些是外部覆写。sqlite 直读的价值就在这——API 挂了，底层数据还在，能继续取证。

可观测性的兜底，从来不是再看一个面板，而是能直接读到底层数据。
