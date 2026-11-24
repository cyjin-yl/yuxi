---
title: PVE 虚拟机盘点：从混乱到有序
descrption: 8 月 14 号开始整理 PVE 上的虚拟机，发现很多遗留的 VM 和 CT 占着资源。做了一次全面盘点，记录了每个 VM/CT 的用途、资源分配和状态。
date: 2026-08-14
tags: [pve, virtualization, ops]
draft: false
summary: 虚拟化平台运行久了容易积累"僵尸" VM。定期盘点是保持资源利用率的关键。
---

## 背景

PVE 集群跑了几个月，VM 和 CT 越来越多，有些已经忘了是干什么的。资源分配也不合理，有的 VM 占着 16G 内存但实际只用 2G，有的 CT 只给了 512M 但经常 OOM。

## 盘点方法

1. **列出所有 VM/CT**：`qm list` 和 `pct list`
2. **检查资源分配**：`qm config <vmid>` 和 `pct config <ctid>`
3. **检查实际使用**：`qm status <vmid>` 看 CPU/内存使用
4. **记录用途**：在 README 里维护一个 inventory 表

## 发现的问题

- 3 个 VM 已经停了几个月，但配置还在
- 2 个 CT 内存分配不足，频繁 OOM
- 1 个 VM 磁盘空间快满了，需要清理

## 后续

清理了不必要的 VM/CT，调整了资源分配。现在 PVE 集群的资源利用率提高了约 30%。
