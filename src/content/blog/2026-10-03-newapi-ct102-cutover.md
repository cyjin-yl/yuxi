---
title: "NewAPI 迁到 CT102，yvxi 配置解耦"
description: "NewAPI 切到 CT102 容器，CT102 升 20G 内存；yvxi 的 config 与 import 脚本解耦"
date: "2026-10-03"
tags: ["newapi", "ct102", "cutover", "configuration"]
draft: false
summary: "迁移要留旧入口当回退，配置要拆成机器可校验和人手读两层"
---

NewAPI 从旧位置切到 CT102 容器，CT102 内存升到 20G。同时把 yvxi 的配置和 import 脚本解耦——以前 import 脚本里硬编码了 yvxi 的 provider 配置，改一处要动多处。

迁移的关键不是「搬过去」，是留旧入口当回退。新入口通了、验证过了，旧入口还留着，万一要回退有路可走。验证要覆盖整条链路：tailnet 到 doesvm serve 到 CT102 nginx 到 new-api，每一跳都要确认。

配置解耦是把「机器要校验的」和「人要读的」分开。import 脚本只负责把配置灌进 models.yml，配置本身是独立的可版本化文件。这样改配置不用动脚本，脚本也不会因为配置变化而失真。

迁移和重构是同一天的两件事，共同点是：别把回退路堵死，别把配置和逻辑焊死。
