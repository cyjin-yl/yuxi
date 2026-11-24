---
title: CAS 回调契约缺口：CGI 路径参数修复，PR171 合入
description: 2026 年 11 月 10 号把 BUAA CLI 的 shuttle CAS 回调契约缺口修掉——CGI 路径参数升级，PR171 合入 main（dac1a78），独立评审，九项复测全绿。
date: 2026-11-10
tags: [cas, cgi, cli, auth, debugging]
draft: false
summary: shuttle CAS 回调契约缺口的修复：CGI 路径参数升级，PR171 合入 main（dac1a78），经独立评审、九项复测全绿。physics 按用户裁决保持离线。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 11 月 10 号，shuttle CAS 的回调契约缺口被修掉，PR171 合入

那天在 BUAA CLI 上做在线验证，shuttle CAS 的回调有一个契约缺口。修复是 CGI 路径参数升级，走 PR171，合进 main 之后是 dac1a78。

## 事件

目标是让所有 BUAA CLI 功能通过在线验证。CAS 统一认证打通了 exams、yjsxk、gsmis、ihome、博雅五个服务的真实登录链路，但 shuttle 的回调在契约上有个缺口——service ticket 的回调路径参数处理方式不对。

## 坑

CAS 的 service ticket 校验走 CGI 回调，契约上对路径参数的处理有约定。原实现把 ticket 放在查询参数里，而服务端回调要求它出现在路径参数上，导致契约对不上、验证链路断掉。这种坑不是"少写一个花括号"能解释的，而是 CGI 的参数放置位置（query string vs path segment）和 CAS 回调契约不一致。

## 修复

把 shuttle CAS 回调的 CGI 改成路径参数（path-parameter upgrade），契约对齐之后，PR171 合入 main（dac1a78），经独立评审、所有发现项都解决，九项复测全绿、无缺陷。physics 的能力按用户裁决保持离线-only。

## 经验

CAS 这类统一认证的集成，契约缺口往往藏在"参数放哪"这种细节上——query string 还是 path segment，服务端回调只认其中一种。修复要对齐契约而不是绕过去。九项复测全绿才算收口，physics 这种用户明确要离线的，保持离线-only 不要自作主张去开。

🎵 Listening companion
<NetEasePlay id="26109352" kind="song" />
