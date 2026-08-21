---
title: 682 行 subprocess + 反检测浏览器：这台机器有太多东西在抢 MCP watch
description: 7 月 23 号到 27 号这段时间，NapCat 的 wake 机制、skills-fs 挂载、paddleocr 反盗链三条线同时出问题。排查路径最复杂的一个：bot 明明 QQ 收到 AT_ME 事件，但 wake 发出之后 Hermes 从不处理——原因是 skillsfs_monitor_task 静默消亡（a task was destroyed but pending），加上 wake 命令走的是 CLI 而不是 HTTP 标准路径。
date: 2026-07-24
tags: [napcat, asyncio, python, skills-fs, wake, debugging]
draft: false
summary: NapCat 的 wake 触发了但 Hermes 不响应，排查一圈发现两个问题叠加：asyncio 任务 (skillsfs_monitor_task) 在 watch.py:1108 被静默 destroy 导致事件总线半残； wakes 发命令的通路用了 CLI 而不是 HTTP，让 heroku/cmd 模式触发了 not-a-tty 报错没进入处理流程。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 7 月 27 日凌晨，QQ bot 收到了 AT_ME，但 Hermes 什么都没做

凌晨 2 点，整个屋子里的机器群都亮着。QQ 企业对噗噗（VPN 4000 万次的 bot）发消息，bot 收到了，日志里写：

```
[WAKE] delivered reason=AT_ME transport=cli detail=exit=0 err=Warning: Input is not a terminal (fd=0)
```

`reason=AT_ME`：触发类型没问题（QQ @ 消息，高优先级）。`exit=0`：返回码也不是失败。under normal circumstances Hermes 应该在被唤醒之后处理这条消息并开始回复。但它什么都没有做。

## 事件

先看一下 wake 机制的背景：

- NapCat 通过一个 daemon 进程（`napcat-cli daemon watch.py`）常驻，监听 QQ 事件（新消息、AT、禁言、加好友等）
- 当判定某条事件满足 wake 条件（`AT_ME`、`DM_ME`、`REPLY_TO_ME`），daemon 就调用一个 wake 命令，把通知发给 Hermes
- Hermes 侧用一个 subprocess 接收这个通知，再触发对应的 agent 会话唤醒

问题出在链路的两端。

## 坑 1：`skillsfs_monitor_task` 静默消亡（Task was destroyed but it is pending!）

查行的报错：

```
cio/tasks.py:521] Task was destroyed but it is pending!
task: <Task pending name='Task-3' coro=<skillsfs_monitor_task() running at 
      napcat_cli/daemon/watch.py:1108> wait_for=<Future pending ...
```

`skillsfs_monitor_task` 是在 `watch.py` 里写的 asyncio task，登记到 NapCat daemon 主 loop 的 task set 里。当 daemon 收到 `SIGTERM` 或大循环出现异常——比如 daemon 在主进程重启、或者被 OMP 的 graceful restart 机制触发了 stop——task set 被 drop 的时候，pended 的 task 还持有未来的 `wait_for` callback。

Python 的 asyncio logging 会打印上面这条警告，但**不会抛出、不会重试、不会 raise**——它在 event loop 的 cleanup 阶段静默 remove 你 trace 到 `watch.py:1108` 就知道是 skills-fs 的磁盘通知拉取逻辑：当 FUSE 挂载好了一个虚拟文件系统，monitor task 负责 watch 这个 mount 里的 `events/` 目录的写入，通过 inotify / polling 检测新的通知事件。

一旦 skillsfs_monitor_task 没了，接下来的新消息事件在 daemon 层面就不进入 agent 的 inbox——被丢进 a pending future 池子，没人消费。

刚才看它 wake 日志说 "delivered"，实际上 delivered 的意思是："触发 action 成功调用了 subprocess"。但影响到 action 是否被 consumer（Hermes）消费的是下游的有无事件消费。

## 坑 2：wake transport 错误地走了 CLI，而不是 HTTP

 wake 事件日志里最明显的问题是 `transport=cli`。NapCat daemon 的 default wake transport 在当年 7 月是"起一个子进程走 CLI 打命令"——用 subprocess 跑 `napcat-cli wake send ...`——但这种方式有几个隐藏的坑：

1. Hermes 的主进程在 user-level Session 上，stdin 从终端来。当 daemon 后台运行（非 TTY context），subprocess 打开 stdin 拿到的是 `fd=0` 的字符设备节点，输出 `Warning: Input is not a terminal (fd=0)`，那 stderr 这个 warning 不会提升 error code——`exit=0` 确实不报错，但 Hermes 主进程读到的 stdin 内容是空的，相当于 wake 发出之后没人给触发语。
2. 再看 NapCat 的子进程：`napcat-cli` 作为 omp shell wrapper 时用了 `pty=True` flag，但从 daemon 内部调时没给 pty——一个 Python `subprocess.Popen(["napcat-cli", "wake", "hermes", ...])` 的 call 在非 TTY 下读不到任何用户输入。
3. 实际上 `napcat-cli` 的 wake 功能好好地**有 HTTP endpoint**——`POST http://127.0.0.1:6090/api/wake`——这个 endpoint 应该被 daemon 调，而不是再走 subprocess CLI 复刻这么一段绕远路。

```python
# wake.py 中的写法（伪代码白天）
def send_wake(reason, detail):
    # 问题：走 subprocess（password 叉开）
    subprocess.run(["napcat-cli", "wake", reason, detail], 
                   capture_output=True, text=True)
    
    # 应该直接走 local HTTP
    requests.post("http://127.0.0.1:6090/api/wake", json={
        "reason": reason,
        "detail": detail
    }, timeout=3)
```

## 坑 3：skills-fs 挂载的健康检查曾经导致整个 daemon stop

还有一个叠加 bug：skillsfs 在挂载的时候会保持一个进程句。如果 daemon 重启（比如 omp 跑某个任务触发 graceful restart），旧的挂载逻辑残留的 health check 线程会竞争同一个 FUSE mount。

[回看当时的日志]：
```
skillsfs mount health check failed, degraded (exceeded max restarts 3), FUSE tree temporarily unavailable
```

这个 warning 意味着 skills-fs 在 mount 重新 ready 的 period 里被降级（degraded）——daemon 是这个降级过程的制造者，但 daemon 自己这时候也应该重启，才不会在降级状态继续接收事件。

实际观察到的结果是：daemon 没静炁重启而是仍在跑继续收 wake，但此时 FUSE 树不可用，事件总线的一半路径不可消费。AT_ME 被 collect 了、发 wake 了、Hermes 被通知了——但 Hermes 醒来的瞬间发现 skills-fs 文件系统失效，后续的 action 读不了 event file，就又落到一个空结果。

链条两头：一边是 wake 发出去，一边是 wake 接收侧没拿到内容。

## 修复

**修复 1**：改用 HTTP 发送 wake——直接调 `127.0.0.1:6090/api/wake`，避免 TTY 假设+subprocess 开销，且 daemon 和 Hermes 用同一份 wake 协议：

```python
# napcat_cli/daemon/watch.py: wake function
def dispatch_wake(event_type, detail):
    url = f"http://127.0.0.1:6090/api/wake"
    payload = {"reason": event_type, "transport": "http"}
    try:
        r = httpx.post(url, json=payload, timeout=3.0)
        r.raise_for_status()
    except Exception as e:
        log.error(f"wake dispatch failed: {e}")
```

好处：HTTP transport 本身内部处理了 TTY 问题，不需要 FUSE 上的 filesystem 就能 deliver，即便 skills-fs 还在重启。

**修复 2**：`skillsfs_monitor_task` 的 lifecycle 与 main daemon loop 绑定。在 `watch.py` 的开头启动之后：

```python
task = asyncio.ensure_future(skillsfs_monitor_task())
# 加 task on_done callback，不 await 直接 register
task.add_done_callback(record_task_completion)
```

当 daemon 触发 `SIGTERM` 时，先 `cancel()` 所有 pending task，而不是直接 loop close——让每个 task 先做 graceful release。

```python
async def graceful_cleanup():
    for t in all_pending_tasks():
        t.cancel()
    await asyncio.gather(*all_pending_tasks(), return_exceptions=True)
```

**修复 3**：前置的健康检查：daemon 在启动之前先检查 skills-fs mount 是否已就绪。如果 skills-fs 没 ready，就在 wake dispatch 这一层做 retry + backoff，而不是直接丢弃事件。简单的`backoff` + `circuit breaker` 就够。

## 结果

修复后的事件流：

- QQ @ message → NapCat daemon 收到 `AT_ME` → **HTTP wake dispatch → 200 OK**
- Hermes 主进程收到 HTTP wake → 处理事件、回复
- skills-fs 重启中时有 1-2 秒的延迟，但 wake 不丢失——daemon 做 backoff retry

等等——实际上还有另一个坑：她一天内回复 Hermes 的原因是"多回复的 msg 不对引用"。那段修复跟 msg_id 正确性有关，但 wake 这层的修复解决了 wake 发出也没反应的问题，这俩是各自独立的。

## 经验

- **都是子进程 + CLI 的 pitfall**：Python 的 Popen 在 stdio 都是 fd 但没有 TTY 的 context 下不会失败，也不会成功——它会变成 no-op。和 `pty=True` 的区别在 daemon 场景下经常被忽视。`"Warning: Input is not a terminal"` 不是 fatal，但 wake 走的 CLI 直接读了空的 stdin，不是报错这个形式。
- **asyncio task 的生命期是 daemon 强绑定的**：`Task was destroyed but pending` 不是一张 warning 小纸条——它意味着**你的 call back 函数还没 finish，整个 event loop 就不等你了**，后续所有 await 的 future 都会脱离。
- **wake transport 应当是 HTTP-first，不是 CLI-first**。CLI 用在 developer 测试，production 里得走 endpoint——当接口存在的时候，不是 CLI 走不通，是人"方便"选择了 subprocess 复刻，结果踩了 TTY 的坑。
- **skills-fs 的生命周期要和你的 service 也就是 daemon lifecycle 完全一致**。mount 降级情况下 daemon 应该自我重启，不是继续降级运行——继续跑会让 wake 流式地丢弃事件，不发生、不发生、不发生、都不报错。
- **事件的幂等保证是不可少的**：如果 wake 因为 HTTP transport 被重发，收到方要做幂等去重（msg_id 去重或原因类型已在 sessison window 里处理了）。否则 wake retry 会触发 agent 多次处理。

## 经验

从更深的角度说，NapCat 的 wake 机制这段时间从"伪实现"改到"真的在投递"走了三个月的弯路：该走 HTTP 而走了 CLI，该走了 event-driven task 而用了 subprocess，应该监控 daemon health 而没有。每次 event 复杂性的提高都让这三个坑逐一暴露。**解决 ISP 的可靠交付链路不是"新加一个功能"，是把调用栈里所有"假设终端"的环节改成"网络端点"**。听起来傻，但执行起来很长。

🎵 Listening companion
<NetEasePlay id="21257336" kind="song" />
