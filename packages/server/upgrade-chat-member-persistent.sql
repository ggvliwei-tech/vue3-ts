-- =============================================
--  chat_member 语义变更升级脚本：在线状态表 → 持久成员关系
--
--  背景：旧模型下 chat_member 同时承担「能否读这个房间」的授权依据和
--        「谁现在连着」的在线状态。而退出房间时会 memberRepo.delete() 物理删行，
--        导致下次进入房间时 assertUserInRoom 必然 403（前端表现为
--        「您不在该房间中」，随后又自行恢复）。
--        改为持久成员关系后，成员行不再随连接生灭；在线状态改由
--        Socket.IO fetchSockets() 实时计算。
--
--  适用：已有数据库（增量补数据，不改表结构，不删任何行）
--  幂等：全部 INSERT IGNORE，可重复执行
--  注意：与 nest-db.sql 的 chat_member DDL 保持一致；本脚本不要并入 nest-db.sql
--        （后者每张表都 DROP TABLE IF EXISTS，是 bootstrap 脚本，重跑会清库）
-- =============================================

-- =============================================
-- Step 0【强制前置】确认唯一键存在
-- =============================================
--  本脚本的 INSERT IGNORE 完全依赖 uk_chat_member_room_user 才能去重。
--  唯一键缺失时 INSERT IGNORE 不报错、也不去重，会静默插出重复行 —— 这是本脚本最危险的失败模式。
--
--  判定标准：返回行数 == 该唯一键的列数（本键是 (roomId, userId)，故**应为 2 行**，
--  每列一行；单列唯一键才是 1 行），且每行 NON_UNIQUE 均为 0。
--  返回空集就先把键补上（见末尾附注），不要继续往下执行。
SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'chat_member'
  AND INDEX_NAME   = 'uk_chat_member_room_user';

-- =============================================
-- Step 1 dry-run：先看会补多少行（只读，可随时执行）
-- =============================================
--  重建口径 =「在该房间发过言的人」，因为旧模型下发消息必须先成为成员
--  （chat.gateway.ts 的 handleMessage 有 socket 房间 + DB 成员双重校验），
--  所以「发过言」⊆「曾是成员」，这批人的成员关系可以被精确重建。
SELECT COUNT(*) AS will_insert_from_speakers
FROM (
  SELECT `roomId`, `senderId`, MIN(`createdAt`) AS `joinedAt`
  FROM `chat_message`
  WHERE `senderId` > 0
  GROUP BY `roomId`, `senderId`
) AS t;

-- =============================================
-- Step 2 迁移 1/2：按「首次发言」补回曾发言用户的成员关系
-- =============================================
--  joinedAt 取该用户在本房间的最早发言时间（近似真实加入时间）。
--  username 取「最早那条发言」的 senderName：写成 JOIN + GROUP BY 而不是 ANY_VALUE()，
--  是为了在 ONLY_FULL_GROUP_BY 下结果仍然确定（ANY_VALUE 的取值是任意的）。
--  同一 (roomId, senderId, createdAt) 若存在多条不同 senderName，最多产生 2 行，
--  INSERT IGNORE 会保留先插入的那条，不影响正确性。
INSERT IGNORE INTO `chat_member` (`roomId`, `userId`, `username`, `joinedAt`)
SELECT t.`roomId`, t.`senderId`, m.`senderName`, t.`joinedAt`
FROM (
  SELECT `roomId`, `senderId`, MIN(`createdAt`) AS `joinedAt`
  FROM `chat_message`
  WHERE `senderId` > 0
  GROUP BY `roomId`, `senderId`
) AS t
JOIN `chat_message` AS m
  ON  m.`roomId`    = t.`roomId`
  AND m.`senderId`  = t.`senderId`
  AND m.`createdAt` = t.`joinedAt`
GROUP BY t.`roomId`, t.`senderId`, m.`senderName`, t.`joinedAt`;

-- =============================================
-- Step 3 迁移 2/2：补回房间创建者
-- =============================================
--  createRoom 本来就在同一事务里把创建者写入 chat_member，
--  但这些行可能已被旧的 leave-room 删掉。创建者可能从未发言，Step 2 覆盖不到。
--  username 从 sys_user 取当前名（比历史 senderName 更准）；joinedAt 取房间创建时间。
INSERT IGNORE INTO `chat_member` (`roomId`, `userId`, `username`, `joinedAt`)
SELECT r.`id`, r.`creatorId`, u.`username`, r.`createdAt`
FROM `chat_room` AS r
JOIN `sys_user`  AS u ON u.`id` = r.`creatorId`;

-- =============================================
-- Step 4 验证：以下查询必须符合预期
-- =============================================

-- 4.1 重复检查：必须返回 0 行（有重复说明 Step 0 的唯一键没生效，请回滚重做）
SELECT `roomId`, `userId`, COUNT(*) AS c
FROM `chat_member`
GROUP BY `roomId`, `userId`
HAVING c > 1;

-- 4.2 抽样核对：成员数 vs 该房间发过言的人数（成员数应 >= 发言人数 + 创建者）
SELECT r.`id`   AS room_id,
       r.`name` AS room_name,
       (SELECT COUNT(*) FROM `chat_member` cm WHERE cm.`roomId` = r.`id`) AS member_count,
       (SELECT COUNT(DISTINCT gm.`senderId`) FROM `chat_message` gm WHERE gm.`roomId` = r.`id`) AS speaker_count
FROM `chat_room` r
ORDER BY r.`id`;

-- =============================================
-- 已知局限（必须在部署说明里讲清楚，这不是脚本缺陷）
-- =============================================
--  1. 只覆盖「发过言的人」+「房间创建者」。旧模型下「进过房间但从没说过话」的用户，
--     其成员行早已被物理删除，没有留下任何痕迹，**不可恢复**。
--     这批人迁移后在「我的房间」里看不到以前去过的房间，需要走一次「发现房间 → 加入」；
--     新流程下只要再进一次房间就会自动幂等补回成员关系。
--  2. joinedAt 是「首次发言时间」而非真实加入时间，会让他们在成员列表里排得偏后。
--  3. username 是「首次发言时的历史名」。若用户改过名，与 sys_user.username 不一致。
--     想统一可把 Step 2 的 m.senderName 换成 JOIN sys_user 取当前名，代价是丢失历史名。
--  4. Step 2 会全表扫描 chat_message。大表上请按 roomId 分批执行（循环加
--     WHERE roomId BETWEEN ? AND ?）、或在低峰期执行，避免长事务与 MDL 锁。
--  5. 本脚本只补数据，不改表结构（唯一键本来就对）。

-- =============================================
-- 附注：Step 0 返回空集时，先补唯一键再重跑本脚本
-- =============================================
--  -- (a) 先看有没有重复（旧表理论上不该有，但 INSERT IGNORE 静默失败过就可能脏）
--  SELECT `roomId`, `userId`, COUNT(*) AS c
--  FROM `chat_member` GROUP BY `roomId`, `userId` HAVING c > 1;
--
--  -- (b) 有重复则保留 id 最小的那条
--  DELETE t1 FROM `chat_member` t1
--    JOIN `chat_member` t2
--      ON t1.`roomId` = t2.`roomId`
--     AND t1.`userId` = t2.`userId`
--     AND t1.`id`     > t2.`id`;
--
--  -- (c) 补唯一键
--  ALTER TABLE `chat_member`
--    ADD UNIQUE KEY `uk_chat_member_room_user` (`roomId`, `userId`);
