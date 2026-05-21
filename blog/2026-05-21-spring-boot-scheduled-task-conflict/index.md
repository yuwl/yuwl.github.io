---
slug: spring-boot-scheduled-task-conflict
title: Spring Boot 定时任务冲突：为什么我的 @Scheduled 任务没有按时执行？
date: 2026-05-21 10:00
authors: [yuwl]
tags: [java, springboot, scheduled, bug-fix]
---

在 Spring Boot 开发中，`@Scheduled` 是一种非常便捷的定时任务实现方案。然而，很多开发者在项目运行一段时间后，会发现某些定时任务莫名其妙地“罢工”了。是 Cron 表达式写错了吗？还是服务器宕机了？

今天我们通过一个真实案例来聊聊：为什么你的定时任务会相互冲突，以及该如何彻底解决。

<!-- truncate -->

## 1. 现象描述

假设我们有两个定时任务：

1. **HIS 测试数据生成任务**：每天凌晨 01:00 执行。
```java
@Scheduled(cron = "0 0 1 * * ?")
public void generateDailyPatientData() {
    log.info("开始执行 HIS 测试数据生成定时任务");
    // 业务逻辑...
}
```

2. **自动完成暂停录音任务**：每小时整点执行一次。
```java
@Scheduled(cron = "0 0 * * * ?")
public void completePausedMeetings() {
    log.info("定时任务开始完成暂停录音任务");
    // 内部包含耗时逻辑和 Thread.sleep(3000)
}
```

**问题出现了**：原本应该在 01:00 执行的 `generateDailyPatientData` 经常没有按时执行，或者干脆没有日志输出。

## 2. 原因分析

你的直觉是对的：它确实“冲突”了。

### 核心诱因：默认单线程机制
Spring Boot 的 `@Scheduled` 定时任务在默认配置下是**单线程**的。`ThreadPoolTaskScheduler` 的线程池默认大小（poolSize）为 **1**。

这意味着：任何时刻，全应用只有一个名为 `scheduling-1` 的线程在处理所有的计划任务。

### 阻塞链路
1. **触发重叠**：`generateDailyPatientData` 在 01:00 触发，而 `completePausedMeetings` 同样在 01:00 触发。
2. **任务排队**：如果线程池中唯一的线程先被 `completePausedMeetings` 占用了，那么 `generateDailyPatientData` 就必须排队等待。
3. **耗时阻塞**：如果 `completePausedMeetings` 内部逻辑复杂，或者代码中存在 `Thread.sleep(3000)` 等休眠操作，单线程会被长时间占用。
4. **任务跳过/丢失**：如果排队时间过长，甚至可能导致后一个任务因为时间窗口已过而直接被跳过，导致“任务不执行”的假象。

## 3. 解决方案

### 方案一：错开执行时间（治标）
最简单、快速的修复方式是将触发时间稍微错开，避开整点高峰。

例如，将业务任务改到 01:05 分执行：
```java
// 从 0 0 1 * * ? 修改为 0 5 1 * * ?
@Scheduled(cron = "0 5 1 * * ?")
public void generateDailyPatientData() { ... }
```
这能缓解冲突，但如果前面的任务运行超过 5 分钟，问题依然会复现。

### 方案二：配置专用线程池（治本）
最彻底的解决方法是扩大定时任务的线程池，取消默认的单线程限制，允许不同任务并发并行执行。

在你的配置文件（`application.properties` 或 `application.yml`）中添加以下配置：

**Properties 格式：**
```properties
# 开启多线程处理定时任务，避免单线程阻塞
spring.task.scheduling.pool.size=10
```

**YAML 格式：**
```yaml
spring:
  task:
    scheduling:
      pool:
        size: 10
```

配置后，Spring Boot 会为一个定时任务分配独立的线程（如 `scheduling-1`, `scheduling-2` 等）。即便 `completePausedMeetings` 和 `generateDailyPatientData` 在同一时刻触发，它们也会在不同的线程中并发运行，互不打扰。

## 4. 总结

在实际开发中，遇到定时任务不执行的情况，第一步应该确认是否存在**多任务共享单线程**的问题。尤其当任务中包含：
- 远程 API 调用（IO 耗时）
- 大数据量循环处理
- 显式的 `Thread.sleep`

请务必记得调大 `spring.task.scheduling.pool.size`，让你的定时任务能够“并驾齐驱”。
