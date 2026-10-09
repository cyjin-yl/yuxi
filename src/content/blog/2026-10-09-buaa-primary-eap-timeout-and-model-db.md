---
title: "BUAA 主力切换、EAP 超时诊断与模型库对账"
description: "EAP 60s 超时区分校园 RADIUS 无响应与本机凭据故障；BUAA 升主力、F50 降为直连下载代理；NewAPI 模型库与网关对账"
date: "2026-10-09"
tags: ["buaa", "eap", "network", "newapi"]
draft: false
summary: "掉线要区分是校园端没响应还是本机凭据错，处置完全不同"
---

今天几件事：EAP 超时诊断、BUAA 主力切换、NewAPI 模型库对账、vllm-gateway KV slot 准入。

EAP 掉线的诊断，关键是分清两种 Reason。60 秒 EAP 超时、Reason 6，是校园 RADIUS 无响应——本机凭据和配置都对，是校园端没答。瞬间 Reason 2，是本机凭据或配置故障——问题在自己。这两者的处置完全不同：前者要等校园恢复或切 F50 兜底，后者要改凭据。混淆了就会在校园端故障时去改自己的凭据，越改越乱。

基于这个诊断，BUAA-Mobile 升为日常主力，F50 降为无条件直连下载代理和直连故障兜底。翻墙节点改绑 BUAA，新增 17893 F50 Direct 下载入口，绝不套机场或 VPN。配置维护从 quota-balance 多层覆写改成单向策略编译。

模型库对账是另一条线：NewAPI 的 models 元数据表和网关 /v1/models、channel 模型列表三方对齐，补缺、软删孤儿。KV slot 准入则是 vllm-gateway 按显存余量决定放不放新请求，避免 OOM。

一天多线，共同点是「先分清是谁的故障，再动手」。
