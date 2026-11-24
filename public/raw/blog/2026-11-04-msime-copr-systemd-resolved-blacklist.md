---
title: "输入法装好了却没有出现：解析失败与半截配置分别处理"
description: "11 月 4 日安装水杉输入法时遇到仓库域名解析失败，重启 systemd-resolved 后安装恢复；随后又处理了首次配置不完整。恢复前后相关，但没有足够日志证明存在永久的上游黑名单。"
date: 2026-11-04
tags: [fedora, copr, systemd-resolved, ibus, dns, fedora-44]
draft: false
summary: "历史记录中，重启 systemd-resolved 后 COPR 安装通过；这能确认恢复结果，不能独自证明上游曾被永久拉黑。另一条排查线发现 msime 首次配置缺少 runtime-options.json，重跑配置下载后引擎注册恢复。"
---

import NetEasePlay from '../../components/NetEasePlay.astro';

> 2026-11-24 校订说明：内部 DNS 端点已换为文档示例；保留超时和重启后的恢复记录，撤回“已证明永久黑名单”的说法，明确缺少上游状态与日志证据。

## 事件

2026 年 11 月 4 号，按 msime.app 手册给 Fedora 44 装水杉输入法：`dnf copr enable msime/msime` 加 `dnf install msime`。第一步就卡住，COPR 仓库的 repodata 反复报 `Curl error (6): Could not resolve hostname`。装完后引擎也没出现在 IBus 候选里。

## 坑

网络侧记录到内部 DNS 查询超时（端点以文档地址 `192.0.2.1` 表示），另一路 DoH 请求也超时，包管理器无法解析仓库域名。当时怀疑上游连通性或 systemd-resolved 的当前状态参与了故障，但没有保留下足够的上游选择、缓存/特性状态与同一时段日志，不能确定是永久黑名单，也不能由包管理器报错直接证明所有域名都不可解析。

配置侧：第一轮跑 `msime-linux-setup --download` 时被超时截断，词库只拷了一半就死了，`~/.config/msime-client` 里没有 `runtime-options.json`。IBus 引擎加载器读到这个半截状态，直接退出去弹首启向导——症状是"输入法没注册"，实际是配置不完整，跟包本身无关。

## 修复

执行 `sudo systemctl restart systemd-resolved` 后，再次启用 COPR 并安装通过：GPG 密钥导入正常，203MiB 主包加 69.8MiB 依赖全部落地。再把坏的 `~/.config/msime-client` 移到备份目录，重跑 `msime-linux-setup --download`，配置、词库、匿名账号一次到位，引擎自动注册进 IBus。

## 经验

这里有两个不同的结果：DNS 相关路径在重启后恢复，输入法在重新生成完整配置后出现在候选列表里。前者是恢复记录，若要追究根因，还需要重启前后的 resolver 状态和查询日志，不能靠恢复倒推出永久黑名单。后者则提示，在包已安装但组件未出现时，可以把配置是否完整列为检查项；它不是所有“加载即退出”问题的通用解释。

🎵 Listening companion
<NetEasePlay id="865964850" kind="song" />
