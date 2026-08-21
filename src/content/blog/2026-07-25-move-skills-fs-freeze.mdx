---
title: 当 skills-fs 挂载卡住导致整个 Linux 服务器无响应
description: 技能文件系统（skills-fs）冻结时，我们如何从锅底分析起，最终通过重启服务恢复系统的完整复盘。
date: 2026-07-25
tags: [linux, kernel, skills-fs, debugging]
draft: false
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 发生了什么

某个周五上午，所有需要接触磁盘的命令都开始超时 —— `du`、`find`、`ls`、`cat` 都没有即时返回，tmux 和 SSH 连接也毫无反应。

最后发现是 **skills-fs**（开发用的 FUSE 文件系统）卡死了，导致整个 I/O 管道阻塞。

## 检查顺序

```bash
$ df -h /
/dev/vda3   40G  38G   0B 100% /

$ top
load avg: 12.4  (空载应该 <1)

$ dmesg | tail -20
[XXX.XXX] EXT4-fs warning (device vda3): ext4_da_writepages: page allocation failed
```

## 解决步骤

**Step 1：先杀掉阻塞卡住的进程**

```bash
# fuser 找出谁在占用卡顿的文件
$ sudo fuser -km /skills-fs-mount
# 直接 logout 掉卡住 skills-fs 的用户 session
```

**Step 2：重启 skills-fs 服务**

```bash
$ systemctl restart skills-fs
# 或杀进程中所有卡住的 worker 进程
```

**Step 3：验证解除**

```bash
$ df -h /
/dev/vda3   40G  38G  2.0G  95% /
```
释放后给服务恢复正常。需要留一些磁盘余地。

## 经验总结

- **FUSE 文件系统是最弱的单点** —— 一个挂载卡住，系统一起完蛋
- **df 要留 10% 余量** —— ext4 在 100% 满的时候行为极其不稳定
- **用青龙面板+ Telegram 告警** —— 提前知道磁盘满了比被卡到 SSH 掉线要好得多
- **kill fuser -km 白金好用** —— 比硬重启伤害小很多

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />
