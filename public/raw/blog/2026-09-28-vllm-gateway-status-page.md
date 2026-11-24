---
title: "vLLM 网关状态页：slots 配置驱动与 SSE 尾部"
description: "状态页上线 CT102，动态 slots 和生成尾部显示实测通过；引擎改 max-num-seqs 必须同步 config"
date: "2026-09-28"
tags: ["vllm", "gateway", "sse", "observability"]
draft: false
summary: "后端 /metrics 不暴露 max_num_seqs，slots 只能配置驱动"
---

vllm-gateway 状态页上线生产（CT102），两个新能力实测通过：动态 slots，配置驱动，capacity==4 实测正确；生成尾部显示，SSE tap，240 字符滚动窗口，20 个测试全 PASS。

这里有个运维坑值得记下来。后端 /metrics 不暴露 max_num_seqs，所以 slots 的数量只能配置驱动。这意味着：引擎改 --max-num-seqs 的时候，必须同步 config.json 并重启网关，否则状态页显示的容量会和实际脱节——你以为 8 路，实际引擎只给了 4 路，状态页还信誓旦旦写着 8。

可观测性的前提是「显示的值真的来自那个量」。配置驱动的 slots 省掉了和引擎握手，代价是这层同步得靠人记得。
