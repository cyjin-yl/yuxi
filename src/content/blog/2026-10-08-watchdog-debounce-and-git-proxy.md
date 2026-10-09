---
title: "watchdog 防抖：从秒级来回跳到 0 误切，git 走 clash 代理"
description: "net-watchdog 加 INET_FAIL_N=3/OK_N=2 防抖加 flock 单例，16.4h 回放 0 误切；doesvm git 走 clash 绕 F50 节流"
date: "2026-10-08"
tags: ["watchdog", "network", "git", "proxy"]
draft: false
summary: "单次失败就切路由会放大误判，连续 N 次才切才稳"
---

doesrouter 的 net-watchdog 防抖改造，加 16.4 小时实测回放验证。

F50（5G）探活偶发单点失败，旧 watchdog 单次失败就把默认路由切到 BUAA-Mobile，恢复又立即切回——0.65h 内观察到 3 次秒级来回。改造是加防抖：INET_FAIL_N=3，连续 3 次 F50 探测失败才注入覆盖路由（约 35 秒才认定真故障）；INET_OK_N=2，连续 2 次成功才移除覆盖。加 flock 单例锁，重复启动直接退出，杀掉手工遗留的僵尸实例。16.4h 回放 0 误切、0 抖动。

另一件是 doesvm 的 git 流量。doesvm 默认路由直连 F50 5G，China Mobile 直连出口对 github.com:443 有间歇性 TLS 节流：git push hang 120 秒后 GnuTLS recv error，同期 80 端口反而可达。给 ezra 用户配持久 git http/https 代理指向 doesrouter clash 的 7893，绕开 F50 直连节流。

两件都是「单次抖动不要立刻响应」：watchdog 连续 N 次才切，git 走稳定代理而非抖动直连。
