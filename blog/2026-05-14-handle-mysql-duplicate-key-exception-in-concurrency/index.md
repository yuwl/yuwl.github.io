---
slug: handle-mysql-duplicate-key-exception-in-concurrency
title: 并发导致的 Duplicate Key 冲突：从分析到解决
date: 2026-05-14 14:00
authors: [yuwl]
tags: [java, mysql, concurrency, bug-fix]
---

在分布式或高并发环境下，"先查询是否存在，再决定是否插入"的逻辑往往并不可靠。本文记录一个典型的并发导致重复键冲突（Duplicate Key）的问题分析与修复过程。

<!-- truncate -->

## 问题背景

在执行推送服务时，系统偶发性抛出 `DuplicateKeyException` 异常。经过排查发现，该报错发生在执行 `insert` 操作时，提示某个业务唯一标识（如 `instance_id`）已存在。

## 场景还原

相关的核心代码逻辑如下：

### 1. 入口控制器 (HisPushController.java)
在控制器层，我们通常会接收外部推送并调用服务层。

```java
// HisPushController.java 示例逻辑
@PostMapping("/push")
public Result pushData(@RequestBody PushDto dto) {
    // 处理推送逻辑...
    patientLabResultPushService.saveOrUpdate(dto);
    return Result.ok();
}
```

### 2. 服务层逻辑 (PatientLabResultPushService.java)
原本的逻辑如下，这也是最容易产生并发问题的写法：

```java
// PatientLabResultPushService.java
public void saveOrUpdate(PushDto dto) {
    // 1. 先根据实例ID查询
    Data entity = labResultMapper.selectByInstanceId(dto.getInstanceId());
    
    if (entity == null) {
        // 2. 如果不存在，则插入
        labResultMapper.insert(dto);
    } else {
        // 3. 如果已存在，则更新
        labResultMapper.update(dto);
    }
}
```

## 深度思考：为什么会报错？

这是一个典型的**并发时序问题**。当两个线程几乎同时处理同一个 `instance_id` 的数据时，会发生以下情况：

| 时间点 | 线程 A | 线程 B |
| :--- | :--- | :--- |
| T1 | 执行 `selectByInstanceId(882658)` | |
| T2 | 返回 `null` | 执行 `selectByInstanceId(882658)` |
| T3 | | 返回 `null` (因为此时 A 还没插入) |
| T4 | **执行 `insert` -> 成功** | |
| T5 | | **执行 `insert` -> 失败 (Duplicate Key Exception)** |

由于数据库层面存在唯一索引保护，线程 B 尝试插入相同的 ID 时就会触发报错。

## 解决方案：MySQL 原子化操作

要解决这个问题，不能依赖 Java 层的 "先查后猜"，而应该利用数据库的原子化能力。

### 使用 `INSERT ... ON DUPLICATE KEY UPDATE`

这是 MySQL 提供的一种优雅处理方式：如果发现唯一健冲突，则执行更新操作。这在数据库底层是原子性的，不会出现中间态。

**修改后的 SQL (MyBatis Mapper 示例):**

```xml
<insert id="upsertLabResult">
    INSERT INTO patient_lab_result (
        instance_id, patient_name, result_data
    ) VALUES (
        #{instanceId}, #{patientName}, #{resultData}
    )
    ON DUPLICATE KEY UPDATE
        patient_name = VALUES(patient_name),
        result_data = VALUES(result_data),
        update_time = NOW()
</insert>
```

## 总结

1. **不要在 Java 代码中通过“先查再插”来处理唯一性限制**，这种逻辑在并发面前非常脆弱。
2. **利用数据库特性**：使用 `ON DUPLICATE KEY UPDATE` (MySQL) 或 `UPSERT` (PostgreSQL) 来实现原子化的“存在即更新，不存在即插入”。
3. **异常兜底**：即便使用了数据库特性，在极其复杂的环境下（如分库分表），依然建议在代码层捕获 `DuplicateKeyException` 并进行合理的业务重试或日志记录。
