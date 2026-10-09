---
title: "CPU 转写的三条实测教训"
description: "faster-whisper large-v3 CPU int8，0.67 音频秒/墙钟秒；并行腰斩、不关条件会死循环、必须分块"
date: "2026-09-23"
tags: ["whisper", "transcription", "cpu", "audio"]
draft: false
summary: "1 小时录音约 1.5 小时转完，违反三条教训任何一条都会白跑"
---

本地语音转写能力搭好了，faster-whisper large-v3，CPU int8，跑在 CT102 的 32 核 EPYC 7302P 上。实测吞吐 0.67 音频秒每墙钟秒，也就是 1 小时录音约需 1.5 小时。

不是选 CPU 是技术限制，是资源分配：两张 V100 在 VM101 上跑 vLLM 推理，那是长期在线的 agent 后端，不能为转写停掉。GPU 路线仍然可用且快得多（V100 fp16 对 whisper 很友好，预计 RTF 远小于 0.1），但要等推理空窗。

三条实测教训，违反任何一条都白跑：不要并行，两个任务合计吞吐 0.355，比单跑的 0.67 腰斩，因为 32 核开 28 线程已过扩展拐点，加 EPYC 7302P 没有 AVX512、内存带宽被抢。必须关 condition_on_previous_text，否则会进重复生成死循环，表现是 CPU 跑满、日志不再增长、永不结束，本次卡死两次。分块处理，一块坏了只堵自己那块。
