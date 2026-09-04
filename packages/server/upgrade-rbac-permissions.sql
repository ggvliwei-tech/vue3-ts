-- =============================================
--  RBAC 权限增量升级脚本
--  适用：在已有数据库上补齐 app 端权限渲染所需的权限码
--  幂等：所有 INSERT 均使用 INSERT IGNORE，可重复执行
--  注意：与 nest-db.sql 16.3/16.4 节保持一致；本脚本只增量，不删任何旧数据
-- =============================================

-- 1. 新增 4 个权限码（file:list 与 3 个 chat:*）
--    file:list 原来缺失，会导致「文件」入口完全无权限可用
--    chat:room / chat:room-create / chat:room-delete 是聊天室整套功能
INSERT IGNORE INTO `sys_permission` (`code`, `name`, `module`, `description`, `createTime`) VALUES
  ('file:list',        '查看文件',   'file', '查看文件列表',                UNIX_TIMESTAMP() * 1000),
  ('file:upload',      '上传文件',   'file', '上传文件',                    UNIX_TIMESTAMP() * 1000),
  ('file:delete',      '删除文件',   'file', '删除文件',                    UNIX_TIMESTAMP() * 1000),
  ('ai:chat',          'AI 对话',    'ai',   '使用 AI 聊天功能',           UNIX_TIMESTAMP() * 1000),
  ('chat:room',        '进入聊天室', 'chat', '查看房间列表/成员/历史消息并收发消息', UNIX_TIMESTAMP() * 1000),
  ('chat:room-create', '创建聊天室', 'chat', '创建新的聊天房间',            UNIX_TIMESTAMP() * 1000),
  ('chat:room-delete', '删除聊天室', 'chat', '删除聊天房间',                UNIX_TIMESTAMP() * 1000);

-- 2. admin 角色：补齐新增的权限
--    admin 原本是 CROSS JOIN，应该已经全部拥有；但新数据库若只插了 admin 角色后
--    才补权限码，会漏掉这几条。补一次更安全。
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'admin' AND p.code IN (
  'file:list', 'file:upload', 'file:delete',
  'ai:chat',
  'chat:room', 'chat:room-create', 'chat:room-delete'
);

-- 3. editor 角色：补齐新增的 chat 模块权限
--    原有 grant 用 module NOT IN ('user','admin')，新加的 chat 模块不在排除列表，
--    所以对「在升级前已存在 editor 角色关联」的库不生效——必须显式补一次
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'editor' AND p.code IN (
  'file:list', 'file:upload', 'file:delete',
  'ai:chat',
  'chat:room', 'chat:room-create', 'chat:room-delete'
);

-- 4. user 角色：保留 book + AI + 进入聊天室（不开放文件模块）
--    原始 seed 写死 IN ('book:list', 'ai:chat')，新加的 chat:room 不会自动进来，
--    必须显式追加
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'user' AND p.code IN ('book:list', 'ai:chat', 'chat:room');

-- =============================================
-- 5. 验证：执行后请确认查询结果符合预期
-- =============================================
-- SELECT r.code AS 角色, p.code AS 权限码, p.module AS 模块
-- FROM sys_role_permission rp
-- JOIN sys_role r ON r.id = rp.role_id
-- JOIN sys_permission p ON p.id = rp.permission_id
-- WHERE p.code IN ('file:list','chat:room','chat:room-create','chat:room-delete')
-- ORDER BY r.code, p.code;
