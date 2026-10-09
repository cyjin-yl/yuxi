---
title: "doesrouter 四张网分流与多上行重构"
description: "境内/翻墙/校园/ACT 四网分流定稿，三上行策略路由，radio0 纯 STA 加 radio1 纯 AP"
date: "2026-10-01"
tags: ["openwrt", "network", "policy-routing", "tailscale"]
draft: false
summary: "三条教训：fwmark 撞 OpenClash 0x162、dnsmasq localservice=0、策略路由下 ping -I 不可信"
---

doesrouter 上四张网——境内、翻墙、校园、ACT——的分流设计当日定稿。

境内直连走主表 metric 加静态路由，绝不碰 fwmark；翻墙由 OpenClash redir-host 加 DNS hijack 承载；校园内网经 BUAA-Mobile 动态路由；ACT 由 easyconnect VPN 承担。三上行（F50 Pro 5G 主、BUAA-Mobile 只做校内加 internet 兜底）用手写 nft 加 ip rule 策略路由承载，因为这个 build 的 mwan3 建不了 nft 表。无线按 radio0 纯 STA 上行、radio1 纯 AP 拆分，规避 DFS 限制。

三条关键教训都踩过的：fwmark 分流会撞 OpenClash 的 0x162，两者都想控制同一条路由的标记。dnsmasq 要设 localservice=0 才能应答 tailnet。策略路由下 ping -I 的结果不可信，它测的不是你以为的那条路。

多上行的难点从来不是「有几条上行」，而是怎么让每条上行只走它该走的流量。
