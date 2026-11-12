---
title: Arc A380 直通 256MiB BAR2：GNOME"自动退出"其实是 gnome-shell 段错误
description: 2026 年 10 月 22 号排查 GNOME 的"自动退出"，根因不是息屏策略，而是 Arc A380 直通后 BAR2 只有 256MiB——Resizable BAR 没开。写了 Mesa Iris 的 null-guard 补丁修掉段错误。
date: 2026-10-22
tags: [linux, pci, vfio, mesa, amdgpu, debugging]
draft: false
summary: GNOME"自动退出"表象下是 gnome-shell 段错误，根因是 Arc A380 直通 BAR2 仅 256MiB（未启用 Resizable BAR）。治本要在宿主 BIOS 开 ReBAR，先用 Mesa Iris null-guard 补丁修掉崩溃并验证桌面稳定。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 10 月 22 号，GNOME 反复"自动退出"，查到最后是显卡 BAR 空间的问题

桌面频繁"自动退出"，一开始以为是息屏或电源策略。查下去发现是 gnome-shell 在段错误，而根因是 Arc A380 直通之后 BAR2 只有 256MiB——Resizable BAR 没有启用。

## 事件

GNOME 的"自动退出"看起来像是电源管理在踢人，实际上 gnome-shell 在段错误。顺藤摸到显卡：Arc A380 直通到 Fedora，BAR2 只分配了 256MiB，因为 Resizable BAR 没开。

## 坑

消费级显卡为了兼容老机器，默认只报 256MB BAR，Resizable BAR 的作用就是让 UEFI 在枚举 PCIe 时去读 0x0015 的扩展能力寄存器、把窗口改大再分配地址。这台宿主机是 H11SSL-i，本来就是原生带 Above 4G Decoding 的服务器主板——插那些出厂硬编码 16G/32G BAR 的计算卡一点毛病都没有，说明 EPYC 的 Root Complex 和 64 位 MMIO 在硬件上根本不缺东西。可 AMD 没把这点 ReBAR 枚举代码合进 H11 分支，还在官方 FAQ（42887）里把它说成是 EPYC 7001/7002 的硬件限制、得换 H12SSL-i 才能支持——但 H12 本来就能插 7002，友商的 ROMED8-2T 也能开，甚至在 H11SSL-i 上塞个 ReBarUEFI 模块、或者干脆用内核侧的 workaround，都绕得过去。把"自动退出"当成电源策略去调，是永远修不好的，因为它根本不是电源问题。

## 修复

治本是宿主 BIOS 开 Resizable BAR，但那一步被搁置（BMC 接线和 UEFITool 路线还没定）。先用 Mesa Iris 的 null-guard 补丁修掉段错误本身：桌面在打过补丁的驱动上稳定运行，补丁发到 github.com/cyjin-yl/mesa-iris-bo-map-null-guard，并确认发出的版本是安全版、不需要回滚。

## 经验

GPU 直通后桌面崩溃，先怀疑 BAR 空间而不是电源策略。"自动退出"是表象，gnome-shell 段错误是中间层，256MiB BAR2（ReBAR 没开）才是根因。治本在 BIOS 开 ReBAR，治标用 Mesa 的 null-guard 补丁先让桌面稳定。分清这三层，才知道该去动 BIOS 还是该去打驱动补丁。

🎵 Listening companion
<NetEasePlay id="4278804" kind="song" />
