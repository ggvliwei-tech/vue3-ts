-- =============================================
-- 清除当前系统现有测试数据
-- 数据库：nest_db
-- 适用：开发/测试环境快速重置
-- 注意：
--   1. TRUNCATE 不触发 ON DELETE CASCADE —— 级联只在外键约束真正生效时起作用，
--      而 TRUNCATE 在实现上是"删表重建"，压根不走逐行删除的外键检查
--      （即便这里已 SET FOREIGN_KEY_CHECKS = 0）。所以依赖表必须逐个显式清，
--      不能指望清了 sys_user 就自动带走 account_book。
--   2. 本脚本**不清**这三张表，重置后仍会残留：
--        sys_audit_log                        审计日志（有意保留，便于排查）
--        sys_user_role / sys_role_permission   角色 / 权限绑定
--      残留的绑定会因为下面 TRUNCATE 把 AUTO_INCREMENT 归零而"错位接上"：
--      重建的 admin 又拿到 id = 1，于是旧 user_id = 1 的角色绑定会直接落到新
--      admin 头上（若被删的 1 号用户不是 admin，新 admin 就会莫名继承别人的角色）。
--      要彻底断干净，请在重建 admin 之后显式重绑角色，或一并清空这两张表。
--   3. 会话与 refresh token 存在 **Redis**（见 auth/session.service.ts），
--      不在 MySQL 里，本脚本不会也不能清。重置数据库后 Redis 中旧会话依旧有效，
--      而它指向的 user_id = 1 已经变成新 admin —— 想让旧登录态真正失效，
--      需另外清 Redis（FLUSHDB 或清 refresh:token:* / session:* 前缀）。
-- =============================================

USE `nest_db`;

-- 关闭外键检查，避免 TRUNCATE 因外键依赖报错
SET FOREIGN_KEY_CHECKS = 0;

-- 按"叶子表先清"原则：先清依赖表，再清父表
-- 聊天模块
TRUNCATE TABLE `chat_message`;
TRUNCATE TABLE `chat_member`;
TRUNCATE TABLE `chat_room`;

-- AI 对话模块
TRUNCATE TABLE `ai_message`;
TRUNCATE TABLE `ai_session`;

-- 业务模块
TRUNCATE TABLE `sys_file`;
TRUNCATE TABLE `account_book`;

-- 用户表（account_book 不会被连带清掉，见文件头注释 1；上面已显式 TRUNCATE）
TRUNCATE TABLE `sys_user`;

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;

-- 重建默认管理员账号（密码：123456，bcrypt 加密）
-- createTime 是 BIGINT NOT NULL 且**没有 DEFAULT**，MySQL 8 默认开严格模式，
-- 漏掉这一列会直接报 ERROR 1364（此时 sys_user 已被 TRUNCATE，库里就没账号了）。
-- 对齐 nest-db.sql 的 16.1 节写法。
INSERT INTO `sys_user` (`username`, `password`, `phone`, `status`, `createTime`)
VALUES ('admin', '$2b$10$vI8aWBqBg5nTRcXeaMlyLu/E0c2p61c/jAF7oypnE7j4Vbtc9Qv2', '13800000000', 1, UNIX_TIMESTAMP() * 1000);
