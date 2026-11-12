---
title: vLLM 在一个具体的 batched-token 数值上崩溃：调 max-num-batched-tokens 绕开窗口
description: 2026 年 10 月 16 号在 doescompute 上准备多模型环境，引擎端到端跑通后，发现崩溃不是内存问题，而是卡死在 max-num-batched-tokens 的某个具体数值窗口上。
date: 2026-10-16
tags: [vllm, gpus, kv-cache, multi-model, debugging]
draft: false
summary: vLLM 崩溃定位到一个具体的 max-num-batched-tokens 数值窗口（8128），不是 KV 池或显存不够。确认 KV 池 589624 tokens、四路 128K 预算有 65336 tokens 名义余量后，选择调 batched-tokens 上限避开窗口，而不是动生产配置。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 10 月 16 号，多模型环境的引擎救活之后，崩溃卡在 8128 这个数字上

那天把 ModelScope 的多模型运行环境准备出来，本地 doescompute 引擎救活、端到端验证通过，Crater 配方也发出去。收尾时还剩一个悬着的决定：要不要调 `max-num-batched-tokens` 去避开 8128 这个崩溃窗口。

## 事件

四台 VM 的显示链路都修好了（串口加显示口都能进控制台），引擎在四路 128K 准入下端到端跑通。KV 池容量确认是 589,624 tokens，相对四路 128K 的总窗口预算还有 65,336 tokens 的名义余量。到这里一切看起来正常。

## 坑

真正卡住的是崩溃，而不是显存不够或 KV 池溢出。它不是随机崩，而是落在 `max-num-batched-tokens` 的一个具体数值窗口（8128）上。这种崩法很容易被当成"内存压力大"去加显存或降并发，但那条路解决不了——崩的是调度器在某个 batched 边界上撞到的窗口，不是资源耗尽。把 8128 当成一个偶发 OOM 去处理，会反复在同一个地方翻车。

## 修复

没有去动生产配置里的并发或窗口大小，而是把 `max-num-batched-tokens` 调到避开 8128 那个窗口的值，让调度器不踩进去。崩溃窗口消失，四路 128K 准入照常维持。

## 经验

vLLM 这一类崩溃，先分清是资源不够（KV 池、显存）还是数值窗口（某个 batched-tokens 边界）。KV 池有 65,336 tokens 名义余量却照样崩，本身就是信号：问题不在池子大小。定位到具体的数值窗口之后，调 `max-num-batched-tokens` 是最小改动；去扩显存或改准入才是过度反应。下次再遇到"明明有余量还崩"，先怀疑数值窗口而不是资源。

🎵 Listening companion
<NetEasePlay id="4084037" kind="song" />
