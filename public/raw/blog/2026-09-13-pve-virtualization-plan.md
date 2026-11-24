---
title: "装机夜：把 PVE 虚拟化规划落纸"
description: "硬件没到，先把虚拟化怎么排落纸：反向 P2V、VM100/101、双 V100 直通、内存分配"
date: "2026-09-13"
tags: ["pve", "kvm", "p2v", "passthrough"]
draft: false
summary: "装机日把虚拟化总规划写下来，免得硬件到了再空想"
---

硬件还没到，先把虚拟化怎么排落纸，免得板子到了再空想。

装机日把 PVE 虚拟化总规划写下来。核心决定是反向 P2V：旧 Windows 整机变成 VM100 doesworkstation，研究 VM 是 VM101 doescompute，CT102 承载 Kuma、Gitea、portal 这些服务。内存分配 VM100 给 16 GiB、VM101 给 24 GiB、CT102 给 16 GiB 加 4 GiB swap。两张 V100 直通给 VM101，因为那是 vLLM 推理的长期后端，不能动。

这一页其实埋着第二天翻车的伏笔：当晚用户拍板停止 EPC612D8A 的调试、走退货流程。装机主板出了问题，规划得推翻重来。但规划本身的价值还在——它把「哪些 VM 要、直通给谁、内存怎么分」这些和主板无关的决定先钉死了。

规划能落纸，但板 U 的兼容性，得等实物说话。
