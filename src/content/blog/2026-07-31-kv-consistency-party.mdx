---
title: Cloudflare KV 最终一致性与一起听功能的实际失败
description: 7 月底，一起听功能在并发写入时丢聊天记录和播放状态。根因不是 WebSocket 断线，而是 KV 的最终一致性本身；修复路径包括短期内改策略、长期迁 Durable Object。
date: 2026-07-31
tags: [cloudflare, durable-objects, websockets, concurrency, wrangler, production]
draft: false
---

import NetEasePlay from '../../components/NetEasePlay.astro';

**时间锚点：2026-07-31 上午。**

一起听功能上线后，我在线上环境做了并发测试：模拟 20 条同时到达的聊天消息加上心跳写入，结果发现双方各自收到的聊天数是 0。

之前以为是 WebSocket 断线或者心跳间隔有问题，因此改了好几次客户端的心跳频率和重连策略；实际效果没改善。最后用调试代理把写入路径从 Cloudflare KV 换成 Durable Object 之后，并发测试才第一次通过，20 条聊天双方各收到 20 条，零丢失。

---

## 事件：线上的"丢消息"是怎么发现的

背景是 Cloudflare Pages 上有一个监听协奏模式请求的后端，把房间里的聊天、播放进度和成员列表都写进 KV。客户端通过轮询 `list()` 同步状态。

部署上线后，同一个房间里的房主和成员，有时候会互相看不到对方的最新聊天。一开始我把原因归结为轮询延迟，于是把轮询间隔从 2s 降到 500ms，加了去抖和单次轮询，但数据丢失问题依旧。

真正绷不住的是某一轮 A/B 对比：客户端同时发出 40 个并发请求（20 条聊天 + 20 条心跳），结果双方各自查到的聊天数都是 0——这已经超轮询间隔能解释的范畴。

---

## 坑：KV 的写是"发出去就没管了"

Cloudflare KV 是最终一致性存储。文件写入后，最近的读操作**不一定**能看到新写入的键值。我以为是 list() 返回结果不稳定，加了一堆参数重试都没改善。

真正的错误来源是：wrangler 写的代码里，聊天事件的追加和房间状态查询发生在同一个 API 路径下，而 KV 的 list 操作可能跳过刚刚（几毫秒内）新增的键。这导致在高并发场景下，参与者的状态永远在"另一个时区"，看不到对方刚写的内容。

我还犯了一个常见的调试误区：用了睡眠和 deterministic 测试，之前的测速没触发明显问题。

---

## 修复：迁到 Durable Object 并用单线程串行

方案最终分成内外两层。

**客户端（前端）：** store 层加了确定性合并策略，两个同时到达的更新不再以时间戳覆盖，而是以操作序列号（intent ID）为序；轮询改成单飞（single-flight），同一个轮询周期内的多个状态写入排队，避免写入冲突。

**服务端：** 新建一个独立的 Worker `yvxi-party`，里面定义 `PartyRoomDO` Durable Object。房间的所有操作（聊天追加、状态更新、成员变更）都路由到 DO 的 `fetch()`，DO 单线程处理同一个房间的请求，天然避免竞态。状态内存基础上加周期写盘（DO storage）做崩溃恢复。

Pages 绑定 DO 的方式不能直接在 `wrangler.jsonc` 里配置 DO（Pages Functions 不支持 DO 绑定），正确路径是独立部署一个 Worker，再用 Pages Functions 作为代理转发。

最终架构：
- `workers/party-room.ts` — DO Worker，SQLite 持久化
- `functions/netease/[[path]].ts` — 薄代理，转发到 DO Worker
- `wrangler-party.jsonc` — DO Worker 独立部署配置
- `wrangler.jsonc` — Pages 配置不变，代理层负责转发

部署后生产环境并发测试（40 并发，20 聊天 + 20 心跳）全部通过，`rejected: []`，`missing: []`，双方最终状态一致。

---

## 学到了什么

1. **KV 适合做配置，不适合做强一致性协调层。** 不要把聊天记录、实时状态这种需要"看见最新写入"的数据放进 KV，否则并发一上来就会踩坑。

2. **Durable Object 是 Pages/Functions 生态里解决这个问题的唯一正确选项。** Pages 项目通过独立部署一个 Workers + DO 来使用 DO 的语义，这是很多人第一次接触 DO 时会踩的坑。

3. **生产环境要测协程并发，不是测单卡。** 在没有部署真实并发压测之前，轮询修复和客户端重试都只是改了个寂寞。

在一个 MVVM 驱动的前端代码中，WebSocket 代替了 KV 轮询，现在 KV + DO 的 hybrid 交接还算稳定，但 DO 的计费方式需要压测更长时间看看开销。

```mdx
🎵 Listening companion
<NetEasePlay id="3986241" kind="song" />
```
