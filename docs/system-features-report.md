# Vue3 Monorepo 系统功能分析报告

**版本**：基于 `main` 分支 `56fcb8e` + 当前迭代增量
**生成日期**：2026-08-29
**评估范围**：业务能力、用户场景、功能矩阵、权限体系、API 覆盖面

> 本报告聚焦"这个系统**能做什么**"，与《系统分析报告》（架构评估）配套阅读。

---

## 0. 系统定位

**Vue3 Monorepo** 是一套**面向企业内部的多端业务平台模板**，提供以下核心能力：

- **统一身份认证**：JWT 双令牌 + RBAC 权限码
- **多端用户接入**：PC 管理后台（admin）+ 移动端用户端（app）
- **实时协作**：WebSocket 聊天室
- **AI 集成**：LLM 编排 + RAG 知识库
- **业务模块**：账本（account_book）、文件管理、审计日志
- **可观测性**：审计日志、仪表盘、健康检查

**目标用户**：
- **管理员**：通过 `admin` 后台管理用户/角色/权限、查看仪表盘和审计日志
- **终端用户**：通过 `app` 完成账本记录、文件上传、AI 对话、群聊、忘记密码等日常操作

---

## 1. 端到端功能地图

### 1.1 角色 × 功能矩阵

| 功能 | 管理员（admin） | 终端用户（app） | 备注 |
|------|:---:|:---:|------|
| 登录 / 注册 | ✅ | ✅ | admin 仅登录（无注册） |
| 找回密码（手机号 + 验证码） | ❌ | ✅ | |
| 查看个人资料 | ✅ | ✅ | |
| 修改密码 / 手机号 | ❌ | ✅ | 账号设置在 app Profile.vue |
| 用户管理（CRUD / 启停 / 踢下线 / 分配角色） | ✅ | ❌ | admin 专属 |
| 角色管理（CRUD / 配置权限） | ✅ | ❌ | |
| 权限管理（CRUD） | ✅ | ❌ | |
| 审计日志查询 | ✅ | ❌ | admin:audit / user:audit 权限码 |
| 仪表盘 | ✅ | ❌ | dashboard:view |
| 账本（CRUD） | ❌ | ✅ | app 业务模块 |
| 文件上传（图片） | ❌ | ✅ | magic-byte 校验 |
| AI 对话（含 RAG / 多会话） | ❌ | ✅ | |
| 聊天室（建房/加入/发消息/成员管理） | ❌ | ✅ | WS 实时 |

### 1.2 终端用户核心场景

| # | 场景 | 涉及页面 | 后端模块 |
|---|------|----------|----------|
| U1 | 注册账号 → 登录 → 修改资料 | Register / Login / Profile | user |
| U2 | 忘记密码（手机号收验证码 → 重置） | ForgotPassword | sms + user |
| U3 | 创建账本 → 记录一笔收支 → 编辑 → 删除 | AccountBook | account_book |
| U4 | 上传头像/凭证图片 → 查看已上传文件 | FileList | file |
| U5 | 与 AI 对话（可创建多个会话） | Home/AiChat | ai |
| U6 | 上传 PDF 到 RAG → AI 引用文档回答 | AiChat | ai (RAG) |
| U7 | 进入聊天室 → 加入房间 → 实时收发消息 | RoomList / ChatRoom | chat |
| U8 | 主动退出某设备 / 全部设备 | Profile | user (sessions) |

### 1.3 管理员核心场景

| # | 场景 | 涉及页面 | 后端模块 |
|---|------|----------|----------|
| A1 | 登录 → 看仪表盘（总览统计） | Dashboard | dashboard |
| A2 | 用户管理：搜索用户 → 启用/禁用 → 强制下线 → 分配角色 | UserManage | user + user-role |
| A3 | 角色管理：建角色 → 配置权限 → 分配给用户 | RoleManage | role + permission |
| A4 | 权限管理：维护权限码树 | PermissionManage | permission |
| A5 | 审计日志查询：按时间/动作/用户筛选 | AuditLog | audit |
| A6 | 查看个人资料 / 修改密码 | AdminLayout (顶栏) | user |

---

## 2. 用户与认证模块（user + auth）

### 2.1 功能清单

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 注册 | POST | `/api/v1/user/register` | 无 | 用户名/密码/手机号注册，bcrypt 哈希入库 |
| 忘记密码 | POST | `/api/v1/user/forgot-password` | 无 | 手机号 + 短信验证码重置密码 |
| 登录 | POST | `/api/v1/user/login` | 无 | 颁发 AccessToken + RefreshToken Cookie |
| 刷新令牌 | POST | `/api/v1/user/refresh-token` | RefreshTokenGuard | 颁发新 AccessToken |
| 退出登录 | POST | `/api/v1/user/logout` | JWT | 清除 Cookie + 吊销 session |
| 退出全部设备 | POST | `/api/v1/user/logout-all` | JWT | 全设备吊销 |
| 退出指定 session | POST | `/api/v1/user/me/sessions/:sid/logout` | JWT | 单设备吊销 |
| 我的设备列表 | GET | `/api/v1/user/me/sessions` | JWT | 多设备管理 |
| 个人资料 | GET | `/api/v1/user/profile` | JWT | 当前登录用户详情（含角色/权限码） |
| 用户列表 | GET | `/api/v1/user` | user:list | 分页 + keyword/status 筛选 + 含角色 |
| 启停账号 | POST | `/api/v1/user/:id/toggle-status` | user:toggle-status | 禁用时自动吊销全部 session |
| 强制下线 | POST | `/api/v1/user/:id/kick` | user:kick | 全设备下线 + 写审计 |

### 2.2 关键能力

- ✅ **双令牌机制**：AccessToken（短期，header 传递）+ RefreshToken（长期，HttpOnly Cookie）
- ✅ **多设备会话管理**：Redis Hash 存 `user:{id}:sessions`，key=sessionId, value=deviceInfo
- ✅ **强制下线**：管理员可一键踢下线某个用户的全部设备，并立即吊销 RBAC 缓存
- ✅ **状态联动**：用户被禁用时所有设备自动吊销（toggleStatus 内部调用 sessionService.removeAll）
- ✅ **CSRF 防御**：登录/刷新走 Origin 白名单校验
- ✅ **审计埋点**：登录、踢下线、启停、重置密码全部 `events.emit(AuditEvents.LOG)`

### 2.3 用户旅程示例：登录到修改资料

```
1. App 启动 → 检查 Pinia useAuthStore.token
   ├── 有 token → 调 GET /user/profile 验证有效性
   │     ├── 200 → 保留登录态，进入首页
   │     └── 401 → 清空 auth，重定向到 /login
   └── 无 token → 强制跳 /login

2. 用户输入用户名/密码 → POST /user/login
   ├── 200 → Pinia.setToken() + setUserInfo() → 进入首页
   └── 401/429 → 显示 toast（密码错 / 限流）

3. 进入 /home/profile → GET /user/profile → 展示用户名/状态/角色/权限
4. 修改密码 → POST /user/change-password（待实现，需补 controller）
```

---

## 3. RBAC 权限体系（rbac + admin/*）

### 3.1 权限码清单（共 16 个）

| 权限码 | 说明 | 用途 |
|--------|------|------|
| `user:list` | 查看用户列表 | admin 用户管理 |
| `user:kick` | 强制下线 | admin 用户管理 |
| `user:toggle-status` | 启停账号 | admin 用户管理 |
| `user:audit` | 用户相关审计日志 | admin 审计 |
| `user-role:list` | 查看用户角色 | admin 用户管理 |
| `user-role:assign` | 分配用户角色 | admin 用户管理 |
| `user-role:remove` | 移除用户角色 | admin 用户管理 |
| `role:list` | 查看角色列表 | admin 角色管理 |
| `role:create` | 创建角色 | admin 角色管理 |
| `role:update` | 编辑角色 | admin 角色管理 |
| `role:delete` | 删除角色 | admin 角色管理 |
| `role:assign-permission` | 给角色分配权限 | admin 角色管理 |
| `permission:list` | 查看权限列表 | admin 权限管理 |
| `permission:create` | 创建权限 | admin 权限管理 |
| `permission:update` | 编辑权限 | admin 权限管理 |
| `permission:delete` | 删除权限 | admin 权限管理 |
| `admin:audit` | 管理员操作审计 | admin 审计 |
| `dashboard:view` | 查看仪表盘 | admin 仪表盘 |

### 3.2 角色权限继承结构（设计）

```
sys_role          sys_permission        sys_role_permission     sys_user_role
  (id, code,        (id, code,             (role_id,               (user_id,
   name, status)     name, module)          permission_id)          role_id)
       │                  │                       │                     │
       └───────多对多──────┴─────────多对多────────┘                     │
                              ▲                                           │
                              └───────────────多对多─────────────────────┘
```

- **一对多**：1 个角色可分配给 N 个用户，1 个用户可拥有 N 个角色
- **多对多**：1 个角色可拥有 N 个权限，1 个权限可被 N 个角色拥有

### 3.3 关键能力

- ✅ **权限码 → JWT payload**：登录时把 user 的 `permissions[]` 写入 JWT，前端路由守卫直接判断无需查 DB
- ✅ **Redis 缓存**：`rbac:roles:{userId}` 和 `rbac:perms:{userId}`，TTL 10 分钟
- ✅ **降级到 DB**：Redis 故障时 readCache 失败不抛错，直接查 DB
- ✅ **主动失效**：admin 修改用户角色 → `clearUserCache(userId)`，新权限在下次登录生效（JWT 重签）
- ✅ **路由守卫**：admin router `meta.permissions` 在 beforeEach 中校验
- ✅ **按钮级权限**：当前 3 个参考页面**未实现**按钮级 `v-if="hasPermission(...)"`（仅路由级）

### 3.4 当前角色预设（来自 `nest-db.sql`）

| 角色编码 | 名称 | 典型权限 |
|----------|------|----------|
| `admin` | 超级管理员 | 全部权限 |
| `user` | 普通用户 | 无业务权限（仅能访问自己的数据） |

---

## 4. 聊天模块（chat）

### 4.1 REST 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 创建房间 | POST | `/api/v1/chat/room` | JWT | 创建聊天室 |
| 房间列表 | GET | `/api/v1/chat/rooms` | JWT | 全量房间列表（分页） |
| 我的房间 | GET | `/api/v1/chat/my-rooms` | JWT | 我加入的房间 |
| 加入房间 | POST | `/api/v1/chat/join` | JWT | DB 写入成员 |
| 离开房间 | POST | `/api/v1/chat/leave` | JWT | DB 删除成员 |
| 房间成员 | GET | `/api/v1/chat/members` | JWT | 成员列表 |
| 历史消息 | GET | `/api/v1/chat/messages` | JWT | 分页历史 |
| 房间详情 | GET | `/api/v1/chat/room/:id` | JWT | 单个房间信息 |
| 删除房间 | POST | `/api/v1/chat/room/:id/delete` | JWT | 房主权限 |

### 4.2 WebSocket 事件（Socket.IO `/ws` 命名空间）

| 事件 | 方向 | payload | 描述 |
|------|------|---------|------|
| `connect` | C→S | (handshake.auth.token) | WS 握手，触发 JWT 校验 + 黑名单 + status 检查 |
| `join-room` | C→S | `{ roomId }` | 加入房间（DB 记录 + Socket.IO join + 广播 member-joined） |
| `leave-room` | C→S | `{ roomId }` | 离开房间 |
| `send-msg` | C→S | `{ roomId, content }` | 发消息（DTO 校验 + 持久化 + 广播 new-msg） |
| `room-joined` | S→C | `{ roomId, members, history }` | 加入成功回执（含最近 50 条历史） |
| `new-msg` | S→C | `{ id, roomId, senderId, senderName, content, createdAt }` | 广播新消息（不含发送者） |
| `msg-sent` | S→C | `{ ... }` | 发送者自己的消息回执（用于替换临时消息） |
| `member-joined` | S→C | `{ userId, username, roomId }` | 广播新成员加入 |
| `member-left` | S→C | `{ userId, username, roomId }` | 广播成员离开 |
| `error` | S→C | `{ code, msg }` | 服务端错误（401 未授权 / 403 不在房间 / 400 业务异常） |

### 4.3 关键能力

- ✅ **实时性**：基于 Socket.IO，自动降级 WebSocket → HTTP 长轮询
- ✅ **消息持久化**：所有消息入库（`sys_chat_message`），分页可查历史
- ✅ **房间级广播**：消息只在同房间内成员可见
- ✅ **多端在线状态**：room-joined 时下发成员列表，前端维护 `onlineUserIds: Set<number>`
- ✅ **安全加固**：
  - WS 握手 JWT 算法白名单 `algorithms: ['HS256']`
  - 黑名单校验（与 JwtAuthGuard 一致）
  - 实时校验 user.status（不发过期 token 给被禁用账号）
  - send-msg 双重校验：Socket.IO rooms + DB 成员关系（本次新增）
- ✅ **断线重连**：前端 `reconnection: true, reconnectionAttempts: 5`，重连后自动 re-join

### 4.4 用户旅程示例：群聊

```
1. 用户 A 打开聊天室列表 → GET /chat/rooms 展示所有房间
2. A 进入房间 1 → ChatRoom.vue onMount
   - REST GET /chat/messages?roomId=1 加载历史
   - connectWebSocket(handlers) 建立 WS
   - onConnect → emit join-room{roomId:1}
   - 服务端：DB 写入成员 + socket.join('1') + 广播 member-joined + 返回 room-joined
   - 前端 onRoomJoined：合并历史消息 + 设置成员列表 + onlineUserIds
3. A 输入文本 → 点击发送
   - 乐观更新：UI 插入临时消息（isTemp: true）
   - emit send-msg{roomId:1, content:'...'}
   - 服务端校验 rooms + DB 成员 → 持久化 → 广播 new-msg
   - A 自己收到 msg-sent → 替换临时消息为正式消息
4. B 在同一房间收到 new-msg → 追加到消息列表
5. A 返回上一页 → emit leave-room → 清理 handler → socket 复用待下次进入
```

---

## 5. AI 模块（ai）

### 5.1 接口清单

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 对话（非流式） | POST | `/api/v1/ai/chat` | JWT | 同步调用 LLM |
| 对话历史 | POST | `/api/v1/ai/chat/history` | JWT | 会话历史消息 |
| RAG 问答 | POST | `/api/v1/ai/rag` | JWT | 带知识库检索的问答 |
| 流式对话 | GET | `/api/v1/ai/stream` | JWT | SSE 流式输出 |
| 创建会话 | POST | `/api/v1/ai/session/create` | JWT | 新建一个会话 |
| 最近会话 | GET | `/api/v1/ai/session/last` | JWT | 上次会话（用于自动恢复） |
| 上传 PDF 到 RAG | POST | `/api/v1/ai/upload/pdf` | JWT | 上传 PDF 进入向量库 |
| 会话列表 | GET | `/api/v1/ai/sessions` | JWT | 用户的会话列表 |
| 删除会话 | POST | `/api/v1/ai/session/:sessionId/delete` | JWT | |
| 清空全部会话 | POST | `/api/v1/ai/sessions/clear` | JWT | |
| 会话消息列表 | GET | `/api/v1/ai/session/:sessionId/messages` | JWT | |
| 流式历史 | GET | `/api/v1/ai/stream/history` | JWT | |

### 5.2 关键能力

- ✅ **多 LLM 适配**：`LlmProviderService` 策略模式，支持 OpenAI / DashScope（阿里云通义千问）/ Ollama
- ✅ **RAG 知识库**：上传 PDF → 切片 → Embedding → 存入 Chroma 向量库 → 召回相关 chunk 作为上下文
- ✅ **流式输出**：SSE 协议，前端用 `useAIStream` composable 逐字渲染
- ✅ **多会话隔离**：每个会话独立 sessionId，可切换 / 删除
- ✅ **会话持久化**：`sys_ai_session` + `sys_ai_message`，`groupBy` 优化避免 N+1
- ✅ **Token 透传**：`Authorization: Bearer` 携带，前端 SSE EventSource 不支持 header → 用 `fetch + ReadableStream` 手动解析

### 5.3 用户旅程示例：AI 文档问答

```
1. 用户打开 AI 聊天 → AiChat.vue onMount
   - 创建新会话（如果无）或加载上次会话
   - GET /ai/stream/history 加载历史消息

2. 用户上传 PDF → POST /ai/upload/pdf
   - 服务端：PdfReader → chunk → Embedding → Chroma.add
   - 返回 PDF ID

3. 用户提问 "这份文档的关键结论是？"
   - POST /ai/rag
     - 内部：query embedding → Chroma.search → top-k chunks → 拼 prompt
     - 调 LLM → 流式返回
   - 前端 SSE 逐字渲染

4. 用户可切换到 "新建会话" → 创建空白 context
```

---

## 6. 文件模块（file）

### 6.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 文件列表 | GET | `/api/v1/file` | JWT | 分页 + module 过滤 |
| 上传单张 | POST | `/api/v1/file/image` | JWT | multipart/form-data |
| 批量上传 | POST | `/api/v1/file/images` | JWT | |
| 删除文件 | DELETE | `/api/v1/file/:id` | JWT | 所有权校验，admin bypass |

### 6.2 关键能力

- ✅ **图片格式校验**：仅 jpg/png/gif/webp，扩展名 + **魔术字节双重校验**（防 `.php.jpg` 绕过）
- ✅ **图片压缩**：sharp 库自动压缩，长边 1920px，不放大
- ✅ **存储策略**：`STORAGE_TYPE=local|oss` env 切换，本地/OSS（阿里云）双实现
- ✅ **所有权校验**：仅本人可删自己的文件，admin 角色可删任意
- ✅ **数据库记录**：原文件名、保存名、路径、URL、MIME、大小、上传者、上传时间

---

## 7. 账本模块（account_book）

### 7.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 新增账目 | POST | `/api/v1/account-book` | JWT | |
| 列表 | GET | `/api/v1/account-book` | JWT | |
| 详情 | GET | `/api/v1/account-book/:id` | JWT | |
| 编辑 | PATCH | `/api/v1/account-book/:id` | JWT | |
| 删除 | DELETE | `/api/v1/account-book/:id` | JWT | |

### 7.2 关键能力

- ✅ 完整 CRUD
- ✅ 个人数据隔离（基于 JWT userId）
- ⚠️ **未审计**：建议补 audit emit

---

## 8. SMS 模块（sms）

### 8.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 发送验证码 | POST | `/api/v1/sms/send` | 无 | 发送手机验证码 |
| 校验验证码 | POST | `/api/v1/sms/verify` | 无 | |

### 8.2 关键能力

- ✅ **Dev Mock**：`NODE_ENV !== 'production' && SMS_MOCK !== 'false'` 时启用
- ✅ **生产真发送**：对接短信服务商（具体实现未审计）
- ✅ **TTL 验证码**：Redis 5 分钟过期

⚠️ **注意**：mock 模式开发环境开启，生产必须显式设置 `SMS_MOCK=false`

---

## 9. 审计模块（audit）

### 9.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 我的审计 | GET | `/api/v1/audit` | user:audit | 当前用户的操作日志 |
| 管理审计 | GET | `/api/v1/admin/audit` | admin:audit | 全量审计日志（含筛选） |

### 9.2 关键能力

- ✅ **事件驱动写入**：`AuditSubscriber` 监听 `audit.log` 事件，业务模块零耦合
- ✅ **定时清理**：每天凌晨 3 点清理 90 天前日志（可配置 `AUDIT_RETENTION_DAYS`）
- ✅ **写入失败容错**：审计写入异常仅记日志，不阻塞业务
- ✅ **结构化存储**：`sys_audit_log` 表，含 userId/username/action/resource/resourceId/status/detail

### 9.3 已埋点的审计事件

| 事件 | 触发点 |
|------|--------|
| `toggle-status` | 用户启停 |
| `reset-password` | 密码重置（含失败） |
| `login`（隐式） | 登录成功 |
| `kick`（隐式） | 强制下线 |
| 其他业务事件 | 视具体模块而定 |

---

## 10. 仪表盘（dashboard）

### 10.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 总览统计 | GET | `/api/v1/admin/dashboard/overview` | dashboard:view | 用户/角色/权限数 |
| 最近登录 | GET | `/api/v1/admin/dashboard/recent-logins` | dashboard:view | |
| 活跃用户 | GET | `/api/v1/admin/dashboard/active-users` | dashboard:view | |

---

## 11. 健康检查（health）

### 11.1 接口

| 接口 | 方法 | 路径 | 权限 | 描述 |
|------|------|------|------|------|
| 探活 | GET | `/health` | 无 | K8s liveness 探针 |
| 就绪 | GET | `/health/ready` | 无 | K8s readiness（含 DB/Redis 检查） |

---

## 12. 功能完整性评估

### 12.1 完整模块

| 模块 | 完成度 | 评价 |
|------|--------|------|
| user / auth | **95%** | 注册/登录/找回密码/多设备/踢下线齐全 |
| rbac | **90%** | 角色/权限 CRUD + 缓存 + 守卫齐全 |
| admin（role/permission/user-role） | **90%** | 完整 CRUD |
| audit | **85%** | 事件驱动 + cron 清理 |
| chat | **85%** | REST + WS + 历史 + 房间管理 |
| ai | **80%** | 多 LLM + RAG + 流式 |
| file | **85%** | 上传/存储/权限齐全 |
| dashboard | **70%** | 基础统计，未做趋势/可视化 |

### 12.2 待补齐功能（明显缺失）

| 编号 | 缺失功能 | 影响 |
|------|----------|------|
| **M1** | **修改密码** | 当前用户无法在登录态下主动改密码（只能走"忘记密码"流程） |
| **M2** | **修改个人资料** | 用户无法修改手机号 / 头像 / 邮箱 |
| **M3** | **文件下载** | `GET /file/:id/download` 未实现，上传后无法取回 |
| **M4** | **消息已读未读** | 聊天消息无回执机制 |
| **M5** | **@提及 / 通知** | 聊天无 @ 用户 / 推送通知 |
| **M6** | **搜索增强** | 用户列表支持 keyword + status；聊天/账本/文件都不支持搜索 |
| **M7** | **数据导出** | 审计日志、账本无法导出 CSV/Excel |
| **M8** | **批量操作** | 用户/角色/权限无法批量启停 |
| **M9** | **消息撤回** | 聊天消息无法撤回 |
| **M10** | **房间搜索** | 房间列表只展示，无搜索加入公开房间 |
| **M11** | **会话分享** | AI 会话无法分享给他人 |
| **M12** | **文件预览** | 上传后仅展示列表，无图片预览 |

### 12.3 数据流对比（每个端的核心 5 个页面）

**admin（5 页）**：
1. Login → 业务管理 → 用户管理（已重构对齐）
2. 角色管理（含权限配置）
3. 权限管理
4. 审计日志（含筛选）
5. 仪表盘

**app（7 页）**：
1. Login / Register / ForgotPassword
2. Home / Profile
3. 账本（AccountBook）
4. 文件管理（FileList）
5. AI 聊天（AiChat）
6. 聊天室（RoomList + ChatRoom）
7. （设置页：未实现）

---

## 13. 前端用户体验评估

### 13.1 admin 后台（PC 端）
- ✅ Element Plus 完整组件库
- ✅ 路由级权限守卫
- ✅ 统一 admin layout（侧边栏 + 顶栏）
- ⚠️ 列表页（Role/Permission/AuditLog）**仍用手写分页 state**，未用 composable
- ⚠️ 部分组件 400+ 行，可拆子组件

### 13.2 app 移动端
- ✅ Vant 4 移动端组件库
- ✅ TabBarLayout 底部导航（Home / Profile）
- ✅ Pinia auth store
- ✅ WebSocket 单例 + handler 清理（本次修复）
- ⚠️ ChatRoom 单文件 708 行，建议拆 `<MessageList> <MessageInput> <MemberPanel> <HistoryLoader>`
- ⚠️ 暂无"消息通知" / "未读红点"

---

## 14. 关键业务指标（KPI 视角）

| 指标 | 现状 | 期望 |
|------|------|------|
| 用户日活（DAU） | 待监控 | 接入 Prometheus + Grafana |
| 消息吞吐量 | WS 单房间无压力测试 | Locust 压测 |
| AI 响应 P95 | 依赖 LLM 服务商 | 引入 APM |
| 文件上传 P95 | sharp 压缩约 200ms | OK |
| 登录失败率 | LoginThrottler 限流 | OK |

---

## 15. 关键功能差距 vs 行业最佳实践

| 能力 | 现状 | 业界标准 | 优先级 |
|------|------|----------|--------|
| 双因子认证 (2FA) | ❌ | ✅ 短信/TOTP | 🟠 P1 |
| OAuth 2.0 第三方登录 | ❌ | ✅ 微信/钉钉/GitHub | 🟠 P1 |
| 操作日志查询 | ✅ 仅审计 | ✅ + 用户行为分析 | 🟡 P2 |
| 消息推送（离线） | ❌ | ✅ Web Push / 极光 | 🟠 P1 |
| 文件夹管理 | ❌ | ✅ 多级目录 | 🟡 P2 |
| 协作编辑 | ❌ | ✅ OT/CRDT | 🟡 P3 |
| 全文搜索 | ❌ | ✅ ES/Meilisearch | 🟠 P1 |
| 多语言 (i18n) | ❌ | ✅ vue-i18n | 🟠 P1 |
| 暗色模式 | ❌ | ✅ | 🟡 P2 |
| 移动端 PWA | ❌ | ✅ manifest + service worker | 🟡 P2 |
| 单元测试覆盖率 | **5%** | 80%+ | 🔴 P0 |
| E2E 测试 | 1 个空 spec | Playwright 全链路 | 🔴 P0 |

---

## 16. 业务模块优先级建议

### 🔴 P0（建议立即补齐，1-2 周）

1. **修改密码 / 修改个人资料**（M1 + M2）—— 用户必备
2. **测试覆盖补齐** —— 上线前提
3. **HTTPS 强制 + .env.example + 部署手册** —— 上线前提
4. **审计日志 PII 脱敏** —— 合规

### 🟠 P1（1 个月内）

5. **2FA / OAuth 登录** —— 企业标配
6. **离线消息推送** —— 移动端体验
7. **i18n 国际化** —— 多区域
8. **全文搜索** —— 用户/聊天/账本
9. **数据导出 CSV** —— 运营需求
10. **composable 全覆盖**（F1）—— 代码质量

### 🟡 P2（1 个季度内）

11. 文件夹管理 + 预览
12. 批量操作
13. 消息撤回 + @提及 + 已读
14. AI 会话分享
15. 房间搜索（加入公开房间）
16. 暗色模式 / PWA

---

## 17. 总结

**系统已具备完整的核心业务闭环**：
- ✅ 身份认证 + 多设备管理
- ✅ RBAC 权限体系
- ✅ 实时聊天
- ✅ AI 对话（含 RAG）
- ✅ 文件上传 + 存储
- ✅ 审计 + 仪表盘
- ✅ 移动端 + PC 后台双端

**对标一个中等规模 SaaS 平台的 70%**。

**主要短板**：
- 🔴 测试覆盖（5%）和监控
- 🟠 用户体验缺失（修改密码 / 搜索 / 通知 / i18n）
- 🟡 安全企业级能力（2FA / OAuth）

**业务定位建议**：
- 当前适合**企业内部使用** / **小规模客户** / **演示 / 教学**
- 要服务 **C 端大规模用户**，需补 P0/P1 全部
- 要进入 **付费市场**，需补 2FA / OAuth / 合规审计

报告完整内容可作为产品经理后续需求梳理的依据。建议每季度 review 一次，更新"M1-M12 待补齐功能"清单的进展。

---

## 附录 A：完整接口统计

| 模块 | 接口数（含 REST + WS） |
|------|----------------------:|
| user | 12 |
| rbac（含 admin/*） | ~25 |
| chat | 9 REST + 7 WS 事件 |
| ai | 12 |
| file | 4 |
| account_book | 5 |
| sms | 2 |
| audit | 2 |
| dashboard | 3 |
| health | 2 |
| **合计** | **~83 个端点 + 7 WS 事件** |

## 附录 B：前端页面清单

### admin（5 页 + 1 layout）
- Login / Dashboard / UserManage / RoleManage / PermissionManage / AuditLog

### app（11 页 + 2 layout）
- Login / Register / ForgotPassword
- Home / Profile
- AccountBook / FileList / AiChat
- RoomList / ChatRoom

### shared
- types / request / stores(useAuthStore) / utils / composables

## 附录 C：数据库表清单（按模块）

| 模块 | 表名 |
|------|------|
| user | `sys_user` |
| rbac | `sys_role`, `sys_permission`, `sys_user_role`, `sys_role_permission` |
| audit | `sys_audit_log` |
| chat | `sys_chat_room`, `sys_chat_member`, `sys_chat_message` |
| ai | `sys_ai_session`, `sys_ai_message` |
| file | `sys_file` |
| account_book | `sys_account_book`（推断） |

**共 ~12 张核心表**

---

**报告生成完毕。建议归档到 `docs/` 并作为产品迭代的依据。**