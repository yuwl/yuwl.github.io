---
slug: sh-to-systemd-migration
title: 将 Spring Boot 启停脚本迁移为 systemd 服务
date: 2026-08-12 18:00
authors: [yuwl]
tags: [systemd, spring-boot, java, deploy, linux]
---

之前一直用 `nohup` + shell 脚本来启停 Spring Boot 服务，每次都要手动 `kill` 旧进程、再后台拉新进程，还得自己维护 `nohup_xxx.log`。其实 systemd 早就把这些都接管了。本文把原来的启停脚本完整迁移成 systemd 服务，并顺便解决 OOM 自动恢复的问题。

<!-- truncate -->

## 1. 原来的启停脚本做了什么

原来的脚本核心逻辑如下：

```bash
#!/bin/bash
# 设置环境变量确保脚本输出为 UTF-8 编码
export LANG="zh_CN.UTF-8"
export LC_ALL="zh_CN.UTF-8"

JVM_XMS='256m'
JVM_XMX='1024m'
DIR=$(pwd)

# 查找当前目录 jar
JAR_NAME=`find ${DIR} -name "*.jar"`
NAME=${JAR_NAME##*/}
NAME=${NAME%.*}

# 停掉旧 Java 进程
PID=`ps -ef | grep "$JAR_NAME" | grep java | grep -v grep | awk '{print $2}'`
for pid in $PID
do
    sleep 2
    kill -9 $pid
done

# 清空 nohup 日志
echo > ${DIR}/nohup_$NAME.log

# 后台启动 Spring Boot
nohup /data/java17/bin/java -Xms$JVM_XMS -Xmx$JVM_XMX \
  -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/heapdump \
  -Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100M \
  -Dspring.profiles.active=test -Djob.execute.enabled=false \
  -Dfile.encoding=UTF-8 -Dserver.port=8082 \
  -jar $JAR_FILE --SERVER_NAME=$NAME > ${DIR}/nohup_$NAME.log 2>&1 &
echo "新的进程号为: $!"
```

它主要做了五件事：

1. **设置 JVM 内存**：`-Xms256m` / `-Xmx1024m`。
2. **查找当前目录 jar**：`find ${DIR} -name "*.jar"`。
3. **停掉旧 Java 进程**：`ps + grep + kill -9`。
4. **清空 nohup 日志**。
5. **后台启动 Spring Boot**。

## 2. 迁移到 systemd 的收益

迁移之后，很多手写逻辑都可以删掉了：

| 原来的 shell 逻辑 | systemd 是否还需要 |
| --- | --- |
| 查找 jar（find） | ❌ 不需要，直接写死 jar 路径 |
| 停旧进程（kill -9） | ❌ 不需要，`systemctl restart` 自动处理 |
| 清空日志 | ❌ 不需要，改用 `journalctl` 统一管理 |
| 后台启动（nohup &） | ❌ 不需要，`Type=simple` 前台运行即可 |
| 开机启动 | ❌ 不需要，`systemctl enable` 解决 |
| 异常自动重启 | ✅ 新能力，`Restart=always` 轻松实现 |

> systemd 本身负责：停止旧进程、启动新进程、自动重启、日志管理。这些正是脚本里最容易写错、最容易遗漏的部分。

---

## 3. 创建 systemd 服务文件

假设目录结构如下：

```text
/data/aiwenzhen-java
 ├── start.sh
 └── xxx.jar
```

创建服务文件：

```bash
vim /etc/systemd/system/aiwenzhen-test.service
```

内容：

```ini
[Unit]
Description=aiwenzhen-java-test service
After=network.target

[Service]
Type=simple

# 服务运行目录
WorkingDirectory=/data/aiwenzhen-java

# 环境变量
Environment="LANG=zh_CN.UTF-8"
Environment="LC_ALL=zh_CN.UTF-8"

# JVM 启动参数
ExecStart=/data/java17/bin/java \
-Xms256m \
-Xmx1024m \
-XX:+HeapDumpOnOutOfMemoryError \
-XX:HeapDumpPath=/data/heapdump \
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100M \
-Dspring.profiles.active=test \
-Djob.execute.enabled=false \
-Dfile.encoding=UTF-8 \
-Dserver.port=8082 \
-jar /data/aiwenzhen-java/your-app.jar \
--SERVER_NAME=your-app

# 异常自动重启
Restart=always

# 重启等待时间
RestartSec=10

# 文件句柄限制
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

---

## 4. 需要替换的两个地方

### 4.1 jar 文件名

原脚本用 `find` 动态查找 jar，但 systemd 不支持动态查找，必须写死完整路径。

假设你的 jar 是：

```text
aiwenzhen-java-1.0.jar
```

那么服务里对应：

```ini
-jar /data/aiwenzhen-java/aiwenzhen-java-1.0.jar
```

### 4.2 SERVER_NAME

原脚本通过 `${JAR_NAME##*/}` 和 `${NAME%.*}` 从 jar 文件名推导应用名：

```text
aiwenzhen-java-1.0.jar  →  aiwenzhen-java-1.0
```

systemd 里直接写死：

```ini
--SERVER_NAME=aiwenzhen-java-1.0
```

---

## 5. 创建目录

`-XX:HeapDumpPath=/data/heapdump` 和 `-Xlog:gc*:file=/data/logs/gc.log` 依赖的目录必须先创建，否则 JVM 启动会报错：

```bash
mkdir -p /data/heapdump
mkdir -p /data/logs
```

---

## 6. 加载并启动服务

加载配置：

```bash
systemctl daemon-reload
```

启动服务：

```bash
systemctl start aiwenzhen-test
```

查看状态：

```bash
systemctl status aiwenzhen-test
```

正常输出：

```text
Active: active (running)
```

停止服务：

```bash
systemctl stop aiwenzhen-test
```

重启服务：

```bash
systemctl restart aiwenzhen-test
```

设置开机启动：

```bash
systemctl enable aiwenzhen-test
```

---

## 7. 日志查看

原来：

```bash
tail -f nohup_xxx.log
```

现在改用 journalctl：

```bash
# 实时跟踪日志
journalctl -u aiwenzhen-test -f

# 查看最近 200 行
journalctl -u aiwenzhen-test -n 200
```

---

## 8. 停止、启动、重启

```bash
systemctl stop aiwenzhen-test     # 停止
systemctl start aiwenzhen-test    # 启动
systemctl restart aiwenzhen-test  # 重启
```

---

## 9. 放心加上 `-XX:+ExitOnOutOfMemoryError`

之前用 nohup 时不敢加 `-XX:+ExitOnOutOfMemoryError`，因为：

```text
OOM
 |
JVM 退出
 |
服务挂掉        ← 直接没了，没人拉起
```

迁移到 systemd 后，流程变成了：

```text
OOM
 |
JVM 退出
 |
systemd 检测
 |
Restart=always
 |
10 秒后重新启动
```

所以现在可以放心增加：

```ini
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/heapdump
-XX:+ExitOnOutOfMemoryError
```

---

## 10. 内存参数优化建议

原脚本默认 `-Xms256m -Xmx1024m`。如果只是测试环境，这个配置够用；但如果这台机器是**之前已经出现过 OOM 的生产环境**，建议直接固定为：

```ini
-Xms2g
-Xmx2g
```

原因：

- **避免运行过程中动态扩容**，启动时一次性分配，性能更稳定；
- 配合 G1 垃圾回收器表现更好；
- 延迟更低，减少 GC 抖动。

---

## 11. 最终的生产版服务

一份具备完整自愈能力的生产版 systemd 服务，至少应包含：

```ini
-Xms2g
-Xmx2g
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/data/heapdump
-XX:+ExitOnOutOfMemoryError
-Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=10,filesize=100M
Restart=always
RestartSec=10
```

这样服务就具备了：

- ✅ JVM OOM 自动留证（HeapDump）
- ✅ GC 问题可追踪（GC 日志）
- ✅ JVM 异常自动恢复（ExitOnOOM + Restart）
- ✅ 服务器重启自动启动（systemctl enable）

这比原来的 `nohup` 方式可靠很多，推荐尽早迁移。
