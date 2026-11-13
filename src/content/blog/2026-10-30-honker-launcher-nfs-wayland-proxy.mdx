---
title: 游戏启动器"卡住"是 NFS 冷缓存 + Wayland 视频流 + 代理分流三件事叠加
description: "10 月 30 号 Honkai: Star Rail 启动器打开就卡住，一度误判为存储或代理单点故障。实际是 NFS 冷缓存元数据校验、GTK4 GStreamer 视频流初始化阻塞、以及上游透明分流把米哈游流量送到境外节点，三件事叠加的结果。"
date: 2026-10-30
tags: [nfs, wayland, gstreamer, flatpak, proxy, openwrt, dns]
draft: false
summary: 启动器首次打开卡住是三个因素叠加：NFS 挂载冷缓存导致文件元数据校验等待、GTK4 GStreamer 在 Wayland 下报 `stream != NULL` 阻塞渲染线程、以及上游网关透明分流把 mihoyo.com 流量路由到美国节点触发米哈游风控拦截。第二次启动因热缓存命中不再卡。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 事件

2026 年 10 月 30 号，Honkai: Star Rail 的 Honkers Railway Launcher 打开就卡住，进度条转圈，主窗口不渲染。

## 坑

排查后发现不是单一原因。三件事叠在一起：NFS 挂载点冷缓存导致 `StarRail_Data/data.unity3d` 和音频包版本校验产生 I/O 等待；GTK4 GStreamer 在 Wayland 下报 `gtk_gst_media_file_source_setup_cb: assertion 'stream != NULL' failed`，动态背景视频初始化把渲染线程阻塞了数秒；上游网关的透明分流把部分 mihoyo.com 的 HTTPS 流量路由到美国节点，米哈游服务端把来源 IP 识别为境外代理，风控 SDK 直接拦截并弹"登录遇到问题，网络连接不稳定，请检查代理设置后重试"。第二次启动不再卡，是因为文件系统命中热缓存，GStreamer 流已初始化，只剩代理分流这一个真正需要修的问题。

## 修复

代理分流是核心问题：检查 doesrouter 上的路由规则，把 `*.mihoyo.com` 和 `*.starrails.com` 域名强制设为 DIRECT，走境内出口。重启 launcher 后登录和网关分发请求正常。NFS 冷缓存和 GStreamer 初始化是首次启动的固定开销，不需要单独处理。

## 经验

游戏启动器"卡住"往往不是单点故障。排查顺序：先确认是否首次启动（热缓存 vs 冷缓存），再看日志里有没有 GStreamer 或 Wayland 相关的 assertion 失败，最后才看网络。NFS 挂载的游戏目录首次访问的元数据开销是固定的，不用修。真正的长期问题往往是代理分流，把游戏域名设成 DIRECT 即可。

🎵 Listening companion
<NetEasePlay id="31370543" kind="song" />
