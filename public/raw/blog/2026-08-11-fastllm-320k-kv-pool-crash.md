---
title: 在 V100 上把 FastLLM 压到 320K：KV 池、MTP cache 和一个 device-side double-free
description: 8 月 11 号在 32GB V100 上跑 FastLLM (VastLLM 分支)，冲 320K 上下文时掉进 `CudaAppendPagedCacheOp failed to launch multi-page copy`。根因不是多模态或 YaRN，是三个各管一段的 KV 池层级里，MTP cache 的析构路径跟请求级 KV cache 一起 double-free 了同一个 device pointer。
date: 2026-08-11
tags: [fastllm, cuda, v100, kvcache, mtp, vllm]
draft: false
summary: 诊断 VastLLM 分支 FastLLM 在 320K context 下的 system crash。三个 KV 池层级（req-level pastKeyValues + 全局页池 + MTP cache）各自管理 device buffer 时没把 ownership 关系串对，导致 MTP cache 析构释放了 request KV 仍持有的 GPU buffer——NVIDIA 的 device-to-device 拷贝直接报错。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】8 月 11 号，多模态版本医疗后准备冲 YaRN

FastLLM 的多模态修复版已经验证通过——长 prefill 从 6 chunks 到 70 chunks，图像+长文本也都不崩，峰值 23-25 GB 远在 32.8 GB ceiling 以下。

下一步：在不启用 YaRN 的情况下，裸冲 320K（327,680 tokens），看 bare metal 上显存能撑多远。

## 事件

V100（32 GB PCIe）上的配置：
- 模型：Qwen3.5-2B-Instruct，量化 q8_0
- Turbo3 paged KV：K=q8_0, V=turbo3, head_dim=256
- Prefix-persist 复用前缀 cache
- MTP head：Multi-Token Prediction，额外维护一个 per-sequence 的 MTP KV cache
- 请求路径：`interleaved long prefill`，chunk=2048, decode_lanes=1, resident_lanes=1

整个 pipeline 之上又叠了 image encoder 的 emebedding 传递。

## 坑：CudaAppendPagedCacheOp 在预热期直接炸

发了 327,680 tokens 的请求之后，日志：

```
[FastllmCudaCopyFromDeviceToDevice] line 5495 failed:
  CudaAppendPagedCacheOp failed to launch multi-page copy
backtrace:
  ...
  <MtpKvCache unique_ptr dtor chain>
  FastLLM device-side page table corruption
```

不是 CUDA illegal memory access（不是越界），是**device-to-device 拷贝直接 launch failed**。这个 "multi-page copy" 操作在 FastLLM 里是把一个 sequence 的 KV 页追加到 prefilling 的 KV pool 末尾 —— 看上去简单，但 kernel launch 前提是 source buffer 还 alive、destination 有足够 room。

8 层 backtrace 信息全是 unknown——典型的 **CUDA kernel launch failure 被 cuda-gdb 截回**，因为真正 fatal 的是 device-side page table 被污染，NVIDIA driver 直接丢弃。

## 根因：三层 KV 池的生命期没有串成单 all-thread

放错概括：

```
┌─────────────────────────────────────────────────────────┐
│                    KV Cache Hierachy                     │
│                                                         │
│  Layer 1: pastKeyValues (per-request)                   │
│    └─ GpuKVCache block A device pointer [OWNED]         │
│         ├─ count: 1  ▽                                  │
│         └─ request 释放时 auto Release()                │
│                                                         │
│  Layer 2: Global Page Pool                              │
│    └─ GpuKVCache block N ...                            │
│                                                         │
│  Layer 3: MtpKvCache (per-sequence, extra)              │
│    └─ GpuKVCache block B (shallow COPY of block A!)     │
│         └─ count: 1 但 pointer 指向同一个 A            │
└─────────────────────────────────────────────────────────┘
```

MTP cache 在构造时 did a `std::move` 浅拷贝——"我把 request 的 KV cache 借来用"。但没有设置 ref-count 或者 ownership flag。两个对象之间没有约束谁先释放。

**请求完成 → layer 1 先 Release block A（假 device pointer）→ layer 3 dtor 拿到同一个 A 再次释放 → device-side double release → corrupt page table → CudaAppendPagedCacheOp failed**。

这是一个典型的 C++ move-semantics 在 GPU device buffer 上的坑。shared_ptr 在 host 上会自动处理引用计数，但在 GPU 上的 raw device pointer 走不到这一层——这些 buffer 是 `cudaMalloc` 出来的裸指针，被两个 std::unique_ptr 各管一个，互相看不见对方的计数。

## 投到的 bug 2：thinking_proxy on_event 让 backend 没 ready

同一次压测还有一个间接坑——`thinking_proxy.py`（Papyrus 的 Python 辅助代理）用：

```python
@app.on_event("startup")
def start_backend():
    start_fastllm_subprocess()
```

FastAPI 在 21.x 版就已废弃 `on_event`，推荐用 lifespan。`on_event` 的启动时机在 app object 创建之后、但第一 request 进来之前——**但不先 wait for the backend to report READY**。

`GET /health` 返回 200，但 backend 实际在做模型权重加载——kernel 的 context 还没 fully setup。这时候长 prefill 请求进来，被路由到 backend，CUDA 的 kernel launch 拿到了半 ready 的 context。Not crash on its own, but it adds variance: 每次热启动的 buffer state 都不同，复现 320K crash 的窗口更窄（只有在 cold start + long prefill combo 才触发 MTP cache double-free）。

修复：换成 lifespan handler，backend 在 startup 阶段 block，直到 `health=True + model_loaded=True` 才 `yield`。

## 坑 3：修复 OOM 时意外删了 prefix-persist 和 zstd

第一次调多模态和长上下文时把 chunk 从 4 改到 70，团队排查期间有两个人同时改 `training_method=our_branch`（ FastLLM 的 checkpoint 加载代码）——其中一轮改动把 prefix-persist 和 zstd compression 的另两行也一并删掉了。

删了之后的表现：
- prefix cache 失效——每一个长请求都是冷 prefill，KV cache 全空从零算
- zstd compression 掉了——请求放回 KV cache 的压缩格式变了，模型接收到非压缩的 KV buffer 时，- KV 池的大小上限徒增一倍

本身 KV pool 管理 bug 在 320K 才触发—— prefix-persist 的失效让 KV pool 瞬间被冷请求填满，本来 240K 左右才到阈值，在零前缀条件下提前到 120K，the MTP cache double-free 撞上了更"饱满"的 pool，两件事叠加更容易命中。

而这个根因在 layer 1 的"为什么 MTP cache 没有被计数"之上。

## 修复

**1. Ownership graph 明确**

伪代码：

```cpp
// BEFORE (broken)
class RequestKV {
  std::unique_ptr<GpuKVCache> kv_cache;  // owns block A
  std::unique_ptr<MtpKvCache> mtp_cache; // shallow-copies A from kv_cache
};

// AFTER (fixed)  
class RequestKV {
  std::unique_ptr<GpuKVCache> kv_cache;     // owns block A
  MtpKvCacheHandle mtp_cache;               // non-owning handle (raw device ptr)
  
  ~RequestKV() {
    if (kv_cache) kv_cache->Release();  // block A is released exactly once
    // mtp_cache holds a raw ptr, has no deleter
  }
};

class MtpKvCache {
  GpuKVCache* borrowed_block;  // raw pointer, NOT owning
  // ... owns ONLY its internal MTP projection cache
};
```

核心思路：**"借用"和"拥有"用两种类型分开**。带 device 指针的资源，深拷贝的 owner 永远唯一。

**2. FastAPI lifespan**

```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.backend = await wait_for_backend_ready()  # block until ready
    yield
    await cleanup_backend()
```

**3. 恢复 prefix-persist + zstd 的两行**——加了 diff 检查，确认哪些是"原来 codebase 就有"，不是盲加。

## 结果

- long-prefill 200 requests, 70 chunks each: 全通 ✓
- img+long 200 requests: 全通 ✓  
- 240K + MTP: 稳定 ✓ (320K 仍需进一步 bench)
- backend: gen 1 无 reload ✓
- 峰值显存 24-25 GB，离 32.8 GB ceiling 仍有空间

这次 crash 暴露的不是"debug long prompt"的场景——是 KV pool 设计上的 ownership bug，在任何超长 context 的场景下都会触发。320K 只是刚好是上下文长度大到暴露了这个问题的边界。

## 经验

- **带 device pointer 的 C++ 对象，shared_ptr / unique_ptr 的析构路径在有浅拷贝的情况下要加 ownership audit**。用 raw pointer（handle）表示"借用"，而不是 shared_ptr 或 shared reference——否则在多层级释放时 double-free 无可避免。
- **Prefill chunk 大小影响 KV pool 水位**：chunk 从 4 改到 70 减少了 round-trip，单个请求的 KV cache 峰值反而高——chunk 大，每轮 prefill 阶段的 KV 填充都多。KV pool water mark 在 chunk size 增大时跟着涨，这不是 bug，但调参时必须一起看。
- **lifespan 换掉 on_event 不是样式漂亮**——当你的 backend 启动时间是 5 秒以上（模型加载 + allocate 16GB VRAM），`on_event` 的语义是"启动函数跑了就能收请求"，但 5 秒模型根本没 load 完。lifespan + `await` backward-ready 保证的是 request 进来时 model 已经 available，否则 HTTP 503 reject，正确的行为。
- **多个人同时改一个文件，git 的 blame 变成历史学家的工作**——prefix-persist 被删的那一次，就是两个人改同文件没开锁。用 git 的 pre-push hook 或者 CI 里加 `git diff HEAD~1 -- <file> | diff-filter=M` 检测"被谁在什么时候删了关键逻辑"可以提前报警。

🎵 Listening companion
<NetEasePlay id="4084037" kind="song" />
