---
title: Hermes 在 systemd 里跑着但 Discord 一声不吭：process 跑不等于 service 正常
descrption: 8 月 11 号早上发现 Discord 完全不回消息，但 `systemctl status hermes` 显示 active。排查发现是 systemd unit file 里 WorkingDirectory 配错，进程在但永远在重试。
date: 2026-08-11
tags: [systemd, hermes, discord, ops]
draft: false
summary: systemd 报 active 不代表 service 真的工作。WorkingDirectory 配错会导致进程反复启动失败再被拉起，看起来"在跑"实际"没用"。
---

import NetEasePlay from '../../components/NetEasePlay.astro';

## 现象

8 月 11 号早上起来，发现 Discord 上 @ Hermes 完全没有回应。

```
$ systemctl status hermes
● hermes.service - Hermes Agent
   Active: active (running) since Mon 2026-08-11 07:15:21 CST
 Main PID: 2847 (python3)
   Memory: 184.0M
```

看起来一切正常。但 Discord 上什么反应都没有。

## 排查

### 第一步：看日志

```bash
$ journalctl -u hermes --since "1 hour ago" -n 50
Aug 11 07:15:21 hermes-yuxi systemd[1]: Started Hermes Agent.
Aug 11 07:15:22 hermes python3[2847]: [INFO] connecting to discord gateway...
Aug 11 07:15:25 hermes python3[2847]: [ERROR] FileNotFoundError: [Errno 2] No such file or directory: '/home/ezra/.config/hermes/credentials.json'
Aug 11 07:15:25 hermes systemd[1]: hermes.service: Main process exited, code=exited, status=1/FAILURE
Aug 11 07:15:25 hermes systemd[1]: hermes.service: Scheduled restart job, restart counter is at 1.
Aug 11 07:15:26 hermes systemd[1]: Started Hermes Agent.
Aug 11 07:15:26 hermes python3[2901]: [INFO] connecting to discord gateway...
Aug 11 07:15:28 hermes python3[2907]: [ERROR] FileNotFoundError: ...
```

哦——**一直在 restart**。

### 第二步：为什么 status 报 active？

`Active: active (running)` 只意味着 systemd **正在尝试保持它跑着**。如果进程崩了，systemd 立刻拉起新的——只要重启间隔 < 几秒，status 永远是 `active (running)`。

这是 systemd 的设计：`Type=simple` 默认行为就是 restart-forever。

### 第三步：根因

systemd unit file 里：

```ini
[Service]
WorkingDirectory=/home/ezra
ExecStart=/usr/bin/python3 -m hermes --yolo
```

看起来正常，但实际用户的 home 是 `/home/ezra`，credentials 文件在 `/home/ezra/.hermes/credentials.json`——

不对，等等，错误信息说的是 `/home/ezra/.config/hermes/credentials.json`。

我看了一下 hermes 的代码：

```python
# hermes/config.py
CREDENTIALS_PATH = Path(os.environ.get('HERMES_HOME', '~/.config/hermes')) / 'credentials.json'
```

但实际的配置在 `~/.hermes/`。两个不同的路径。

**问题**：systemd 启动时 `HOME=/root`（默认），所以 `~` 展开成 `/root`，然后 `~/.config/hermes/credentials.json` → `/root/.config/hermes/credentials.json`，找不到。

而我们的实际 credentials 在 `/home/ezra/.hermes/credentials.json`。

## 修复

```ini
[Service]
User=ezra
WorkingDirectory=/home/ezra
Environment="HOME=/home/ezra"
Environment="HERMES_HOME=/home/ezra/.hermes"
ExecStart=/usr/bin/python3 -m hermes --yolo
Restart=on-failure
RestartSec=10
```

+ `User=ezra` 让 systemd 以 ezra 身份跑
+ `Environment="HOME=..."` 显式设 home
+ `Environment="HERMES_HOME=..."` 显式告诉 hermes 配置文件在哪

之后：

```
$ systemctl restart hermes
$ journalctl -u hermes -n 5
Aug 11 08:22:14 hermes-yuxi systemd[1]: Started Hermes Agent.
Aug 11 08:22:15 hermes python3[3127]: [INFO] connecting to discord gateway...
Aug 11 08:22:16 hermes python3[3127]: [INFO] gateway connected
Aug 11 08:22:16 hermes python3[3127]: [INFO] ready
```

好了，Discord 能回了。

## 经验

1. **systemd `active (running)` 不等于 service 工作** —— 进程崩了 systemd 立刻拉起，看起来一切正常
2. **看 `journalctl` 不看 `systemctl status`** —— status 是表象，journal 是真相
3. **`Type=simple` + 默认 `Restart=always` 会导致 restart loop** —— 配 `Restart=on-failure` + `RestartSec=10s` 让失败有迹可循
4. **systemd service 一定要显式设 `User=` 和 `Environment=`** —— 别依赖默认值

---

🎵 Listening companion

<NetEasePlay id="185911" kind="song" />

> "在跑"不等于"在工作"。这两个词之间的距离，就是日志和 status 之间的差距。