---
slug: handle-lab-result-concurrency-with-distributed-lock
title: 处理第三方推送中的高并发幂等与分布式锁实践
date: 2026-05-18 09:00
authors: [yuwl]
tags: [java, mysql, concurrency, bug-fix, redis]
---

要在信息化集成中，三方系统（如 LIS、HIS）向我们的系统推送数据是核心业务之一。最近在处理“检验结果推送”接口时，遇到了一个典型的由于上游系统行为异常导致的并发一致性问题。本文记录了从发现问题到使用本地锁，再到最终演进为 Redis 分布式锁的优化过程。

<!-- truncate -->

## 1. 问题背景

### 业务场景
我们的系统提供了一个接口，用于接收批量检验结果推送。原本的逻辑是按 `instanceId`（实例 ID）+ `visitId`（就诊 ID）建立联合唯一索引，采用 `batchInsertOrUpdate`（批量插入或更新）的方式保证数据落库。

### 突发状况
1. **唯一索引失效**：由于上游推送的数据格式调整，原本依赖的 `instanceId + visitId` 唯一索引不再能满足业务逻辑（可能导致同批次内数据覆盖或冲突）。
2. **高并发重复推送**：日志显示，上游客户端存在严重的并发重推现象。同样的数据会在极短时间内（毫秒级）重复发送两次：
   ```log
   2026-05-15 08:35:09 [http-nio-8741-exec-15] INFO  HisPushController - 检验结果推送接口调用，入参: [{"instanceId":"902941","LISIRVisitNumber":1203150,...}]
   2026-05-15 08:35:09 [http-nio-8741-exec-17] INFO  HisPushController - 检验结果推送接口调用，入参: [{"instanceId":"902941","LISIRVisitNumber":1203150,...}]
   ```
   这种高并发下的重复数据，如果处理不当，会导致数据库中数据翻倍、主键冲突或更新覆盖不全。

## 2. 解决方案：重构落库逻辑

为了解决上述问题，我们决定废弃旧的数据库唯一索引，改在代码层面通过“**先删后插**”的模式结合**并发锁**来实现幂等。

### 第一阶段：本地锁实现（String.intern）
在单机环境下，我们首先考虑了利用 JVM 内存锁来控制。

**实现思路：**
1. 按 `instanceId` 和 `visitId` 对推送数据进行分组。
2. 使用 `(key).intern()` 获取字符串常量池引用作为锁对象。
3. 在 `synchronized` 块中执行 `delete` + `batchInsert`。

```java
// 使用 intern() 获取唯一锁对象，控制高并发下的重复推送
String lockKey = ("PatientLabResultPush_" + first.getInstanceId() + "_" + first.getVisitId()).intern();
synchronized (lockKey) {
    // 先删除旧数据（清理掉可能已存在的重复数据）
    patientLabResultPushMapper.deleteByInstanceIdAndVisitId(first.getInstanceId(), first.getVisitId());
    // 然后重新批量插入
    patientLabResultPushMapper.batchInsert(list);
}
```

**幂等原理：**
- **请求 A** 拿到锁，执行删除并插入。
- **请求 B** 随后到达，在 `synchronized` 处排队。
- **请求 A** 结束后释放锁，**请求 B** 立即进入，先执行 `delete` 把 **请求 A** 刚刚插入的数据洗掉，再插入自己的。
- 最终结果是：无论推了多少次，数据库里始终只有最后一次成功的全量数据。

### 第二阶段：演进为 Redis 分布式锁
虽然本地锁解决了单机问题，但随着系统向集群/微服务架构演进，不同节点的内存是隔离的，`String.intern()` 锁将失效。为了实现“一劳永逸”，我们将方案升级为基于 Redis 的分布式锁。

**分布式方案配置：**
- **锁工具**：`StringRedisTemplate`
- **策略**：`SETNX + 过期时间 + 自旋重试`

**核心代码实现：**
```java
String lockKey = "LOCK:PatientLabResultPush_" + first.getInstanceId() + "_" + first.getVisitId();
boolean locked = false;
try {
    // 1. 尝试获取分布式锁（自旋等待 3 秒）
    long startTime = System.currentTimeMillis();
    while (!(locked = Boolean.TRUE.equals(stringRedisTemplate.opsForValue().setIfAbsent(lockKey, "1", 5, TimeUnit.SECONDS)))) {
        if (System.currentTimeMillis() - startTime > 3000) {
            log.warn("获取Redis分布式锁超时，放弃推送，key: {}", lockKey);
            break;
        }
        Thread.sleep(50); // 50ms 后重试
    }
    
    if (locked) {
        // 2. 执行核心幂等业务：先删后插
        patientLabResultPushMapper.deleteByInstanceIdAndVisitId(first.getInstanceId(), first.getVisitId());
        patientLabResultPushMapper.batchInsert(list);
    }
} finally {
    // 3. 释放锁
    if (locked) {
        stringRedisTemplate.delete(lockKey);
    }
}
```

## 3. 为什么这样做？

1. **分布式安全**：即使并发请求被分发到不同的服务器节点，Redis 的分布式锁也能强制它们排队执行。
2. **处理“脏数据”**：通过“先删后插”模式，我们不需要复杂的 `Merge` 语句，直接保证了最终一致性。
3. **极简幂等**：利用锁的串行化特性，将并发竞争转化为了顺序覆盖，完美解决了高并发重复推数导致的数据翻倍问题。

## 总结
面对上游系统的不确定性，后端开发必须具备“防御性编程”思想。从本地 `synchronized` 到分布式 Redis 锁，这不仅仅是工具的更替，更是对系统架构可靠性的深度思考。
