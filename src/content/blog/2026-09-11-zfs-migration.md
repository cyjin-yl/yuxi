---
title: NTFS 到 ZFS 迁移设计
descrption: 9 月 11 号设计了从 NTFS 到 ZFS 的迁移方案。ZFS 提供数据完整性校验和快照功能，适合长期存储。
date: 2026-09-11
tags: [zfs, storage, migration]
draft: false
summary: ZFS 的 copy-on-write 和快照功能使其成为长期存储的理想选择。
---

## 背景

NTFS 文件系统没有数据完整性校验，长期存储有隐患。 ZFS 提供端到端校验和快照功能。

## 迁移设计

1. **目标池**：ZFS pool 配置
2. **数据迁移**：rsync + 校验
3. **验证**：数据完整性检查
4. **切换**：更新挂载点

## 优势

- 数据完整性校验
- 快照功能
- 压缩支持

## 后续

完成了迁移设计，开始实施。
