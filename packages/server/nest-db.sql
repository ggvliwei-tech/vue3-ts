-- =============================================
-- NestJS11 项目初始化数据库脚本 MySQL 8.0+
-- 数据库：nest_db
-- 数据表：sys_user 系统用户表
-- =============================================

-- 1. 创建数据库，不存在则新建，字符集utf8mb4完整支持emoji
CREATE DATABASE IF NOT EXISTS `nest_db` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 使用该数据库
USE `nest_db`;

-- 2. 删除旧表（避免重复执行报错）
DROP TABLE IF EXISTS `sys_user`;

-- 3. 创建用户表 完全对应 TypeORM User实体
CREATE TABLE `sys_user` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '自增主键ID',
  `username` VARCHAR(50) NOT NULL COMMENT '登录用户名',
  `password` VARCHAR(100) NOT NULL COMMENT '加密后密码',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '账号状态：1正常 0禁用',
  `createTime` BIGINT NOT NULL COMMENT '创建时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_sys_user_username` (`username`) COMMENT '用户名唯一约束'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='系统用户表';

-- 迁移：2026-08-11 RefreshToken 迁移至 Redis，删除数据库中的冗余字段
ALTER TABLE `sys_user` DROP COLUMN IF EXISTS `refreshToken`;

-- 4. 初始化一条管理员测试数据（密码：123456 bcrypt加密字符串）
INSERT INTO `sys_user` (`username`, `password`, `status`)
VALUES ('admin', '$2b$10$vI8aWBqBg5nTRcXeaMlyLu/E0c2p61c/jAF7oypnE7j4Vbtc9Qv2', 1);

-- 5. 可选：TypeORM迁移记录表（自动生成，提前建好防止迁移命令报错）
DROP TABLE IF EXISTS `typeorm_migrations`;
CREATE TABLE `typeorm_migrations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `timestamp` BIGINT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='TypeORM迁移版本记录表';


USE nest_db;
-- 给account_book增加所属用户ID，关联sys_user.id
ALTER TABLE `account_book` ADD COLUMN `user_id` INT UNSIGNED NOT NULL COMMENT '创建人用户ID';

-- 外键约束（可选，保证数据完整性，不需要可删掉）
ALTER TABLE `account_book`
ADD CONSTRAINT `fk_account_book_user`
FOREIGN KEY (`user_id`) REFERENCES `sys_user`(`id`)
ON DELETE CASCADE; -- 用户删除，账本级联删除


CREATE TABLE `sys_file` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `original_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `save_name` VARCHAR(255) NOT NULL COMMENT '服务器存储文件名',
  `file_path` VARCHAR(500) NOT NULL COMMENT '文件相对存储路径/OSS Key',
  `url` VARCHAR(500) NOT NULL COMMENT '可访问完整URL地址',
  `mime_type` VARCHAR(100) NOT NULL COMMENT '文件MIME类型，如image/png',
  `size` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小(字节)',
  `storage_type` VARCHAR(20) NOT NULL DEFAULT 'local' COMMENT '存储类型：local本地/oss阿里云OSS',
  `module` VARCHAR(50) DEFAULT NULL COMMENT '归属模块：avatar头像、goods商品图、contract合同附件等',
  `upload_user_id` INT UNSIGNED DEFAULT NULL COMMENT '上传人用户ID',
  `create_time` BIGINT NOT NULL COMMENT '上传时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_module` (`module`),
  KEY `idx_upload_user_id` (`upload_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件上传记录表';



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


-- =============================================
-- AI 对话模块数据库表结构
-- 说明：TypeORM synchronize: true 时自动创建
--       此文件用于手动建表或生产环境初始化
-- =============================================

-- 1. AI 会话表
CREATE TABLE IF NOT EXISTS `ai_session` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `session_id` VARCHAR(36) NOT NULL COMMENT '会话UUID',
  `title` VARCHAR(100) DEFAULT '新对话' COMMENT '会话标题',
  `created_at` BIGINT NOT NULL COMMENT '创建时间(毫秒时间戳)',
  `updated_at` BIGINT NOT NULL COMMENT '更新时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_session_user` (`session_id`, `user_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI会话表';

-- 2. AI 消息表
CREATE TABLE IF NOT EXISTS `ai_message` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `session_id` INT NOT NULL COMMENT '会话ID',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `role` VARCHAR(20) NOT NULL COMMENT '角色: user/assistant',
  `content` VARCHAR(5000) NOT NULL COMMENT '消息内容',
  `created_at` BIGINT NOT NULL COMMENT '发送时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI消息表';
