---
title: "Sunshine 串流无声：从应用音频流追到 monitor source"
description: "9 月 25 日排查 Sunshine 串流无声，发现采集点与实际音频路径需要一起核对。SUSPENDED 可能只是空闲状态；要在播放中检查应用输出、sink 和 monitor，不能只凭一个状态字符串确定根因。"
date: 2026-09-25
tags: [sunshine, pipewire, pulseaudio, audio, monitor-source, moonlight]
draft: false
backfilledAt: 2026-11-24
backfillKind: event
summary: "9 月 25 日排查 Sunshine 串流无声，发现采集点与实际音频路径需要一起核对。SUSPENDED 可能只是空闲状态；要在播放中检查应用输出、sink 和 monitor，不能只凭一个状态字符串确定根因。"
---

import NetEasePlay from '../../components/NetEasePlay.astro';

> 2026-11-24 校订说明：本文从迁移前的历史稿恢复，保留 2026-09-25 的事件日期。撤回“看到 SUSPENDED 就证明路由坏了”的说法；区分播放流和录制流，也区分视频编码后端选择与 AV1 会话协商。

## 采集点存在，不代表那里有声音

9 月 25 日深夜，Sunshine 连接成功、画面正常，客户端却没有声音。当天记录中，它选中的 monitor source 属于 HDMI 输出；检查时对应 sink 处于 `SUSPENDED` 状态。

最初把这个状态直接当成了根因。现在看，证据还差一步：sink 空闲时挂起可以是正常行为，必须在应用正在播放的同一时刻确认音频流有没有送到它。否则一次静态截图，无法区分“没有播放”“路由去了别处”和“采集出了问题”。

## 沿着同一段音频走一遍

这类排查应该分别确认应用的播放流、目标 sink、对应 monitor，以及 Sunshine 的录制流。PulseAudio 兼容接口下，下面几项观察的对象不同：

```sh
pactl get-default-sink
pactl list short sink-inputs
pactl list short source-outputs
```

`sink-inputs` 对应送进输出设备的播放流；`source-outputs` 对应从输入源取音频的录制流。默认设备也不保证已经存在的应用流立刻迁过去，所以改完默认值还要看真实路由。

Sunshine 的 [`audio_sink` 与 `virtual_sink` 配置说明](https://docs.lizardbyte.dev/projects/sunshine/latest/md_docs_2configuration.html)提供了选择采集设备的入口。具体行为仍需要与所装版本和平台对上，不能照搬别的平台设备名。

## 后一次连接为什么有了声音

历史记录写到，客户端以 5.1 配置连接后，Sunshine 创建了虚拟 sink，随后音频恢复。这支持“那次会话的路由发生了有用变化”，但没有完成只改变声道数的隔离实验，因此不能说 5.1 本身就是通用修复。

更准确的验收是：在实际播放时，应用流进入预期 sink，Sunshine 从对应 monitor 采到非静默音频，客户端也能听到。同一台机器可能合法地只有 HDMI 音频设备，这本身也不等于系统缺少声卡或必须更换输出路径。

## 同晚的 AV1 问题要另算

那一晚还检查了视频编码。编码后端的优先级回答“由哪一套实现来编码”；会话是否用 AV1，还取决于服务端能力、客户端支持、配置和双方协商。

因此，配置项允许 AV1、日志里出现某个 GPU，或者选择了某个编码后端，都不能单独证明这次画面已经是 AV1。最终应看实际连接中的 codec 日志。这和音频无声是两条检查线，放在同一篇记录里，也不需要把它们合成一个原因。

<NetEasePlay id="1905978716" kind="song" />
