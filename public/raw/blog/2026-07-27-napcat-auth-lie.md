---
title: napcat-cli 的 auth 和 status 为什么互相骗对方是"在线"
descrption: 8 月初我们发现 `napcat auth qr` 和 `napcat status` 报告 Bot 在线，但 QQ 客户端那边明明掉了——怎么排查这种"两个 service 都觉得自己是对的"的 bug。
date: 2026-08-08
tags: [napcat, debugging, websocket, status]
draft: false
summary: napcat-cli 的 napcat-cli 的 auth 和 status 各自维护"是否在线"的状态机，互不感知。WebSocket 掉了之后，NapCat 进程还在但实际已断连。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 现象

8 月 7 号我们发现一个奇怪的 bug：

```
$ napcat auth qr
Bot is already online: 噗噗 (3914024488)
No QR code needed.

$ napcat status
# 也显示 online
```

但实际 QQ 那边——噗噗根本没回消息。

## 排查

这种 bug 最讨厌：两个 service 都觉得自己是对的。

### 第一步：分清楚谁报的状态

`napcat auth qr` 检查的是"napcat-cli daemon 进程是否在跑"。`napcat status` 检查的是"daemon 里维护的 `_ws_connected` 标志位"。

两个标志位**互相独立**：
- daemon 进程跑着 → `auth` 说"在线"
- `_ws_connected` 是 `True` → `status` 说"在线"

但 `_ws_connected` 只在 WebSocket 连接**建立那一刻**设为 `True`，**不会在断连时自动更新**。

### 第二步：复现

在 napcat-cli daemon 跑着的时候，去 docker container 里把 napcat 进程 kill 掉——模拟"QQ 协议层断连"。

```bash
docker exec napcat pkill -9 -f napcat
```

回到本机：
```
$ napcat auth qr
Bot is already online: 噗噗 (3914024488)  ← daemon 还跑着

$ napcat status
[ok] daemon: running
[ok] ws: connected  ← 但 _ws_connected 还是 True
```

两个都说在线，但实际 QQ 已经断。

### 第三步：根因

`_ws_connected` 是个全局变量，只在 connect 成功时设为 `True`，没有对应的"断连时设为 `False`"的代码。

WebSocket 客户端**没有断连回调**——这是 napcat-cli 当初写的简化。但这是错的：长期跑的 service 必须有断连检测。

## 修复

三件事：

1. **WebSocket client 加 `onclose` 回调**，断连时设 `_ws_connected = False`
2. **`status` 命令不只看缓存，主动 ping NapCat HTTP API**（`/get_status`），看真实连接状态
3. **`auth qr` 在 daemon 报"online"时，主动去 ping NapCat**——如果 ping 不通就提示"daemon 认为在跑，但 NapCat 实际已断"

```python
# napcat_cli/daemon/watch.py
async def on_ws_close(*_):
    log.warn("[WS] closed")
    state.ws_connected = False
    state.last_disconnect_at = time.time()

ws.on('close', on_ws_close)
```

## 经验

1. **缓存的"在线"标志必须由事件驱动更新** —— 不能只设一次 True 就完事
2. **两个独立 service 互相核对状态时，要有个第三方作为 ground truth** —— 这里 NapCat HTTP API 是 ground truth
3. **长期 service 必须有 health check** —— 启动时的"on"不代表一直"on"

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />

> 两个 service 都觉得自己是对的，错的其实是它们之间的"信任"。