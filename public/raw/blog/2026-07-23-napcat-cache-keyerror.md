---
title: "NapCat-CLI 的缓存 KeyError 与启动心跳之谜"
description: "修复 napcat-cli 在执行 group info 等命令时偶发的 KeyError: 'ts' 崩溃。根因在于 API 在线状态缓存初始化不足，导致首次探测时读写不一致。"
date: 2026-07-23
tags: [python, napcat, debugging, cache, bot]
draft: false
---

import NetEasePlay from '../../components/NetEasePlay.astro';

**时间锚点：2026-07-23 下午。**

在运行 `napcat group info <group_id>` 时，CLI 突然抛出一个 `KeyError: 'ts'` 然后直接崩溃。错误指向 `require_online() -> api.is_online()`。

---

## 事件：一次意料之外的崩溃

崩溃发生在 `napcat-cli` 的 API 调用链路中。绝大多数命令都能正常运行，但某些特定的 group 操作在特定环境下会触发 crash。

初步排查发现，崩溃点在 `napcat_cli/lib/api.py` 的 `is_online` 函数中。这个函数设计了一个简单的缓存机制：如果上次探测在线状态的时间在 30 秒内，就直接返回缓存结果，不再请求网络。

---

## 坑：.get() 和 [] 的微妙差异

问题出在缓存字典 `_online_cache` 的初始化和读取逻辑上。

代码原本的逻辑是：
```python
if self._online_cache.get("ts") and (now - self._online_cache["ts"]) < _cache_ttl:
    return self._online_cache["online"]
```
在 `__init__` 中，`_online_cache` 被初始化为一个空字典 `{}`。

我最初以为 `.get("ts")` 在空字典里返回 `None` 会触发短路，从而跳过后面的 `self._online_cache["ts"]`。理论上是对的。但在多线程或某些特定的异步重入场景下，如果在 `get("ts")` 返回 True 之后，由于某种竞争条件（或者在某些极端的 Python 解释器行为下），字典状态发生了偏移，或者在复杂的嵌套调用中，缓存被部分初始化但缺少 key，就会触发 `KeyError`。

实际上，最核心的问题在于**信任了缓存的结构完整性**。只要进入了 `if` 分支，就默认 `ts` 键必须存在且可用。

---

## 修复：预填充状态种子

与其在读取时做复杂的判断，不如在初始化时就给缓存一个“安全种子”。

将 `__init__` 中的初始化改为：
```python
self._online_cache: dict = {"ts": 0, "online": False}
```

这样保证了无论何时调用 `is_online()`，`_online_cache` 永远拥有 `ts` 和 `online` 这两个键。即使 `ts` 是 0，`now - 0 < 30` 也会返回 False，从而引导程序执行真实的 API 探测，而不会在读取阶段崩溃。

---

## 学到了什么

1. **不要在同一个表达式中混合使用 `.get()` 和 `[]` 来操作同一个 Key。** 如果你已经决定用 `.get()` 来检查存在性，那么后续的操作也应该通过 `.get()` 或在确认存在后立即将值赋给局部变量。

2. **状态缓存的“零值”比“空值”更安全。** 初始化一个带有默认值的结构，比维护一个可能为空的结构要简单得多，能避免大量重复的 `if not data: ...` 判断。

3. **CLI 工具的稳定性来自对边缘情况的预判。** 即使是一个简单的 `is_online` 检查，如果它处于所有命令的必经之路上，任何一个 KeyError 都会变成整个工具的致命伤。

```mdx
🎵 Listening companion
<NetEasePlay id="3986241" kind="song" />
```
