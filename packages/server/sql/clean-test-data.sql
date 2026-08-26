-- =============================================
-- 清除当前系统现有测试数据
-- 数据库：nest_db
-- 适用：开发/测试环境快速重置
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

-- 用户表（account_book 有 ON DELETE CASCADE，会被一起清掉）
TRUNCATE TABLE `sys_user`;

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;

-- 重建默认管理员账号（密码：123456，bcrypt 加密）
INSERT INTO `sys_user` (`username`, `password`, `phone`, `status`)
VALUES ('admin', '$2b$10$vI8aWBqBg5nTRcXeaMlyLu/E0c2p61c/jAF7oypnE7j4Vbtc9Qv2', '13800000000', 1);
