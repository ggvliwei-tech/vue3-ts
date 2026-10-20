-- ============================================================
-- 增量脚本：补齐 RAG 两级知识库的两个权限码
-- 日期：2026-10-15
-- ============================================================
-- 【为什么需要这个文件】
-- nest-db.sql 是一个**全量重建**脚本（开头是 DROP TABLE IF EXISTS），
-- 它的 16.3 / 16.4 段已经包含下面这两条权限码与对应的角色授权 ——
-- 也就是说，照 nest-db.sql 新建出来的库不需要跑本文件。
--
-- 但在本文件之前就已经初始化过的库（本地开发库、已上线的环境）里
-- 没有这两行数据，表现为：
--   · admin 账号打开「知识库管理」直接跳 /403
--   · 接口 GET /api/v1/admin/knowledge/documents 返回
--     403 缺少权限：ai:doc:manage（PermissionsGuard 是纯权限码比对，
--     没有「admin 角色放行一切」的后门）
-- 而 **不能靠重跑 nest-db.sql 来补** —— 那会把库里的业务数据全部清空。
--
-- 【特性】
-- 幂等。依赖 sys_permission.uk_sys_perm_code 与
-- sys_role_permission 的主键 (role_id, permission_id)，重复执行无副作用。
-- 对新建的库执行也安全（全部命中 IGNORE）。
--
-- 【执行】
--   mysql -h <host> -u <user> -p <dbname> < 2026-10-15-rag-doc-permissions.sql
--   或先加 --default-character-set=utf8mb4 避免中文注释/名称乱码。
--
-- 【执行后必须做的一步】
-- RBAC 的权限集合在 Redis 里有 10 分钟缓存（rbac.service.ts 的 CACHE_TTL），
-- 且进程内还有一份 L1 Map。**请让相关账号重新登录**，否则读到的仍是旧的
-- 权限集合，界面上看起来"改了没用"。多个后端实例时同理：每个实例的 L1
-- 缓存要等自身 TTL 到期，或重启该实例。
-- ============================================================

USE `vue3_monorepo`;

-- ------------------------------------------------------------
-- 1. 两个权限码
-- ------------------------------------------------------------
-- module 的取值是**授权边界**，不是分类标签，改动前请先读 nest-db.sql 16.3 的说明：
--   · ai:doc:manage 用 'admin' —— editor 的授权条件是
--     `p.module NOT IN ('user','admin')`，用 'admin' 才能把它挡在公共知识库之外，
--     实现「公共库只有管理员能写」而不必改角色授权语句。
--   · ai:doc:private 用 'ai' —— admin / editor 自动获得；
--     user 是白名单授权，需要下面第 2 步显式追加。
INSERT IGNORE INTO `sys_permission` (`code`, `name`, `module`, `description`, `createTime`) VALUES
  ('ai:doc:manage',  '公共知识库管理', 'admin', '上传/删除公共知识库文档', UNIX_TIMESTAMP() * 1000),
  ('ai:doc:private', '私有资料管理',   'ai',    '上传/删除个人私有资料',   UNIX_TIMESTAMP() * 1000);

-- ------------------------------------------------------------
-- 2. 角色授权（与 nest-db.sql 16.4 保持一致）
-- ------------------------------------------------------------
-- admin：拥有全部权限（含上面两个）
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r
CROSS JOIN `sys_permission` p
WHERE r.code = 'admin';

-- editor：除 user / admin 模块外的所有权限 —— 即自动拿到 ai:doc:private，
-- 但拿不到 module='admin' 的 ai:doc:manage（这正是想要的边界）
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'editor' AND p.module NOT IN ('user', 'admin');

-- user：白名单授权，ai:doc:private 必须显式列出
INSERT IGNORE INTO `sys_role_permission` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `sys_role` r, `sys_permission` p
WHERE r.code = 'user' AND p.code IN ('book:list', 'ai:chat', 'chat:room', 'ai:doc:private');

-- ------------------------------------------------------------
-- 3. 自检（可选）：确认两个码已存在且 admin 已持有
-- ------------------------------------------------------------
-- 期望：两行输出，granted 列都是「有」
SELECT p.code,
       p.module,
       IF(rp.permission_id IS NULL, '无', '有') AS admin_granted
FROM `sys_permission` p
LEFT JOIN `sys_role_permission` rp
       ON rp.permission_id = p.id
      AND rp.role_id = (SELECT id FROM `sys_role` WHERE code = 'admin')
WHERE p.code IN ('ai:doc:manage', 'ai:doc:private');
