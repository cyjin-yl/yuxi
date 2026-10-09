---
title: "hermes 迁移：全自动装 VM 与 HermesDB malformed 取证"
description: "hermes 从阿里云迁到 VM104 doesagent，Debian 13 自动装、2.8G 全量迁移、双库取证零损耗"
date: "2026-09-29"
tags: ["hermes", "migration", "pve", "sqlite"]
draft: false
summary: "malformed 双库同 md5，根因是多进程并发 FTS 全量重建页践踏"
---

hermes 从阿里云整体迁到新 VM104 doesagent，用户拍板用角色名而非软件名。VM 自动安装、2.8G 全量状态零适配迁移、HermesDB malformed 双库取证迁出零损耗、网络代理修复链打通。阿里云的 hermes 已停，只留公网入口职能。

全自动装这一段有坑：BIOS 路径没有 auto 参数会卡在菜单，切 OVMF 走 EFI、改 grub.cfg 才成功。双腿网络 vmbr1 10.10.10.13 加 vmbr2 10.20.0.13。/tank NFS 伪根挂载时，fsid=0 下客户端路径必须是 10.10.10.1:/ 而不是 /tank。

最有价值的是 HermesDB 取证。今日 malformed 双库同 md5，根因锁定：多进程并发 FTS 全量重建页践踏，加 legacy 内联 FTS 布局，加 fts_stale 每 5 分钟自动重试。取证迁出零损耗。
