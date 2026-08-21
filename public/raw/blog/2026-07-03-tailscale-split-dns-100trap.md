---
title: 给阿里云装 Tailscale：当 split DNS 落在 100 网段，相当于没配
description: 7 月初在阿里云内部网段 100.100.x.x 上的服务器装 Tailscale 时发现：split DNS 限制名字空间的 server 如果落在 tailscale 自己接管的 100.x 段，分流会自我吞掉。两条看起来都没问题的配置放一起就出问题。
date: 2026-07-03
tags: [tailscale, dns, networking, aliyun]
draft: false
summary: 阿里云内部用的 100.100.2.136 是服务发现 DNS，给同一段装上 Tailscale 后，split DNS 的 nameserver 反而被 tailscale 接管而无法走通。这解释了为什么"按文档配置但完全没生效"。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 7 月 3 号，在阿里云内部的服务器上装 Tailscale

那台机器跑在阿里云中国区，平时依赖 `100.100.2.136` 这个内部 DNS 来做服务发现——跨 ECS 调用、镜像源、metadata 全靠它。我为了让上层几台机器互通，决定在这台上面装上 Tailscale，并启用 DERP / exit node，但刚一上就发现：metadata 接口、内网域名解析全断。

## 事件

起手是层层"我先按文档照做"的局：

1. 装 Tailscale（apt 装 Go，再 `go install`），`tailscale up` 拨号正常，peer 列表通。
2. 在 Tailscale 的管理控制台给这台机器配置 **split DNS**——把 `*.aliyuncs.com`、`*.internal` 这些内网域名指向 `100.100.2.136`，让 Tailscale 只对这部分后缀走阿里云的 DNS，其他走默认。
3. 强调一下：split DNS 的 "Use with exit node" 是勾选上的，文档说"该 nameserver 在选中 exit node 时仍会被使用"。

预期：Tailscale 接管日常 DNS，但内网名字仍由阿里云自己的 `100.100.x` 解析。实际：`curl http://100.100.x.x/latest/meta-data/` 一律超时，name 解析全空。

## 坑：split DNS 的 NS 自己被 tailscale 接管了

排查了一阵才发现根因——**100.100.2.136 这个 DNS 服务器，IP 落在 Tailscale 自己接管的 `100.64.0.0/10` 段里**（tailscale 默认子网）。

Tailscale 的_split-DNS 文档预设 nameserver 是个外部地址，配完后系统会在路由表里加指向 nameserver 的路由。可一旦 nameserver 本身落在 `100.*`，Tailscale 的子网路由就会先把这个地址拉进 tailscale 接口。结果：

- 应用查 split DNS 时，系统把 DNS 查询发往 `100.100.2.136`
- 这个地址被 tailscale 视作要进 overlay 网络的 peer，而不是直连的内网接口
- 查询被丢进尾云里，没有对应的 peer，于是空响应 / 超时

这不是 split DNS 不工作，是 split DNS 的**前置条件不满足**：nameserver 必须对 tailscale 可达，且**不能在 tailscale 接管的 IP 段里**——文档没把这条限制写明。

另外有个看似可救的方向：在 Tailscale 客户端用 netfilter mode off，让它不设防火墙规则。这条路不行——关闭 netfilter 模式会同时剥掉 DERP 中转和地址接管的 iptables 配置，这台机器本来要给我们几台机器当 DERP 中继，关 netfilter 等于关掉了关键能力。

## 修复：换路由策略而非关 Tailscale

最后落到两种可行思路：

**思路 A（更稳）**：在控制台彻底不用 split DNS，而是给这台机器配两个上游 resolver——主用公共 DNS（阿里云的除掉 `100.x` 那个；或者 233 / 119），把 `/etc/resolv.conf` 里保留一份指向 `100.100.2.136` 的回退，但显式地把这个地址加到 `/etc/sysctl.conf` 里一条 `sysctl net.ipv4.conf.<iface>.rp_filter=0` 加反向路由策略，确保去往 `100.100.2.136` 的流量走真实网卡 eth0 而不是 tailscale0。

关键命令（在 Debian 13 上）：

```bash
# 1. 不让 tailscale 把 100.100.2.136 拉进路由
sudo ip rule add to 100.100.2.136 table main priority 100
sudo ip route add 100.100.2.136 dev eth0 table main

# 2. 给 tailscale 自带路由打个例外
sudo tailscale up --accept-routes=false
```

如果 tailscale `--accept-routes` 默认是开着，会被 admin 控制台下发的子网路由覆盖；本机不接，等于保留直连。

**思路 B**：用 Tailscale 的 `--exit-node-allow-lan-access` 或在控制台 split DNS 配 "Restrict to domain" 只留 `*.aliyuncs.com`，并把 nameserver 换成一个不在 `100.x` 段的中间 resolver（在同段附近开一个 dnsmasq 转发到 `100.100.2.136`，让 tailscale 看到一个 `10.x` 或 `172.x` 地址）。本质上把"在 100 段里"这件事通过中间 resolver 藏起来。

我最后选了思路 A，因为思路 B 要再多开一个 daemon，不如把路由一次性写清楚。

## 经验

- **Split DNS 不是"两个独立 namespace 不打架"那么简单**。它有个隐含的真实约束：NS 地址必须在 tailscale 当前路由下可达且不被 tailscale 接管。任何落在 `100.64.0.0/10` 里的地址都需要显式排除。
- **Tailscale 的子网接管是网段级而非地址级**——目前没有 "排除单个 IP" 的内置开关。我们能做的只是 `--accept-routes=false` 在客户端层面不接收来自 control plane 的子网路由下发，或者在主机路由表里加 `ip rule` 抢在前面。
- **netfilter mode off 不是"我只想让 tailscale 挡一部分流量"的开关**。它一关全关。Tailscale 的 netfilter 既负责入站 ACL 也负责 DERP 中转的 NAT redirect。想"只放行"的语义在 tailscale 要通过 ACL 规则来表达，不是关 netfilter。
- 阿里云的内网 DNS `100.100.2.136` 这一段本身就是 RFC 6598 的 CGNAT 段 `100.64.0.0/10`，和 Tailscale 的默认地址池**重合**——这是阿里云用户装 tailscale 时本质上的冲突点，文档里没标注，**记住这一条可以省很多时间**。

🎵 Listening companion
<NetEasePlay id="4278804" kind="song" />
