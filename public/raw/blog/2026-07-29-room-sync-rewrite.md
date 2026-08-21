---
title: 一起听的多用户同步：为什么房主和成员的状态永远对不上
descrption: 我们 8 月初对一起听功能做了一轮多用户同步的重构，记录 Room / Worker / Client 三层架构里踩到的几个真实问题。
date: 2026-08-11
tags: [sync, realtime, music, web, debugging]
draft: false
summary: 一起听功能的多用户同步涉及 Room (DO)、Worker、Client 三层。重写过程中遇到的三个核心问题：状态变更触发频率不一致、变更语义不明确、成员视角的房间列表被房间号覆盖。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 背景：一起听的现状

8 月 9 号我们开始重写一起听（多人共同听同一首）功能。

原本的逻辑很简单：每个人各自的 player，播放列表是各自加自己的。但用户反馈说"一个房间里的人应该共享一个播放状态"，于是要重写。

## 问题一：变更触发频率不一致

**症状**：用户主动改变播放进度、播放状态、发消息时——这些状态要同步给 Worker 里的 room；其他人发的消息也要互相可见。

最初实现是 Client → HTTP POST → Worker → 广播到 Room → 广播给所有成员。

但实测：
- 房主切歌：成员能收到
- 成员切歌：房主收不到
- 任何人发聊天消息：只有房主能收到，成员之间互相看不见
- 切歌：双方都不更新

为什么？因为 Room 用"事件类型"做路由：

```ts
// 错误的实现
room.broadcast({ kind: 'play', source: 'owner' }) // owner only
room.broadcast({ kind: 'chat', source: 'anyone' })
```

问题在于**事件类型 + 来源**组合爆炸。每加一种"who can do what"，就多一对分支，很快就失控。

**修法**：去掉 `source` 字段，统一用"事件"模型 + "来源成员 ID"做广播路由。所有事件由 Room 单点广播给所有人，Client 端自己决定要不要 ignore：

```ts
interface RoomEvent {
  kind: 'play' | 'pause' | 'seek' | 'chat' | 'enqueue' | ...
  memberId: string  // 不管谁发起
  payload: any
  seq: number
}
room.broadcast(event) // 全员
```

## 问题二：变更的"语义"不明确

举个例子：成员 A 点"暂停"，但成员 B 的 player **已经在暂停状态**。此时是否要广播一个"暂停"事件？

- 如果广播：冗余
- 如果不广播：B 看不到 A 改了状态——因为 A 的本地状态变了，但 B 没收到通知

**真正的语义**：要区分"用户操作"（user action）和"状态变更"（state change）。只有用户操作需要广播，状态变更是 Client 自己派生的。

```ts
// 错的：所有 player state 改变都广播
player.on('state-change', e => room.broadcast(e))

// 对的：只广播用户意图
player.on('user-action', e => room.broadcast(e))
// Client 收到后自己 setState，让 player 同步
```

## 问题三：成员视角的列表被房间号覆盖

最后一个坑：访客（不在房间里）点进一起听页面，本地列表加载好了，但**房间号被房间列表的第一个房间覆盖**。

```ts
// 错的
const currentRoom = roomList[0] // 永远取第一个

// 对的
const currentRoom = userJoinedRoom ?? null
if (!currentRoom) {
  // 显示"未加入任何房间"
}
```

这个 bug 比较隐蔽，因为**单元测试里不会发现**——单元测试只测"加入房间后"的状态，不测"加入前"的初始状态。

## 最终架构

```
Client (每个成员 1 个)
  ├── HTTP POST /events → Worker
  ├── GET /snapshot → Worker → Room
  └── WebSocket ← Worker ← Room (DO)
                       ├── Broadcast events
                       └── SQLite (per-room state)
```

每个 Client 只跟 Worker 对话，Room 在 Worker 后面做单点状态合并。

## 经验

1. **状态同步最忌讳"source-based routing"** —— 加成员/角色时分支爆炸
2. **区分"用户意图"和"状态变更"** —— 只广播意图，状态派生
3. **边界状态要测** —— "未加入""刚退出""短暂闪烁"这类初始态，单元测试容易漏

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />

> 同步问题是分布式系统里最像"水"的问题——你看不见它，但它从每个裂缝渗进来。