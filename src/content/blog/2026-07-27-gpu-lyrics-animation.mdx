---
title: 用 GPU 做歌词动画：从"跳字"到连续形变的折腾记录
descrption: 把歌词播放器从"一个字一个字跳"改成 GPU 驱动的连续形变动画，中间踩了哪些坑。
date: 2026-07-27
tags: [gpu, animation, lyrics, canvas, debugging]
draft: false
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 问题

我们的歌词播放器有个很明显的问题：当前歌词字体"跳"——从 0.5 倍突然变到 1.0 倍，中间没有过渡。

更准确地说，问题不是"没有过渡"，而是**只有两帧**：小→大，没有中间态。

## 为什么两帧

原因很简单：CSS `transform: scale()` 在离屏渲染时，如果只改 `font-size`，浏览器只会渲染"改前"和"改后"两帧。中间帧被跳过。

## 方案：GPU 连续形变

目标：把一句歌词当成一个连续体来处理，当前字放大时，旁边的字也被"推"开一点，整体向上流动。

实现思路：

1. **Canvas 2D + GPU 加速**：用 `will-change: transform` 提示浏览器用 GPU 合成
2. **逐字位置插值**：每个字的位罝不是离散跳变，而是用 `requestAnimationFrame` 做 lerp（线性插值）
3. **蒙版同步**：高亮蒙版的位置与当前字同步，不是"走到哪个字就切"

## 踩坑

### 坑一：`requestAnimationFrame` 的帧率

直接 `lerp` 在 60fps 下还行，但低端设备上会掉到 30fps，动画变得"一卡一卡"。

**修复**：用 `performance.now()` 做时间驱动插值，不依赖帧率：

```javascript
const t = (performance.now() - startTime) / duration;
const scale = lerp(0.5, 1.0, easeInOut(t));
```

### 坑二：Canvas 离屏渲染的内存

每个字一个 Canvas 层，30 个字就是 30 个离屏 buffer，内存占用爆炸。

**修复**：只渲染当前行 + 上下各一行，共 3 行。其他行用 CSS `opacity: 0` 隐藏。

### 坑三：字体渲染的亚像素抗锯齿

GPU 加速后，字体边缘变得模糊。原因是 `transform` 改变了像素对齐。

**修复**：`transform: translateZ(0)` + `image-rendering: pixelated` 组合，强制 GPU 保持像素对齐。

## 最终效果

动画从"两帧跳变"变成了"连续流动"。当前字放大时，整行歌词像水波一样向上扩散。

## 经验

1. **CSS transform 不等于 GPU 动画** —— 离屏渲染的帧率取决于实现，不是标准
2. **时间驱动插值 > 帧驱动插值** —— `performance.now()` 比 `requestAnimationFrame` 更可靠
3. **离屏 buffer 要控制数量** —— 30 个 Canvas 层 = 内存爆炸

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />