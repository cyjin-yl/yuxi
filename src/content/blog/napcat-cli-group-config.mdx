---
title: napcat-cli 群配置与管理速查
description: 从零配置 napcat-cli，掌握群消息收发、成员管理、事件监听与 Agent Wake 的完整链路。
date: 2026-07-20
tags: [bot, qq, napcat, cli, linux]
---

## 开头

管理 QQ 机器人的群配置，最怕的不是协议本身，而是散落各处的配置项、环境变量、守护进程——它们各自为政，互相不认。

napcat-cli 把这些碎片收拢成一条 CLI 管线。你不需要打开网页控制台，不需要记 JSON 结构，不需要手动管理 WebSocket 连接。一个 `napcat` 命令，够用了。

## 安装与初始化

```bash
uv tool install napcat-cli
napcat setup
```

`setup` 是一个交互式向导，它会引导你填写 API 地址、认证 Token、数据目录，以及 skills-fs 和 Agent Wake 的配置。配置最终落到两个文件：

- `~/.napcat-data/config.json` — API 端点、Token、端口
- `~/.napcat-data/daemon.json` — 守护进程配置、skills-fs 挂载点

不想交互？可以跳过：

```bash
napcat setup --non-interactive  # 不提问，验证 Token
napcat setup --yes              # 跳过 Token 验证
napcat setup --force            # 覆盖已有配置
```

## 群消息收发

### 发消息

```bash
napcat send group 123456 -m "今晚八点开会"
napcat send group 123456 -m "公告" --at 10001 10002
napcat send group 123456 -m "文件已上传" --file /tmp/report.pdf
napcat send group 123456 -m "截图" --image screenshot.png
```

消息段是拼接的。`--at` 会插入 `at` 段，`--file` 或 `--image` 插入对应媒体段，文本放在最后。所有段合并后通过 NapCat HTTP API 发送。

### 撤回消息

```bash
napcat recall 1001
napcat recall 1001 --group 123456
```

撤回需要消息 ID。如果你刚发完消息，终端 stderr 会打印 `message_id`，直接复制就行。

### 回复消息

```bash
napcat reply group 123456 1001 -m "收到，马上处理"
```

回复会自动在前面插入 `reply` 消息段，引用原消息。

## 群成员管理

napcat-cli 把 NapCat 的群管理 API 封装成子命令，覆盖了日常管理的几乎所有场景：

```bash
napcat group info 123456           # 群信息
napcat group members 123456        # 群成员列表
napcat group member 123456 10001   # 单个成员信息

napcat group mute 123456 10002 --duration 3600   # 禁言 1 小时
napcat group unmute 123456 10002                  # 解除禁言
napcat group kick 123456 10002 --reject           # 踢出并禁止加群
napcat group admin 123456 10003 --enable          # 设管理员
napcat group rename 123456 10001 --card "新名片"  # 设群名片
napcat group remark 123456 --remark "项目组"       # 设群备注
napcat group announce 123456 --content "公告内容"  # 发群公告
```

所有命令返回 JSON 结果，可以直接管道给 `jq` 处理。

## 群文件操作

```bash
napcat file upload-group --group 123456 --file report.pdf --name "月度报告.pdf"
napcat file list-group --group 123456
napcat file list-folder --group 123456 --folder folder_id
napcat file info --group 123456 --file file_id
napcat file download --group 123456 --file file_id --output-dir /tmp/
```

本地文件自动转为 `file://` URL。支持 `http://`、`https://`、`file://`、`base64://` 四种文件路径格式。

## 事件监听与 Agent Wake

这是 napcat-cli 最实用的部分——把 QQ 事件转化为 AI Agent 的触发信号。

### 事件读取

```bash
napcat events --limit 10
napcat events --type message --since 1700000000
napcat events --no-heartbeat
```

事件存储在 SQLite 数据库里，由守护进程持续写入。支持按类型和时间过滤。

### Agent Wake 配置

```bash
napcat config set wake_on_event true
napcat config set wake_command \
  'hermes -c session -z "new QQ message: {reason}" -s napcat-cli --yolo'
```

当守护进程监听到触发事件时，会自动执行 `wake_command`。命令里的 `{reason}` 占位符会被事件类型替换。

支持的触发条件：

| 触发类型 | 含义 |
|----------|------|
| `AT_ME` | 有人 @ 机器人 |
| `REPLY_TO_ME` | 有人回复机器人 |
| `GROUP_TRIGGER` | 群内命中触发词 |
| `PRIVATE_TRIGGER` | 私聊命中触发词 |
| `NEW_POKE` | 收到戳一戳 |
| `NEW_FRIEND_REQUEST` | 新好友请求 |
| `NEW_GROUP_REQUEST` | 新群请求 |
| `NEW_MESSAGE` | 任何新消息 |

### 守护进程

```bash
napcat daemon start   # 启动守护进程
napcat daemon status  # 查看运行状态
napcat daemon stop    # 停止守护进程
napcat daemon restart # 重启
```

守护进程启动后，PID 写入 `~/.napcat-data/daemon.pid`，日志追加到 `daemon.log`。它会同时管理 WebSocket 事件监听和 skills-fs HTTP 服务。

## 环境变量

napcat-cli 支持三个环境变量覆盖默认配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NAPCAT_API_URL` | `http://127.0.0.1:18801` | NapCat HTTP API 地址 |
| `NAPCAT_TOKEN` | — | API 认证 Token |
| `NAPCAT_DATA_DIR` | `~/.napcat-data` | 数据目录 |

## skills-fs 集成

守护进程内置 skills-fs HTTP provider，将 NapCat API 映射为虚拟文件系统。Agent 可以通过文件操作间接调用 API：

```bash
skills-fs fuse --config ~/.napcat-data/skills-fs.json \
  --mountpoint ~/.napcat-data/skills/napcat-cli --allow-other
```

## 常见问题

### Bot 离线

所有发送和管理命令都会先检查在线状态。如果离线会直接报错。

```bash
napcat status    # 检查在线状态
napcat daemon restart  # 尝试重启守护进程
```

### Token 失效

API 返回非 `retcode: 0` 时，多半是 Token 过期或错误：

```bash
napcat config get token    # 查看当前 Token
napcat config set token NEW_TOKEN  # 更换 Token
```

### 守护进程僵死

如果 `daemon status` 显示 stale PID（PID 文件存在但进程已死），直接 `daemon start` 会自动清理。

## 结尾

napcat-cli 把 NapCat 的 HTTP API、WebSocket 事件流、守护进程管理、AI Agent 触发——这些本该散落的东西——打包成一个命令行工具。

配置一次，后面基本不用管。
