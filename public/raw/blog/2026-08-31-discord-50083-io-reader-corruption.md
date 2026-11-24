---
title: "Discord 50083 与附件重试：线程状态和 io.Reader 要分开处理"
description: "8 月 31 日排查 Discord bot 的归档线程报错和附件重试。50083 说明目标线程已归档；multipart 重建还会再次读取附件流。修复需要同时明确线程策略和每次请求的 payload 生命周期。"
date: 2026-08-31
tags: [discord, disgo, go, io-reader, retry]
draft: false
backfilledAt: 2026-11-24
backfillKind: event
summary: "8 月 31 日排查 Discord bot 的归档线程报错和附件重试。50083 说明目标线程已归档；multipart 重建还会再次读取附件流。修复需要同时明确线程策略和每次请求的 payload 生命周期。"
---

import NetEasePlay from '../../components/NetEasePlay.astro';

> 2026-11-24 校订说明：本文从迁移前的历史稿恢复，保留 2026-08-31 的事件日期。重新核对了 disgo v0.19.6 源码；撤回把 50083、429 和 Gateway EOF 全部归为同一根因的说法，并区分当时的解档方案与后续“不改动已关闭线程”的策略。

## 三种告警，不是一条因果链

8 月 31 日，bot 的记录里同时出现了归档线程的 `50083`、REST 限流和 Gateway 连接结束。最初很容易把它们串成“一个错误导致所有问题”。但同一时段出现，只能帮助排查，不能代替因果证据。

`50083` 首先指向目标线程的状态。重复请求可能增加限流压力，附件处理又可能让重试内容发生变化；Gateway EOF 则还需要自己的连接日志。后两件事不能仅凭时间接近，就算到线程归档头上。

## 重试时，附件不是可重复读取的值

这次值得留下的是 payload 生命周期。disgo v0.19.6 的 [`PayloadWithFiles`](https://github.com/disgoorg/disgo/blob/v0.19.6/discord/file.go) 会把每个 `file.Reader` 复制进 multipart body。普通 reader 读到末尾后，再次构造 body 不会自动回到开头。若重试闭包反复使用同一个已经消费过的 reader，后一次发送就可能缺少附件内容。

这不是说所有 `io.Reader` 永远只能读一次：可定位的 reader 可以显式重置，文件也可以重新打开。关键是重试代码必须拥有这种恢复能力，而不能假设库替自己做了。

另一个细节在 [`MessageUpdate.ToBody()`](https://github.com/disgoorg/disgo/blob/v0.19.6/discord/message_update.go)。当 payload 持有非空的共享附件指针时，构建过程会向它追加附件；把同一对象用于多次构建，可能累积条目。这个条件不能扩大成“任何消息对象调用一次就坏了”。

## 修复分别处理状态与内容

当时的方案是精确识别归档错误，并在允许恢复线程的业务场景里做一次有上限的恢复尝试；每次真正发送前，重新建立 payload、附件列表和 reader。不能拿“无限重试”同时解决权限、线程状态和数据流问题。

后来的日报维护记录进一步收紧了策略：已经归档或关闭的目标可以跳过，继续处理其他目标，同时不把未完成的更新记成成功。这是业务语义的变化，不能用后来的选择倒写成 8 月 31 日已经完成的修复。

应该验证的也正是这些边界：归档目标不会形成循环；第二次构造仍有完整附件；一次发送失败不推进成功快照；其他目标不被连带阻断。旧稿记载过相关回归工作，这次恢复没有重新执行当时的完整 Go 测试环境。

<NetEasePlay id="4909215" kind="song" />
