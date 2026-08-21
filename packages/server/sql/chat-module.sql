-- =============================================
-- 聊天室模块数据库表结构
-- 说明：TypeORM synchronize: true 时自动创建
--       此文件用于手动建表或生产环境初始化
-- =============================================

-- 1. 聊天房间表
CREATE TABLE IF NOT EXISTS `chat_room` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `name` VARCHAR(100) NOT NULL COMMENT '房间名称',
  `creatorId` INT NOT NULL COMMENT '创建人用户ID',
  `createdAt` BIGINT NOT NULL COMMENT '创建时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  INDEX `idx_creator` (`creatorId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='聊天房间表';

-- 2. 聊天房间成员表
CREATE TABLE IF NOT EXISTS `chat_member` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `roomId` INT NOT NULL COMMENT '房间ID',
  `userId` INT NOT NULL COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL COMMENT '用户名',
  `joinedAt` BIGINT NOT NULL COMMENT '加入时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_user` (`roomId`, `userId`),
  INDEX `idx_room` (`roomId`),
  INDEX `idx_user` (`userId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='聊天房间成员表';

-- 3. 聊天消息表
CREATE TABLE IF NOT EXISTS `chat_message` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `roomId` INT NOT NULL COMMENT '房间ID',
  `senderId` INT NOT NULL COMMENT '发送者用户ID',
  `senderName` VARCHAR(50) NOT NULL COMMENT '发送者用户名',
  `content` VARCHAR(2000) NOT NULL COMMENT '消息内容',
  `createdAt` BIGINT NOT NULL COMMENT '发送时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  INDEX `idx_room` (`roomId`),
  INDEX `idx_room_created` (`roomId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='聊天消息表';
