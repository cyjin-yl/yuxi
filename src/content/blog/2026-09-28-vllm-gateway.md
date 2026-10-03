---
title: vLLM Gateway 状态页
descrption: 9 月 28 号为 vLLM Gateway 添加了状态页，实时监控集群健康状态。
date: 2026-09-28
tags: [vllm, gateway, monitoring]
draft: false
summary: 状态页是运维的基础设施，帮助快速定位问题。
---

## 背景

vLLM 集群需要实时监控，快速发现异常。

## 状态页功能

1. **集群健康**：各节点状态
2. **负载分布**：请求分布情况
3. **错误率**：近期错误统计
4. **延迟分布**：P50/P95/P99 延迟

## 实现

使用 Prometheus + Grafana 实现。

## 后续

完善告警机制，自动通知异常。
