---
title: 不重启 VM 就把 USB Hub 和声卡直通修好
description: 2026 年 11 月 6 号到 7 号，Fedora VM 里的 USB 集线器和 ROUTIST R2 声卡掉出来了，用不重启 VM 的方式在线修好，还顺手把之前挂起的 Proto-UI 席位用 SIGCONT 唤醒。
date: 2026-11-06
tags: [linux, vfio, usb, passthrough, pve, systemd]
draft: false
summary: USB Hub（山泽 USB3.0 四口）和 ROUTIST R2 声卡直通掉线，用不重启 VM 的方式在线修复并验证有声；之前被挂起的 Proto-UI 席位用 SIGCONT 恢复而不是重启 VM。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 11 月 6 号，Fedora VM 里的声卡和那个 USB Hub 都不见了

插上的是山泽的 USB3.0 四口 Hub，但 Fedora 里看不到，声卡和 Hub 都没被直通进去。修复的目标很明确：不重启 VM，在线把这两样东西的直通修回来。

## 事件

USB 集线器和 ROUTIST R2 声卡掉出了直通。当时还有一件相邻的事：Proto-UI 席位是之前被挂起（suspend）的，不是崩了。

## 坑

这类问题的第一反应往往是"重启 VM 最省事"，但重启会把它拖起来的所有 agent、tmux 会话、正在跑的任务全部杀掉。这台宿主机上挂着一堆活的 agent 和会话，重启一次代价很大。另一个容易搞错的点是"席位不见了"——它其实是被挂起（suspend），不是死了，重启反而会把它真正杀掉。

## 修复

用不重启 VM 的方式把 USB 集线器和声卡的直通在线修回来，出声确认之后才算完成。Proto-UI 席位用 SIGCONT 恢复（让它继续跑之前挂起的那个进程），而不是重启 VM。两件事都是"在线恢复"而非"重启兜底"，修复经验提交并推送到 Life。

## 经验

直通设备掉线，能在线恢复就别重启 VM——重启会把整台机器上所有活的 agent 和会话一起拖下水。区分"被挂起"和"被杀死"很关键：挂起用 SIGCONT 唤醒就够了，误判成崩溃去重启才是真的把它杀了。能在线恢复的修复，价值就在于它没有代价。

🎵 Listening companion
<NetEasePlay id="17670028" kind="song" />
