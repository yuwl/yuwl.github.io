---
slug: intranet-linux-java-vue-deploy-notes
title: 内网 Linux 下 JDK + Nginx + Redis + Vue 一键部署笔记
date: 2026-06-12 17:00
authors: [yuwl]
tags: [deploy, linux, nginx, redis, java, vue]
---

在内网环境中部署 Java + Vue 项目时，JDK、Nginx、Redis、Firewall 这几样“基本功”往往要反复配置。本文把我日常在内网 Linux 机器上搭建一套 `Spring Boot + Vue` 前后端分离项目时常用的命令与配置整理成一篇速查笔记，方便后续复制粘贴。

<!-- truncate -->

## 1. JDK 配置

我习惯把 JDK 装在 `/opt` 目录下，然后通过 `/etc/profile.d/` 下的独立 shell 文件来配置全局环境变量。这样做的好处是：**JDK 版本与系统解耦**，将来要换 JDK 8 / 11 / 17 / 21 时只需要再加一个 `.sh` 文件即可，不会污染 `/etc/profile`。

### 1.1 解压安装

假设安装包是 `jdk-17_linux-x64_bin.tar.gz`，先解压到 `/opt`：

```bash
tar -zxvf jdk-17_linux-x64_bin.tar.gz -C /opt/
mv /opt/jdk-17 /opt/java17
```

### 1.2 配置全局环境变量

新建 `/etc/profile.d/java17.sh`：

```bash
vim /etc/profile.d/java17.sh
```

内容如下：

```bash
export JAVA_HOME=/opt/java17
export PATH=$JAVA_HOME/bin:$PATH
```

让配置立即生效：

```bash
source /etc/profile.d/java17.sh
java -version
```

正常情况下会看到类似：

```text
openjdk version "17.0.x" 2024-xx-xx
OpenJDK Runtime Environment (build 17.0.x+xx)
OpenJDK 64-Bit Server VM (build 17.0.x+xx, mixed mode, sharing)
```

> 小贴士：如果是 root 用户配置，**当前会话**和**新打开的 SSH 会话**都会自动加载 `/etc/profile.d/` 下的脚本；如果是普通用户，需要 `source` 一次或者重新登录。

---

## 2. Nginx 配置（带 OpenSSL，支持 HTTPS）

Nginx 编译安装时如果不指定 `--with-openssl`，就只用了系统自带的 OpenSSL，版本不可控。为了后续做国密、TLS 1.3 等扩展，我习惯**源码编译一份 OpenSSL 1.1.1 系列并静态链接进 Nginx**。

### 2.1 准备 OpenSSL 源码

```bash
cd /usr/local/src
tar -zxvf openssl-1.1.1w.tar.gz
ls /usr/local/src/openssl-1.1.1w/
```

确认目录里能看到 `Configure`、`crypto/`、`ssl/`、`include/openssl/` 等关键文件。

### 2.2 编译安装 Nginx

```bash
tar zxvf nginx-1.24.0.tar.gz
cd nginx-1.24.0
./configure \
--prefix=/usr/local/nginx \
--with-http_ssl_module \
--with-http_stub_status_module \
--with-openssl=/usr/local/src/openssl-1.1.1w
make
make install
```

编译完成后，目录结构如下：

```text
/usr/local/nginx/
├── conf/
│   ├── nginx.conf            # ★ 主配置文件
│   ├── nginx.conf.default
│   ├── mime.types
│   └── ...
├── sbin/
│   └── nginx                 # 启动二进制
├── logs/                     # access.log / error.log / pid
├── html/                     # 默认欢迎页 (index.html)
└── client_body_temp/ 等临时目录
```

常用命令：

```bash
/usr/local/nginx/sbin/nginx                 # 启动
/usr/local/nginx/sbin/nginx -s reload       # 重载配置
/usr/local/nginx/sbin/nginx -s stop         # 停止
/usr/local/nginx/sbin/nginx -t              # 检查配置
```

### 2.3 反向代理 + 静态站点配置

下面是一份我常用的 `nginx.conf` 片段：

- `/his/aiwenzhen` 走**前端静态资源**（Vue 打包后的 `dist`）
- `/his/hospital` 走**后端 Java 集群**（`upstream` + `keepalive`）

```nginx
upstream hospital_backend {
    # 默认轮询（round-robin）
    server 127.0.0.1:8082 weight=1;
    server 168.107.2.70:8083 weight=1;

    # 保持长连接，减少握手开销
    keepalive 32;
}

server {
    listen 8081;
    server_name localhost;

    # 前端静态站点（Vue 打包后的 dist）
    location /his/aiwenzhen {
        alias "/data/aiwenzhen-html/dist/";
        index aiwenzhen.html;
        try_files $uri $uri/ /his/aiwenzhen/aiwenzhen.html;
    }

    # 后端 Java 服务
    location /his/hospital {
        proxy_pass http://hospital_backend;   # 引用 upstream 组名

        proxy_http_version 1.1;
        proxy_set_header Connection "";       # 配合 keepalive 必须设置

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
```

几个关键点说明：

- **`alias` vs `root`**：这里使用 `alias` 是因为 `/his/aiwenzhen` 这个前缀在磁盘上**并不存在**，我们想把它“映射”到 `E:/aiwenzhen-html/dist/`。使用 `root` 会导致路径拼上前缀，找不到文件。
- **`try_files`**：解决 Vue 的 History 模式刷新 404 问题，所有未命中的请求都回退到 `aiwenzhen.html`。
- **`keepalive 32` + `proxy_http_version 1.1` + `Connection ""`**：三者必须配合，否则 `keepalive` 不会生效，Java 后端会出现大量 TIME_WAIT。
- **`X-Forwarded-For` / `X-Real-IP`**：Java 后端如果要获取真实客户端 IP，必须依赖这两个头。

---

## 3. Redis 安装配置

内网环境通常用 Redis 5.0.4 这种稳定版本做缓存或分布式锁。Redis 安装最简单：**下载 → 解压 → 编译**，无需 `./configure`。

### 3.1 下载、解压、编译

```bash
wget http://download.redis.io/releases/redis-5.0.4.tar.gz
tar xzf redis-5.0.4.tar.gz
cd redis-5.0.4
make
```

编译完成后，二进制文件在 `src/` 目录下。

### 3.2 修改配置

生产环境最常用的几项配置：

```bash
vim redis.conf
```

```conf
# 绑定本机和内网网段（按需调整）
bind 127.0.0.1 192.168.x.x

# 后台运行
daemonize yes

# 设置密码（强烈建议）
requirepass yourpassword
```

其他常见可选配置：

```conf
# 修改端口
port 6379

# 开启 AOF 持久化
appendonly yes

# 设置最大内存 + 淘汰策略
maxmemory 2gb
maxmemory-policy allkeys-lru
```

### 3.3 启动与验证

```bash
src/redis-server redis.conf
```

通过内置客户端验证：

```bash
src/redis-cli
127.0.0.1:6379> auth yourpassword
OK
127.0.0.1:6379> set foo bar
OK
127.0.0.1:6379> get foo
"bar"
```

> 小贴士：在内网部署时，`bind` 不要写 `0.0.0.0`，而应该只绑定内网 IP，**配合防火墙** 双重保险。

---

## 4. 防火墙配置（firewalld）

CentOS / RHEL 系默认使用 `firewalld`。很多人会直接 `systemctl stop firewalld`，这在内网机器上**非常不推荐**——一旦某天对外开放，立刻裸奔。

正确的做法是：**firewalld 保持运行，按 zone 精确放行**。

### 4.1 先确认 firewalld 状态与 zone

```bash
sudo systemctl status firewalld
sudo firewall-cmd --state
```

确认“真正接流量的网卡”在哪个 zone：

```bash
sudo firewall-cmd --get-active-zones
```

常见输出：

```text
public
  interfaces: eth0
```

查看当前 zone 的所有规则：

```bash
sudo firewall-cmd --zone=public --list-all
```

### 4.2 放行 8081 端口

以放行 Nginx 监听的 `8081` 端口为例。**同时操作“运行时”和“永久”**：

```bash
# A. 临时放行（立刻生效，重启/重载后消失）——用于快速验证
sudo firewall-cmd --zone=public --add-port=8081/tcp

# B. 永久放行（写入配置文件，重启后仍有效）
sudo firewall-cmd --permanent --zone=public --add-port=8081/tcp

# C. 重载让永久规则生效（不会把现有连接打挂）
sudo firewall-cmd --reload
```

验证：

```bash
sudo firewall-cmd --zone=public --list-all
```

应能看到 `ports: 8081/tcp`。

### 4.3 常用命令速查

```bash
# 放行服务
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https

# 放行端口段
sudo firewall-cmd --permanent --zone=public --add-port=8000-8100/tcp

# 移除规则
sudo firewall-cmd --permanent --zone=public --remove-port=8081/tcp
sudo firewall-cmd --reload

# 放行特定 IP 访问
sudo firewall-cmd --permanent --zone=public --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" accept'
```

> 小贴士：操作 firewall 之前，**先确认自己有 Console 或者带外管理口**，否则一个 `--remove-service=ssh` 可能直接把你锁在门外。

---

## 5. 一键部署顺序建议

把这几样串起来，内网部署一台机器的标准顺序：

1. **JDK**：解压 → `/etc/profile.d/java17.sh` → `java -version` 验证。
2. **Redis**：编译 → 修改 `redis.conf`（bind / daemonize / requirepass）→ `redis-server` 后台启动。
3. **Nginx**：编译带 OpenSSL → 配置 `upstream` + `location` → `nginx -t` 验证 → `nginx` 启动。
4. **Java 后端**：把 Spring Boot jar 放到 `/opt/app/`，用 `systemd` 或 `nohup` 启动，确保监听在 `upstream` 配置的端口上。
5. **防火墙**：临时 + 永久放行 Nginx 监听端口（本文是 `8081`），`reload` 后用其他机器 `curl` 验证。
6. **Vue 前端**：本地 `npm run build` 生成 `dist/`，把 `dist/` 拷贝到 Nginx 配的 `alias` 目录。

只要这几步跑通，一套“内网 Linux + Java + Vue + Nginx + Redis”的最小可用部署就完成了，剩下的就是接入 CI/CD、监控、日志收集等“高阶玩法”了。
