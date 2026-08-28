-- =============================================
-- NestJS11 项目数据库初始化脚本 (MySQL 8.0+)
-- 数据库：nest_db
-- 字符集：utf8mb4 / utf8mb4_unicode_ci
-- 说明：
--   1. 本脚本按 src/modules/**/entities/*.entity.ts 中的 TypeORM 实体生成
--   2. 幂等可重复执行（先 DROP 再 CREATE + INSERT IGNORE 初始数据）
--   3. 执行前请确认 DB_HOST / DB_USER / DB_PWD 与 .env 配置一致
-- =============================================

-- 1. 创建数据库（不存在则新建）
CREATE DATABASE IF NOT EXISTS `nest_db`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `nest_db`;

-- 关闭外键检查，避免 DROP 因外键依赖报错
SET FOREIGN_KEY_CHECKS = 0;

-- =============================================
-- 2. 系统用户表 sys_user
-- 实体：modules/user/entities/user.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `username`   VARCHAR(50)  NOT NULL COMMENT '登录用户名',
  `password`   VARCHAR(100) NOT NULL COMMENT 'bcrypt 加密密码',
  `status`     TINYINT      NOT NULL DEFAULT 1 COMMENT '账号状态：1正常 0禁用',
  `createTime` BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  `phone`      VARCHAR(20)  NOT NULL COMMENT '手机号',
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uk_sys_user_username` (`username`) COMMENT '用户名唯一',
  UNIQUE INDEX `uk_sys_user_phone` (`phone`) COMMENT '手机号唯一'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统用户表';

-- =============================================
-- 3. 账本表 account_book
-- 实体：modules/account_book/entities/account-book.entity.ts
-- =============================================
DROP TABLE IF EXISTS `account_book`;
CREATE TABLE `account_book` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `websiteName`   VARCHAR(100) NOT NULL COMMENT '网站名称',
  `websiteUrl`    VARCHAR(255) NOT NULL DEFAULT '' COMMENT '网站地址',
  `loginAccount`  VARCHAR(100) NOT NULL COMMENT '登录账号',
  `loginPassword` VARCHAR(255) NOT NULL COMMENT '登录密码（序列化时排除）',
  `createdAt`     BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  `userId`        INT UNSIGNED NOT NULL COMMENT '创建人用户ID',
  `updatedAt`     BIGINT       NOT NULL COMMENT '修改时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_account_book_userId` (`userId`) COMMENT '按创建人查询',
  CONSTRAINT `fk_account_book_user`
    FOREIGN KEY (`userId`) REFERENCES `sys_user`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账本表';

-- =============================================
-- 4. 文件上传记录表 sys_file
-- 实体：modules/file/entities/file.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_file`;
CREATE TABLE `sys_file` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `originalName`  VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `saveName`      VARCHAR(255) NOT NULL COMMENT '服务器存储文件名',
  `filePath`      VARCHAR(500) NOT NULL COMMENT '文件相对路径/OSS Key',
  `url`           VARCHAR(500) NOT NULL COMMENT '可访问完整URL',
  `mimeType`      VARCHAR(100) NOT NULL COMMENT '文件MIME类型，如image/png',
  `size`          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '文件大小(字节)',
  `storageType`   VARCHAR(20)  NOT NULL DEFAULT 'local' COMMENT '存储类型：local本地 / oss阿里云OSS',
  `module`        VARCHAR(50)  DEFAULT NULL COMMENT '归属模块：avatar头像 / goods商品图 / contract合同附件',
  `uploadUserId`  INT UNSIGNED DEFAULT NULL COMMENT '上传人用户ID',
  `createTime`    BIGINT       NOT NULL COMMENT '上传时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_module` (`module`) COMMENT '归属模块索引',
  KEY `idx_upload_user_id` (`uploadUserId`) COMMENT '上传人索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件上传记录表';

-- =============================================
-- 5. 聊天房间表 chat_room
-- 实体：modules/chat/entities/chat-room.entity.ts
-- =============================================
DROP TABLE IF EXISTS `chat_room`;
CREATE TABLE `chat_room` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `name`      VARCHAR(100) NOT NULL COMMENT '房间名称',
  `creatorId` INT UNSIGNED NOT NULL COMMENT '创建人用户ID',
  `createdAt` BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_chat_room_creator` (`creatorId`) COMMENT '创建人索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天房间表';

-- =============================================
-- 6. 聊天房间成员表 chat_member
-- 实体：modules/chat/entities/chat-member.entity.ts
-- =============================================
DROP TABLE IF EXISTS `chat_member`;
CREATE TABLE `chat_member` (
  `id`       INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `roomId`   INT UNSIGNED NOT NULL COMMENT '房间ID',
  `userId`   INT UNSIGNED NOT NULL COMMENT '用户ID',
  `username` VARCHAR(50)  NOT NULL COMMENT '用户名（冗余存储）',
  `joinedAt` BIGINT       NOT NULL COMMENT '加入时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_chat_member_room_user` (`roomId`, `userId`) COMMENT '同一房间同一用户唯一',
  KEY `idx_chat_member_room` (`roomId`) COMMENT '房间查询',
  KEY `idx_chat_member_user` (`userId`) COMMENT '用户查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天房间成员表';

-- =============================================
-- 7. 聊天消息表 chat_message
-- 实体：modules/chat/entities/chat-message.entity.ts
-- =============================================
DROP TABLE IF EXISTS `chat_message`;
CREATE TABLE `chat_message` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `roomId`     INT UNSIGNED NOT NULL COMMENT '房间ID',
  `senderId`   INT UNSIGNED NOT NULL COMMENT '发送者用户ID',
  `senderName` VARCHAR(50)  NOT NULL COMMENT '发送者用户名',
  `content`    TEXT         NOT NULL COMMENT '消息内容',
  `createdAt`  BIGINT       NOT NULL COMMENT '发送时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_chat_msg_room` (`roomId`) COMMENT '按房间查询',
  KEY `idx_chat_msg_room_created` (`roomId`, `createdAt`) COMMENT '按房间按时间分页'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聊天消息表';

-- =============================================
-- 8. AI 会话表 ai_session
-- 实体：modules/ai/entities/ai-session.entity.ts
-- =============================================
DROP TABLE IF EXISTS `ai_session`;
CREATE TABLE `ai_session` (
  `id`        INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id`   INT UNSIGNED NOT NULL COMMENT '用户ID',
  `session_id` VARCHAR(36) NOT NULL COMMENT '会话UUID',
  `title`     VARCHAR(100) NOT NULL DEFAULT '新对话' COMMENT '会话标题',
  `created_at` BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  `updated_at` BIGINT       NOT NULL COMMENT '更新时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_session_user_session` (`session_id`, `user_id`) COMMENT '同一用户下会话UUID唯一',
  KEY `idx_ai_session_user` (`user_id`) COMMENT '按用户查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 会话表';

-- =============================================
-- 9. AI 消息表 ai_message
-- 实体：modules/ai/entities/ai-message.entity.ts
-- =============================================
DROP TABLE IF EXISTS `ai_message`;
CREATE TABLE `ai_message` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `session_id` INT UNSIGNED NOT NULL COMMENT '会话ID（关联 ai_session.id）',
  `user_id`    INT UNSIGNED NOT NULL COMMENT '用户ID',
  `role`       VARCHAR(20)  NOT NULL COMMENT '角色：user / assistant',
  `content`    TEXT         NOT NULL COMMENT '消息内容',
  `created_at` BIGINT       NOT NULL COMMENT '发送时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_ai_msg_session` (`session_id`) COMMENT '按会话查询',
  KEY `idx_ai_msg_user` (`user_id`) COMMENT '按用户查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='AI 消息表';

-- =============================================
-- 10. 角色表 sys_role
-- 实体：modules/rbac/entities/role.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_role`;
CREATE TABLE `sys_role` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `code`        VARCHAR(50)  NOT NULL COMMENT '角色编码：admin / editor / user',
  `name`        VARCHAR(50)  NOT NULL COMMENT '角色名称',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '角色描述',
  `status`      TINYINT      NOT NULL DEFAULT 1 COMMENT '状态：1启用 0禁用',
  `createTime`  BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_role_code` (`code`) COMMENT '角色编码唯一'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统角色表';

-- =============================================
-- 11. 权限表 sys_permission
-- 实体：modules/rbac/entities/permission.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_permission`;
CREATE TABLE `sys_permission` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `code`        VARCHAR(100) NOT NULL COMMENT '权限编码：user:list / book:create / ...',
  `name`        VARCHAR(100) NOT NULL COMMENT '权限名称',
  `module`      VARCHAR(50)  NOT NULL COMMENT '所属模块：user / book / file / ai',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '权限描述',
  `createTime`  BIGINT       NOT NULL COMMENT '创建时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sys_perm_code` (`code`) COMMENT '权限编码唯一',
  KEY `idx_sys_perm_module` (`module`) COMMENT '模块索引'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统权限表';

-- =============================================
-- 12. 用户-角色关联表 sys_user_role
-- 实体：modules/rbac/entities/user-role.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_user_role`;
CREATE TABLE `sys_user_role` (
  `user_id`    INT UNSIGNED NOT NULL COMMENT '用户ID',
  `role_id`    INT UNSIGNED NOT NULL COMMENT '角色ID',
  `createTime` BIGINT       NOT NULL COMMENT '关联创建时间(毫秒时间戳)',
  PRIMARY KEY (`user_id`, `role_id`),
  KEY `idx_sys_user_role_role` (`role_id`) COMMENT '角色反向查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-角色关联表';

-- =============================================
-- 13. 角色-权限关联表 sys_role_permission
-- 实体：modules/rbac/entities/role-permission.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_role_permission`;
CREATE TABLE `sys_role_permission` (
  `role_id`       INT UNSIGNED NOT NULL COMMENT '角色ID',
  `permission_id` INT UNSIGNED NOT NULL COMMENT '权限ID',
  PRIMARY KEY (`role_id`, `permission_id`),
  KEY `idx_sys_role_perm_perm` (`permission_id`) COMMENT '权限反向查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色-权限关联表';

-- =============================================
-- 14. 审计日志表 sys_audit_log
-- 实体：modules/audit/entities/audit-log.entity.ts
-- =============================================
DROP TABLE IF EXISTS `sys_audit_log`;
CREATE TABLE `sys_audit_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `user_id`     INT UNSIGNED DEFAULT NULL COMMENT '操作用户ID（未登录为NULL）',
  `username`    VARCHAR(50) DEFAULT NULL COMMENT '操作用户名（冗余存储）',
  `action`      VARCHAR(50) NOT NULL COMMENT '动作：login / logout / refresh / kick / toggle-status / reset-password ...',
  `resource`    VARCHAR(50) DEFAULT NULL COMMENT '操作对象类型：user / role / ...',
  `resource_id` VARCHAR(50) DEFAULT NULL COMMENT '操作对象ID',
  `ip`          VARCHAR(45) DEFAULT NULL COMMENT '客户端IP（兼容IPv6）',
  `user_agent`  VARCHAR(255) DEFAULT NULL COMMENT '浏览器UA',
  `status`      TINYINT NOT NULL COMMENT '状态：1成功 0失败',
  `detail`      JSON DEFAULT NULL COMMENT '扩展信息（JSON）',
  `createTime`  BIGINT NOT NULL COMMENT '操作时间(毫秒时间戳)',
  PRIMARY KEY (`id`),
  KEY `idx_audit_user` (`user_id`) COMMENT '按用户查询',
  KEY `idx_audit_action` (`action`) COMMENT '按动作查询',
  KEY `idx_audit_time` (`createTime`) COMMENT '按时间查询'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志表';

-- =============================================
-- 15. TypeORM 迁移记录表（避免 typeorm migration:run 报错）
-- =============================================
DROP TABLE IF EXISTS `typeorm_migrations`;
CREATE TABLE `typeorm_migrations` (
  `id`        INT NOT NULL AUTO_INCREMENT,
  `timestamp` BIGINT NOT NULL,
  `name`      VARCHAR(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='TypeORM 迁移版本记录';

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================
-- 16. 初始数据（INSERT IGNORE 幂等）
-- =============================================

-- 16.1 管理员账号（密码：123456，对应 bcrypt 哈希）
INSERT IGNORE INTO `sys_user` (`username`, `password`, `phone`, `status`, `createTime`)
VALUES ('admin', '$2b$10$vI8aWBqBg5nTRcXeaMlyLu/E0c2p61c/jAF7oypnE7j4Vbtc9Qv2', '13800000000', 1, UNIX_TIMESTAMP() * 1000);

-- 16.2 三个内置角色
INSERT IGNORE INTO `sys_role` (`code`, `name`, `description`, `status`, `createTime`) VALUES
  ('admin',  '管理员',       '系统最高权限，可访问所有功能',         1, UNIX_TIMESTAMP() * 1000),
  ('editor', '编辑',         '可管理账本和文件，不可操作用户',       1, UNIX_TIMESTAMP() * 1000),
  ('user',   '普通用户',     '基础访问权限，仅可查看账本和AI对话',  1, UNIX_TIMESTAMP() * 1000);

-- 16.3 权限码（按模块分组）
INSERT IGNORE INTO `sys_permission` (`code`, `name`, `module`, `description`, `createTime`) VALUES
  ('user:list',           '查看用户列表', 'user', '查看系统中所有用户',          UNIX_TIMESTAMP() * 1000),
  ('user:kick',           '强制用户下线', 'user', '踢出指定用户的活跃会话',      UNIX_TIMESTAMP() * 1000),
  ('user:toggle-status',  '启停用户',     'user', '启用/禁用指定用户',           UNIX_TIMESTAMP() * 1000),
  ('user:audit',          '查看审计日志', 'user', '查看系统审计日志',            UNIX_TIMESTAMP() * 1000),
  ('user:session',        '查看多设备会话', 'user', '查看用户的活跃设备列表',     UNIX_TIMESTAMP() * 1000),
  ('book:list',           '查看账本',     'book', '查看账本列表',                UNIX_TIMESTAMP() * 1000),
  ('book:create',         '创建账本',     'book', '创建新账本',                  UNIX_TIMESTAMP() * 1000),
  ('book:update',         '修改账本',     'book', '修改账本信息',                UNIX_TIMESTAMP() * 1000),
  ('book:delete',         '删除账本',     'book', '删除账本',                    UNIX_TIMESTAMP() * 1000),
  ('file:upload',         '上传文件',     'file', '上传文件',                    UNIX_TIMESTAMP() * 1000),
  ('file:delete',         '删除文件',     'file', '删除文件',                    UNIX_TIMESTAMP() * 1000),
  ('ai:chat',             'AI 对话',      'ai',   '使用 AI 聊天功能',           UNIX_TIMESTAMP() * 1000),
  -- ===== 以下为管理端模块新增的权限码（admin 模块启用） =====
  ('role:list',                '查看角色列表',     'admin', '分页查询角色列表',            UNIX_TIMESTAMP() * 1000),
  ('role:create',              '创建角色',         'admin', '创建新角色',                  UNIX_TIMESTAMP() * 1000),
  ('role:update',              '修改角色',         'admin', '修改角色基本信息',            UNIX_TIMESTAMP() * 1000),
  ('role:delete',              '删除角色',         'admin', '删除角色',                    UNIX_TIMESTAMP() * 1000),
  ('role:assign-permission',   '分配角色权限',     'admin', '给角色绑定/解绑权限',         UNIX_TIMESTAMP() * 1000),
  ('permission:list',          '查看权限列表',     'admin', '分页查询权限码',              UNIX_TIMESTAMP() * 1000),
  ('permission:create',        '创建权限',         'admin', '新增权限码',                  UNIX_TIMESTAMP() * 1000),
  ('permission:update',        '修改权限',         'admin', '修改权限名称/描述',            UNIX_TIMESTAMP() * 1000),
  ('permission:delete',        '删除权限',         'admin', '删除权限码',                  UNIX_TIMESTAMP() * 1000),
  ('user-role:list',           '查看用户角色',     'admin', '查询用户-角色绑定关系',        UNIX_TIMESTAMP() * 1000),
  ('user-role:assign',         '分配用户角色',     'admin', '给用户绑定/解绑角色',         UNIX_TIMESTAMP() * 1000),
  ('user-role:remove',         '移除用户角色',     'admin', '移除用户的指定角色',          UNIX_TIMESTAMP() * 1000),
  ('admin:audit',              '管理端审计日志',   'admin', '查询管理端操作审计日志',      UNIX_TIMESTAMP() * 1000),
  ('dashboard:view',           '查看管理仪表盘',   'admin', '查看管理后台首页统计数据',    UNIX_TIMESTAMP() * 1000);

-- 16.4 角色-权限分配：admin 拥有全部权限
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r
CROSS JOIN `sys_permission` p
WHERE r.code = 'admin';

-- editor：除 user / admin 模块外的所有权限（账本、文件、AI）
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'editor' AND p.module NOT IN ('user', 'admin');

-- user：仅基础读权限
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'user' AND p.code IN ('book:list', 'ai:chat');

-- 16.5 默认把 admin 账号绑定到 admin 角色
INSERT IGNORE INTO `sys_user_role` (`user_id`, `role_id`, `createTime`)
SELECT u.id, r.id, UNIX_TIMESTAMP() * 1000
FROM `sys_user` u, `sys_role` r
WHERE u.username = 'admin' AND r.code = 'admin';

-- 16.6 默认把其他账号绑定到 user 角色（若该用户尚未绑定任何角色）
INSERT IGNORE INTO `sys_user_role` (`user_id`, `role_id`, `createTime`)
SELECT u.id, r.id, UNIX_TIMESTAMP() * 1000
FROM `sys_user` u, `sys_role` r
WHERE u.username <> 'admin'
  AND r.code = 'user'
  AND NOT EXISTS (SELECT 1 FROM `sys_user_role` ur WHERE ur.user_id = u.id);

-- =============================================
-- 脚本结束
-- =============================================