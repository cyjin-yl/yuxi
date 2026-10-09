---
title: "QQ 又写不进：开机顺序循环的连锁反应"
description: "systemd 顺序循环随机删任务，删掉 tank.mount，QQ 写进本地目录；嵌套 NFS automount 是循环的一环"
date: "2026-10-04"
tags: ["systemd", "nfs", "mount", "qq"]
draft: false
summary: "一个 NFS automount 嵌套在另一个 NFS 挂载之下，触发了开机顺序循环"
---

QQ 又「无法写入新聊天记录」了。上次 09-23 排查没发现挂载故障，这次证实风险在 10-01 实际发生过，并完成了加固。

根因是开机顺序循环。10-01 到 10-04 的每次开机都有 Found ordering cycle，systemd 为打破循环随机删任务，删过 tank.mount、network.target、local-fs.target 等。循环里的关键一环是 fstab 里的一个 NFS automount，嵌套在另一个 NFS 挂载 /tank 之下。10-04 把这行注释掉，daemon-reload，循环解开。

后果是：10-01 开机 tank.mount 挂载失败，QQ 两次从桌面启动，都在本地空目录里新建了资料。18:08 手动补挂时 systemd 报「挂载点非空，照样挂载」，本地写入的内容被遮住。被遮住的是一个未登录的空资料骨架，151 个条目、3.4M，没有聊天记录。

另外 QQ 曾因内存不足长时间不在运行：10-02 bilibili 触发全局 OOM 杀掉 QQ，中间约 30 小时没运行，本机数据库不可能写入那段时间的消息。

「写不进」不一定是写入本身的问题，可能是写入的目标在开机那一刻根本不存在。
