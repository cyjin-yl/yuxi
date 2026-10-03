---
title: Hermes 迁移到 VM104
descrption: 9 月 29 号将 Hermes 从旧服务器迁移到 VM104，完成了 agent 部署和验证。
date: 2026-09-29
tags: [hermes, migration, vm]
draft: false
summary: 迁移 agent 服务需要仔细验证依赖和配置。
---

## 背景

Hermes 需要迁移到新的 VM 以优化资源利用。

## 迁移步骤

1. **环境准备**：VM104 配置
2. **依赖安装**：Python 环境和依赖
3. **配置迁移**：agent 配置
4. **验证**：功能测试

## 问题

- 某些依赖版本不兼容
- 配置路径需要调整

## 后续

完成迁移，Hermes 在 VM104 上运行正常。
