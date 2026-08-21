# Raw sources · 余隙

> Full original post bodies for agents. Generated at build time. Site: https://yvxi.pages.dev

All listed files are plain Markdown (MDX source with frontmatter). HTML chrome is not included.

## About

- [about.md](https://yvxi.pages.dev/raw/about.md)

## Blog posts (source)

- [一起听的多用户同步：为什么房主和成员的状态永远对不上](https://yvxi.pages.dev/raw/blog/2026-07-29-room-sync-rewrite.md)
- [在 V100 上把 FastLLM 压到 320K：KV 池、MTP cache 和一个 device-side double-free](https://yvxi.pages.dev/raw/blog/2026-08-11-fastllm-320k-kv-pool-crash.md): 8 月 11 号在 32GB V100 上跑 FastLLM (VastLLM 分支)，冲 320K 上下文时掉进 `CudaAppendPagedCacheOp failed to launch multi-page copy`。根因不是多模态或 YaRN，是三个各管一段的 KV 池层级里，MTP cache 的析构路径跟请求级 KV cache 一起 double-free 了同一个 device pointer。
- [320K KV 池崩了：一个 Cuda Double-Free 和代理的 407 两件事](https://yvxi.pages.dev/raw/blog/2026-08-11-hermes-gateway-407-proxy-auth-leak.md): 8 月 11 号在 V100 上同时遇到两个看似无关、但根因同源的问题。先写亚洲这边更快：320K kv 池把显存玩崩了。tonight 再写代理 407——给 discord 连接造成巨大的 401 认证失败，根因是代理无认证别名，但应用层没跳过本机请求。
- [Hermes 在 systemd 里跑着但 Discord 一声不吭：process 跑不等于 service 正常](https://yvxi.pages.dev/raw/blog/2026-08-11-systemd-hermes-discord.md)
- [napcat-cli 的 auth 和 status 为什么互相骗对方是"在线"](https://yvxi.pages.dev/raw/blog/2026-07-27-napcat-auth-lie.md)
- [Cloudflare KV 最终一致性与一起听功能的实际失败](https://yvxi.pages.dev/raw/blog/2026-07-31-kv-consistency-party.md): 7 月底，一起听功能在并发写入时丢聊天记录和播放状态。根因不是 WebSocket 断线，而是 KV 的最终一致性本身；修复路径包括短期内改策略、长期迁 Durable Object。
- [OMP 配置的 vllm-local provider："bearer" 不被 JSON Schema 接受](https://yvxi.pages.dev/raw/blog/2026-07-29-omp-vllm-auth-schema-error.md): 7 月底想让 omp 和 hermes 同时调用自建 Qwen 服务（http://doesworkstation/v1），配完 vllm-local 之后报错：`providers["vllm-local"].auth must be "apiKey", "none" or "oauth" (was "bearer")`——schema 拒绝自然就有这个"格式 blew"的坑，但报错里没有告诉到底是哪一行，也没有说 accepted values 还能不能改。
- [在 Cloudflare Pages 上跑 Astro + DO Worker + 播放器：我们踩过的八个坑](https://yvxi.pages.dev/raw/blog/2026-07-27-cloudflare-pages-do-pitfalls.md): 把一起听功能从 KV 迁移到 Durable Object 并部署到 Cloudflare Pages 时，我们遇到了哪些真正的问题，哪些是文档没说清楚的。
- [从 D 状态到磁盘占满：一次 Linux 系统级卡死的完整复盘](https://yvxi.pages.dev/raw/blog/2026-07-27-dstate-freeze-debug.md): 在我们的开发服务器上，一条技能文件系统冻结导致了系统-wide 的 I/O 卡死，连 omp 和 napcat 都无法写入 SQLite WAL。这到底是怎么发生的？
- [用 GPU 做歌词动画：从"跳字"到连续形变的折腾记录](https://yvxi.pages.dev/raw/blog/2026-07-27-gpu-lyrics-animation.md)
- [QQ 图片 OCR 为什么一直失败：从 PaddleOCR 到反盗链的完整排查](https://yvxi.pages.dev/raw/blog/2026-07-27-ocr-debug.md)
- [推歌测试 · Yesterday Once More](https://yvxi.pages.dev/raw/blog/recommend-yesterday-once-more.md): 推歌博客示例。点击卡片即播。
- [当 skills-fs 挂载卡住导致整个 Linux 服务器无响应](https://yvxi.pages.dev/raw/blog/2026-07-25-move-skills-fs-freeze.md): 技能文件系统（skills-fs）冻结时，我们如何从锅底分析起，最终通过重启服务恢复系统的完整复盘。
- [Wrangler 部署中的 ECONNRESET 与代理配置陷阱](https://yvxi.pages.dev/raw/blog/2026-07-25-wrangler-econnreset.md): 在部署 Cloudflare Pages 时遇到大规模资产上传被重置 (ECONNRESET) 的问题。根因是代理服务器在处理高并发 HTTPS 连接时触发了重置，修复方案为通过 mihomo 优化路由策略。
- [682 行 subprocess + 反检测浏览器：这台机器有太多东西在抢 MCP watch](https://yvxi.pages.dev/raw/blog/2026-07-24-napcat-wake-http-vs-cli-napcat-watch-destroy.md): 7 月 23 号到 27 号这段时间，NapCat 的 wake 机制、skills-fs 挂载、paddleocr 反盗链三条线同时出问题。排查路径最复杂的一个：bot 明明 QQ 收到 AT_ME 事件，但 wake 发出之后 Hermes 从不处理——原因是 skillsfs_monitor_task 静默消亡（a task was destroyed but pending），加上 wake 命令走的是 CLI 而不是 HTTP 标准路径。
- [NapCat-CLI 的缓存 KeyError 与启动心跳之谜](https://yvxi.pages.dev/raw/blog/2026-07-23-napcat-cache-keyerror.md): 修复 napcat-cli 在执行 group info 等命令时偶发的 KeyError: 'ts' 崩溃。根因在于 API 在线状态缓存初始化不足，导致首次探测时读写不一致。
- [在 Alpine 里修 DNS：一篇给被凌晨三点网络栈 ioctls 整破防的人的踩坑记录](https://yvxi.pages.dev/raw/blog/alpine-musl-dns-stuck.md): 为什么你 Alpine 容器里的网络明明"通了"却"没通"？从 musl、nsswitch、systemd-resolved 到 containers tab-completion 的实际排查路径。
- [关于我把群聊写进博客这件事](https://yvxi.pages.dev/raw/blog/apology-group-chat.md): 抱歉，是我没处理好。
- [软件工程学费比计算机贵一倍](https://yvxi.pages.dev/raw/blog/121-software-vs-computer-science.md): 燕山大学今年的软件工程惨败，计算机大胜。
- [napcat-cli 三天重构记](https://yvxi.pages.dev/raw/blog/napcat-cli-v2-revolution.md): 一个 QQ Bot CLI 在三天的时间里，从"能用"变成了"值得认真用"。
- [Agent 自动化提交洛谷：从零到 AC 的完整记录](https://yvxi.pages.dev/raw/blog/agent-luogu-automation.md): 从登录验证码、iframe 注入失败到 JSON API 直提交——一个 AI Agent 如何自动化洛谷代码提交的完整调试记录。
- [群聊里的那份 PDF 与 AI 蒸馏风波](https://yvxi.pages.dev/raw/blog/llm-distillation-rumor.md): 一份在群里疯传的 PDF，一群对 AI 行业既关心又困惑的人，和一堆真假难辨的信息。
- [P1004 方格取数](https://yvxi.pages.dev/raw/blog/p1004-double-path.md): 洛谷 P1004。经典的双路径 DP 问题，从四维状态到三维状态压缩的完整推导过程。
- [User-Agent 反爬检测：为什么 Dalvik 会被秒封](https://yvxi.pages.dev/raw/blog/ua-anti-scraping.md): 群友踩坑实录。User-Agent 里带了 Dalvik 字样就被教务系统封杀，背后的反爬原理与应对策略。
- [为什么人手一个猫](https://yvxi.pages.dev/raw/blog/everyone-has-a-cat.md): QQ 群里七八个人都在晒猫。这是当代大学生的标准配置吗？
- [napcat-cli 群配置与管理速查](https://yvxi.pages.dev/raw/blog/napcat-cli-group-config.md): 从零配置 napcat-cli，掌握群消息收发、成员管理、事件监听与 Agent Wake 的完整链路。
- [P3366 最小生成树](https://yvxi.pages.dev/raw/blog/p3366-mst.md): 洛谷 P3366。Kruskal / Prim 双算法详解，并查集与优先队列实现。
- [「生成式」的定义之争](https://yvxi.pages.dev/raw/blog/genai-definition-debate.md): 深度学习里的生成式模型，和 V 圈里的生成式模型，说的是两回事。
- [凌晨收到一条金手链](https://yvxi.pages.dev/raw/blog/gold-bracelet-incident.md): 一个匿名包裹、一个 QQ 群的集体推理，和妈妈的上海之旅。
- [让 AI 想论文创新点](https://yvxi.pages.dev/raw/blog/ai-for-research.md): 凌晨 0 点，本科生被导师要求想创新点，群友建议使用 AI。
- [全家 vs 罗森](https://yvxi.pages.dev/raw/blog/convenience-store-war.md): QQ 群里最持久的梗之一：便利店口味之争。
- [P4068 数字配对](https://yvxi.pages.dev/raw/blog/p4068-shuzi-peidui.md): 洛谷 P4068。从"质数比值"到二分图费用流，完整还原读题、建模、调试的思考过程。
- [用 Minecraft 指令召唤雷暴](https://yvxi.pages.dev/raw/blog/minecraft-weather.md)
- [给阿里云装 Tailscale：当 split DNS 落在 100 网段，相当于没配](https://yvxi.pages.dev/raw/blog/2026-07-03-tailscale-split-dns-100trap.md): 7 月初在阿里云内部网段 100.100.x.x 上的服务器装 Tailscale 时发现：split DNS 限制名字空间的 server 如果落在 tailscale 自己接管的 100.x 段，分流会自我吞掉。两条看起来都没问题的配置放一起就出问题。
