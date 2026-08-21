---
title: 在 Cloudflare Pages 上跑 Astro + DO Worker + 播放器：我们踩过的八个坑
description: 把一起听功能从 KV 迁移到 Durable Object 并部署到 Cloudflare Pages 时，我们遇到了哪些真正的问题，哪些是文档没说清楚的。
date: 2026-07-27
tags: [cloudflare, astro, durable-objects, debugging]
draft: false
summary: 一起听功能的生产环境部署踩坑记录：DO 路由、script_name 绑定、客户端合并策略、WAL 机制等等。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 背景

我们在 Cloudflare Pages 上部署了一个 Astro 站点，里面有一个实时一起听功能。最初用 KV 做房间状态存储，后面发现并发写入会丢数据，于是迁移到 Durable Object（DO）。

迁移本身不难，难的是把这些东西"缝"进 Pages 上。

## 坑一：Pages 不直接发 DO

Cloudflare Pages Functions 可以 bind Durable Object，但 Pages 本身不会自动创建 DO binding。你需要**显式在 wrangler.jsonc 里写**：

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "PARTY_ROOM", "class_name": "PartyRoom" }]
  },
  "rules": [
    { "type": "JavaScript", "globs": ["functions/netease/**/*"] }
  ]
}
```

没写的时候，部署时完全没报错，只是调用 `env.PARTY_ROOM` 时返回 `undefined`，非常安静地失败。

## 坑二：DO 和 Pages 的 script_name 关系

Pages 会把入口作为 `script_name` 传给 DO，所以 DO 的 namespace 创建需要和 Pages 入口匹配。错配会得到 `"Duplicate namespace or class name"` 或 `"Class not found"`——这两个错误提示根本没告诉你"你的 DO binding name 和 Pages 入口的命名约定搞错了"。

## 坑三：KV 的最终一致性是真实存在的

之前把房间状态放 KV，并发写的时候，不是丢整条写入，而是丢写入里的"次要字段"。具体症状：

- 房主切歌，房间里的其他人状态不变
- 用户发聊天消息，有时显示在列表里，有时不显示
- 看起来像是"实时"，实际上是"最终合并"的产物

最后 debug 发现是 KV 同一 namespace 同一 key 并发写，最后写的覆盖先写的（确实是最终一致+ last-write-wins 语义），而我们的实现没有 version 号。

## 坑四：客户端合并策略不够实用

迁移到 DO 之后，客户端需要处理" conflicted state"的情况。并不是 DO 解决了客户端的所有问题，它只是把"并发写谁先谁后"的问题简化成"每行有序"。

我们的 store.ts 最终加了 three mechanisms：

1. **确定性合并**：同一条消息用自增 `intent_seq` 排序
2. **单飞轮询**：只保留最近一条 poll timer，避免并发写 race
3. **写队列**：所有状态更新排队，避免 in-flight 的改变被覆盖

## 坑五：seek 时状态丢失

`seekTo(50)` 调完之后，如果 `isPlaying` 没被记住，DO 那边的状态会回退到 `isPlaying: false`，但 UI 上显示的是跳转前的位置+时间。

原因是 seek handler 里晚于 `currentTime` 写操作之外的代码，`isPlaying` 的读操作被 DOM/事件竞态。修复方法：seek 的 handler 做**先读 state，再写 state，语义下独立的字段不要一起重绘**。

## 坑六：WAL 日志不是自动清理的

之前的部署有个 December 没清理的 WAL 文件。虽然 Cloudflare 本身自动 checkpoint，但 Pages + Functions 在 dev 模式下 WAL 文件不会自动 truncate，如果你 dev 的时候重载很多次，SQLite db 会膨胀。

实际解决办法是在 store.ts 加上 `PRAGMA wal_autocheckpoint = 1000` 并对生产 DB 定期执行 `VACUUM`。

## 坑七：没有 local DO 可以用

Cloudflare 官方推荐 local dev 用 `wrangler dev`，但 Durable Objects 的 local emulation **早于版本 3** 就有 bug。我们的 room binding 在本地完全没问题，部署后才发现问题——因为本地 emulation 和 prod 的 DO lifecycle 不一样：prod 是 idle timeout 回收，本地是进程级单例。

## 坑八：验证也是技术活

我们写了一个"双身份端到端测试"：同一个浏览器两个 tab，分别以 room-owner 和 member 身份加入，然后并发发送 20 条消息。在 KV 版本里最多有 7 条丢失，DO 版本 0 丢失。

这个测试脚本后来成了 CI 的一部分——每提交自动跑一遍。

---

## 最终架构

```
Client → Pages (Astro SPA)
         └── functions/netease/[[path]].ts   ← thin proxy
                └── Durable Object (PartyRoom)  ← state
                       └── SQLite (per-room)     ← persistence
```

全部部署在 Cloudflare，自托管 CDN、边缘计算、数据库全包。

## 经验

1. **KV 不是关系型数据库**——用它做高并发状态存储要非常小心写冲突
2. **DO 很棒但需要独立测试**——本地等价验证不等于生产等价验证  
3. **验证脚本必须自动化**——"我看着没问题"不等于"它没问题"
4. **文档说"可以支持"不等于"配好就能用"**——实际生产往往需要额外手配

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />

> 云村的 Bug 写在日志里，解开的瞬间像这首歌。
