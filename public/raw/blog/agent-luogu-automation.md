---
title: Agent 自动化提交洛谷：从零到 AC 的完整记录
description: 从登录验证码、iframe 注入失败到 JSON API 直提交——一个 AI Agent 如何自动化洛谷代码提交的完整调试记录。
date: 2026-07-21
tags: [automation, agent, luogu, python, debugging]
widget: none
self_review: |
  这篇文章记录了一个真实的调试过程：AI Agent 试图自动化洛谷代码提交，经历了近 20 次脚本迭代才找到正确路径。
  最大的收获不是"API 端点在哪"，而是学会了面对 418 和跨域限制时，如何从浏览器行为逆向发现接口。
---

## 起因

博客写题解的规范有一条：**代码必须提交到洛谷，拿到 Accepted 才能合入文章**。

手动打开 IDE、粘贴代码、点提交、等评测——每次至少几分钟。当一天写两三篇题解时，这个过程占了太多时间。

于是让 Agent 试试自动化。

## 第一阶段：登录

洛谷登录是两步流程：

1. 第一步填邮箱，点"下一步"
2. 第二步填密码 + 图形验证码，点"使用账户密码登录"

登录页面长这样：

<img alt="洛谷登录页面" src="/screenshots/agent-login-page.png" class="zoomable" />

### 坑一：密码被篡改

第一版脚本用 `keyboard.type()` 填密码，一直登录失败。排查后发现 Playwright 的 `keyboard.type()` 会把 `%` 等特殊字符当修饰键处理——密码 `%Jcy%120031` 被改成了完全不同的字符串。

**修复：** 改用 `fill()` 方法直接设置输入框值。

### 坑二：验证码识别

洛谷有图形验证码，四字母。方案是：

1. `page.locator('img[src*="captcha"]').screenshot()` 截取验证码
2. `ddddocr.classification()` 自动识别
3. 识别长度不足 4 位时自动刷新重试

截到的验证码截图：

<img alt="验证码截图示例" src="/screenshots/agent-captcha.png" class="zoomable" />

实际效果：第一次就识别对了 `pw64`，登录成功。后续脚本基本一次过。

### 坑三：登录成功后不 break

OCR 识别对了，验证码填了，登录按钮点了，URL 也跳走了……但脚本继续在首页里找了 14 次验证码才停。原因是循环的退出条件写得不对——在验证码图片不存在时没有检查 URL 是否已跳出登录页。

**修复：** 加 `"login" not in page.url.lower()` 判断，离开登录页立刻 break。

## 第二阶段：代码注入

登录成功后，导航到题目 IDE 页面，需要把代码填入 Monaco 编辑器。

### 坑四：iframe 跨域拦截

Monaco 编辑器嵌在一个 iframe 里。`page.evaluate()` 只能访问主页面 DOM，跨域 iframe 的内容拿不到——这是浏览器的同源策略，无法绕过。

尝试了三种注入方式：

- **JavaScript 注入**：`page.evaluate()` 执行失败，iframe 跨域
- **剪贴板粘贴**：通过 `navigator.clipboard.writeText()` 写剪贴板，再用 `Ctrl+A, Ctrl+V` 模拟粘贴。理论上可行，但 Monaco 编辑器对剪贴板操作有防错机制，实际粘贴不完整
- **Playwright 键盘输入**：`locator('iframe').content_frame().locator('.monaco-editor').click()`，然后 `keyboard.type(code)`。代码较长时，`keyboard.type()` 速度太慢且有修饰键问题

全部失败。代码被注入编辑器后长这样（但不完整）：

<img alt="代码注入后编辑器状态（不完整）" src="/screenshots/agent-code-typed.png" class="zoomable" />

### 转折点：拦截 HTTP 请求

既然编辑器操作不了，不如看看编辑器是怎么提交代码的。在浏览器 Network 面板里找到了：

```
POST https://www.luogu.com.cn/fe/api/problem/submit/P3366
Content-Type: application/json
Body: {"code": "完整源代码", "languageId": 1}
```

端点存在，格式简单，直接绕过浏览器操作。

## 第三阶段：API 提交

### 坑五：418 和频率限制

第一次直接用 `requests.post()` 提交，返回 **418**（Lo 418）。洛谷有反爬，裸 requests 不行。

**解决：** 从浏览器 context 里提取 Cookie，带上完整的 `Referer`、`X-Requested-With: XMLHttpRequest` 头。

### 坑六：CSRF Token

带 Cookie 提交后返回 "FrequentRequestException"。需要 CSRF Token——在题目页面的 `<meta name="csrf-token" content="...">` 里。

用 `page.evaluate()` 提取 meta 标签的 content，加到 `X-CSRF-Token` 请求头里。

### 坑七：代码过短

API 通了，但返回"代码过短"。检查代码文件发现只有 925 字节——`MAXM = 100005` 不够大，P3366 的 m 最大到 200000，测试点 8-10 RE。

**修复：** 把 `MAXM` 改到 200005。

### 最终提交

```python
headers = {
    'Content-Type': 'application/json',
    'Referer': 'https://www.luogu.com.cn/problem/P3366',
    'X-Requested-With': 'XMLHttpRequest',
    'Cookie': cookie_str,
    'X-CSRF-Token': csrf_token,
}
json_data = json.dumps({'code': code, 'languageId': 1}).encode()
resp = urllib.request.urlopen(Request(submit_url, data=json_data, headers=headers, method='POST'))
resp_json = json.loads(resp.read().decode())  # {"rid": 287646226}
```

返回 `{"rid": 287646226}`，等 15 秒后访问记录页面——**AC**。

<img alt="最终提交结果 AC" src="/screenshots/agent-record.png" class="zoomable" />

## 完整流程

最终脚本是一个一体化流程：

1. **登录**：Camoufox 浏览器 + ddddocr OCR 验证码
2. **提取 CSRF Token**：访问题目页面，JavaScript 提取 meta 标签
3. **API 提交**：`POST /fe/api/problem/submit/{problemId}`，JSON body
4. **验证结果**：等待评测完成，截图确认 AC

从第一版到最终 AC，经历了近 20 次脚本迭代。但流程打通后，后续题目只需修改 problemId 和代码内容即可。

## 经验沉淀

这次调试学到的核心东西：

- **密码输入永远用 `fill()`，不用 `keyboard.type()`**——特殊字符会被当修饰键
- **Monaco 编辑器在跨域 iframe 中不可操作**——这是浏览器安全机制，不是 bug
- **逆向 API 是绕过前端限制的正确方法**——看 Network 面板找 POST 端点
- **ddddocr 对洛谷验证码识别率不错**——4 字母验证码基本一次过
- **Cookie 有效期约 30 天**——过期后重走登录流程

这些经验已写入 `luogu` skill，下次写题解时可以直接调用。

## 复杂度对比

| 方式 | 时间 | 依赖 | 可靠性 |
|------|------|------|--------|
| 手动提交 | ~3min | 浏览器 | 100% |
| IDE 注入 | 不稳定 | Playwright + 剪贴板 | 低 |
| API 直提交 | ~20s | Cookie + CSRF Token | 高 |

API 直提交是最优解：速度快、稳定、不需要操作 DOM。
