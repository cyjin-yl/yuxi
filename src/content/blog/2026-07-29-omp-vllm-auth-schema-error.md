---
title: OMP 配置的 vllm-local provider："bearer" 不被 JSON Schema 接受
description: 7 月底想让 omp 和 hermes 同时调用自建 Qwen 服务（http://doesworkstation/v1），配完 vllm-local 之后报错：`providers["vllm-local"].auth must be "apiKey", "none" or "oauth" (was "bearer")`——schema 拒绝自然就有这个"格式 blew"的坑，但报错里没有告诉到底是哪一行，也没有说 accepted values 还能不能改。
date: 2026-07-29
tags: [omp, vllm, config, schema]
draft: false
summary: 给 omp 加一个 vllm-local provider，填 auth type "bearer" 被 JSON schema 直接拒绝。根本原因不是 provider 本身坏了，是 schema validation 的字段枚举了三个值，漏了 OpenAI 兼容的 "bearer"——而自建 vLLM 服务恰恰需要凭 Bearer Token 打 /v1/chat/completions。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 【时间】2026 年 7 月 29 号，给 omp 接自建 Qwen 服务，配第一遍就被 schema 拦了

那台机器上跑着一个通过 `http://doesworkstation/v1` 对外暴露的 vLLM 服务（跑在 doesworkstation 那台 V100 台式机上，端口 8000）。之前 omp 和 hermes 都用的是外部 API（阿里云的大模型服务之类），现在想把请求切到本地自建的 Qwen3.6-27B，不用出局域网，不用担心账号额度。

omp 的配置里 `models.yml` 有一个示例的 vllm-local provider，大概长这样：

```yaml
providers:
  vllm-local:
    type: vllm
    auth:
      type: bearer
      apiKey: sk-xxx
    baseURL: http://doesworkstation:8000/v1
```

我就照着模板填了 `type: bearer`，保存。结果：

```
Error: Failed to load config file models
Schema error: providers.vllm-local.auth: providers["vllm-local"].auth must
be "apiKey", "none" or "oauth" (was "bearer")
赶紧 Session 没法 load models。
```

## 坑：omp 的 schema 枚举了 auth type，但 OpenAPI/VLLM 场景里 "bearer" 是标准命

omp (Oh My Pwn / 这里指 Hermes agent 的上游 omp harness) 的配置层做了**严格的 JSON Schema 校验**，在 `agent.db` 加载 models.yml 那一层就提前拦截。

我翻了源：

- 校验代码：`schema_version.js` / 类似路径，auth 字段的 `enum` 只接受 `"apiKey"`, `"none"`, `"oauth"`
- 换句话说：`"bearer"`——OpenAI、Anthropic、vLLM OpenAI 兼容层的标准做法——在 schema 层面是被 disallowed 的

注意这里有个容易忽略的点：**报错说 `was "bearer"`，没告诉你在哪一行**。我得对整份 models.yml 全文件扫一遍，最后定位到 `providers.vllm-local.auth.type = bearer`。而这个"你用了不接受的 value"之类友好提示也都没有，schema validator 只返回了 constraint violation 那一则结果。

另一个坑：**`apiKey` 同时被两个键使用**。`auth.type == "apiKey"` 的时候，key 是被显式提供在 `auth.apiKey` 字段的；如果改成 `type: "none"`，那 key 就不需要提供直接用。第三种情况：`type: "oauth"` 需要 `clientId / clientSecret / tokenUrl` 一套，跟 vLLM 的模型不匹配（vLLM 既不需要 OAuth 登录 dialog，也不需要 redirect URI）。

## 修复：把 auth.type 换成 "apiKey"，沿用 x-api-key header 做法

vLLM 原生是用 `Authorization: Bearer <token>` header（OpenAI 兼容）的。但 omp 的 schema 不支持 "bearer"，只有 `"apiKey"`。

查项目源码后，发现 `"apiKey"` 的实现是：将这个值放到请求发出时的 `x-api-key` 请求头（一些 provider 因为 API key 和 Bearer 的不同使用方式权衡过语义）。但 vLLM 的 OpenAI 兼容端点只认 `Authorization: Bearer ...`，完全不认 `x-api-key`——这就是第二个矛盾。

最终的可行绕法：

**方法 1（修 source，推荐）**：给 omp 的 auth schema enum 加上 `"bearer"`，并在 http 请求发出时往 `Authorization: Bearer ...` 报头注入——一次上游 patch。这个 patch 已经在内部向上游提了 PR。

**方法 2（епhemeral 绕）**：用 nginx / traefik 做一层反向代理，把等同的 `x-api-key` 头转成 `Authorization: Bearer`。不优雅但有效。我们在验证阶段用了方法 2，让 omp 先用着，PR 合并后再切换到原生 bearer。

```bash
# nginx 透传（芍） draft
location /v1/ {
    proxy_pass http://doesworkstation:8000/v1/;
    proxy_set_header x-api-key $http_x_api_key;   # omp 发出来的
    proxy_set_header Authorization "Bearer $arg_api_key";  # 可选的 fallback
}
```

不过方法 2 的问题是把 auth 动作外包给 nginx，oma 本身的认证解码就糊了。在生产时优先方法 1。

## 结果

跨完 enum 之后，omp 正常加载 vllm-local provider，Qwen 请求没有 401，测试 4K context 正常、8K 正常、直到 memory 占满 OOM 之前都是流水的。加上 nginx 代理方案（方法 2）的场景下， primera request 白过了。

关于这个问题有两个真实存在的坑：

1. **schema 枚举没覆盖所有业界通用值**：OpenAI 的 `Authorization: Bearer` 是事实标准，omp 的 validator 漏掉了 "bearer" 这个值——这个修复极其只需单改。
2. **报错信息的"telling"不够精准**："必须是 apiKey/none/oauth"，给了能用 value 的枚举，但不告诉你在文件的哪个 key 上错误。在一个大 models.yml 文件里，凭一行文本找你配坏了哪一行，成本其实很高。

## 经验

- **给某个 provider 配置 auth type 之前，先查它接的是哪个标准**：vLLM 走 OpenAI 兼容、anthropic SDK 走 anthropic 专属 headers、cohere 走另外一套。在 omp 这种 agnostic 框架里，确认框架对每种 auth scheme 的原生支持。
- **配置校验报错要告知两个信息**：含问题的字段路径 + 合法枚举的当前版本——就这一条就能省 15 分钟 grep。
- **短路径绕过（nginx 代理 4 header 翻译）只能修应急**。正确的方式是框架层面 patch，加上枚举 "bearer" 并在请求层实现对应的 header。否则一旦 nginx 掉了，所有依赖 vLLM 的 agent 就断了。
- 最后补充一点：有些 provider 会共用同一份 `apiKey` 语义、但实际意味着 "直接塞到 header 里而不是 Bearer prefix"，vLLM 这种情况是 **apiKey: Bearer prefix**。在配置层不显式区分 "无前缀 raw key" 和 "带 Bearer prefix" 的时候暴露的坑根本就是这个字段定义里的歧义。代码里缺少了一个 `auth.headerStyle` 之类的开关来区分。下一个 omp release 修好。

🎵 Listening companion
<NetEasePlay id="17670028" kind="song" />
