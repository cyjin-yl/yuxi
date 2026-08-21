---
title: User-Agent 反爬检测：为什么 Dalvik 会被秒封
description: 群友踩坑实录。User-Agent 里带了 Dalvik 字样就被教务系统封杀，背后的反爬原理与应对策略。
date: 2026-07-21
tags: [web-scraping, anti-bot, user-agent, linux]
---

## 起因

群里有人做教务系统相关的自动化脚本，遇到一个诡异的屏蔽：只要 User-Agent 里出现 `Dalvik` 字样，请求就会被拦截。

> User-Agent 不能出现 Dalvik 字样

这句话乍看很无厘头——Dalvik 是 Android 的老牌运行时环境，跟教务系统有什么关系？但实际上它揭示了一个很典型的反爬机制：**基于 User-Agent 指纹的黑名单策略**。

## Dalvik 为什么会被标记

`Dalvik` 出现在 User-Agent 里，通常意味着请求来自 Android 设备上的 HTTP 客户端（比如 OkHttp、Apache HttpClient 等）。这类客户端的默认 UA 格式类似：

```
Dalvik/2.1.0 (Linux; U; Android 12; Pixel 6 Pro Build/SQ3A.220705.004.A1)
```

服务端看到 `Dalvik` 关键字，基本可以判断这不是来自浏览器，而是来自自动化脚本或爬虫程序。理由很简单：**正常用户不会在浏览器里用 Dalvik 运行时**。

很多反爬系统的实现逻辑是：

1. 维护一个「可疑 UA 关键字」黑名单，`Dalvik`、`Python-urllib`、`Go-http-client` 等都在其中
2. 匹配到后直接返回 403 或跳转到验证码页面
3. 有些还会配合 IP 频率限制，形成双重拦截

## 正确的做法

### 方案一：伪装成真实浏览器 UA

最简单直接的方式是替换 User-Agent：

```python
headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
}
```

这能绕过基于关键字的黑名单，但**不是万能药**。越来越多的系统会结合其他指纹（TLS 指纹、HTTP 2 设置、请求头组合）进行综合判断。

### 方案二：使用真实浏览器的自动化

如果目标系统的反爬比较严格，可以考虑用 Playwright 或 Puppeteer 控制真实浏览器实例：

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("https://example.com")
    # 正常操作
    browser.close()
```

真实浏览器的 TLS 指纹、HTTP 请求头、Cookie 行为都符合正常用户模式，很难被纯基于 UA 的策略拦截。

### 方案三：随机化 UA

如果只需要批量请求，且目标系统只检查 UA 格式：

```python
import random

ua_pool = [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Safari/537.36",
]

headers = {"User-Agent": random.choice(ua_pool)}
```

每次请求从池子里随机取一个，降低模式化特征。

## 更深层的问题

只改 User-Agent 能绕过初级的黑名单检测，但现代反爬系统远不止看这一个字段：

- **TLS 指纹（JA3）**：不同客户端的 TLS 握手特征不同，Python 的 `requests` 库和 Chrome 的指纹完全不同
- **HTTP/2 设置帧**：Chrome 发送的 SETTINGS 帧参数有固定模式
- **请求时序**：正常用户的请求间隔不规则，爬虫往往是均匀间隔
- **Cookie / Session 行为**：很多系统要求先访问首页获取 Cookie，再访问 API

当反爬不止一层时，改 UA 只是最浅的应对。真正需要做的是：

1. **模拟真实用户行为**——随机延迟、合理的页面跳转顺序
2. **使用与浏览器一致的 TLS 实现**——比如 `curl_cffi` 库可以伪造 Chrome 的 TLS 指纹
3. **考虑代理池**——避免单 IP 高频请求触发限流

## 总结

群里那个教务系统虽然只做了 UA 关键字检查，但这件事折射出的反爬思路是通用的：

> 不要假设「能拿到数据」意味着「你的请求看起来像正常人」。

写爬虫时，先把 UA 伪装好，再考虑更深层的指纹问题。很多时候第一层防护就已经能拦住你。
