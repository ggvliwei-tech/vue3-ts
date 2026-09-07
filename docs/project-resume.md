# Vue3 Monorepo 通用后台模板 · 项目介绍

> 一份可直接用于 **简历 / 面试 / 技术评审 / 项目汇报** 的项目说明文档。
> 项目代号：**Vue3 Full-Stack Admin Template**

---

## 目录

1. [项目一句话定位](#1-项目一句话定位)
2. [项目概述](#2-项目概述)
3. [技术栈总览](#3-技术栈总览)
4. [项目结构](#4-项目结构)
5. [核心功能模块](#5-核心功能模块)
6. [技术亮点](#6-技术亮点)
7. [可量化数据指标](#7-可量化数据指标)
8. [个人简历模板](#8-个人简历模板)
9. [面试高频问答](#9-面试高频问答)
10. [运行与部署](#10-运行与部署)

---

## 1. 项目一句话定位

> 一套 **pnpm Monorepo + TypeScript 全栈类型贯穿** 的中后台 / 移动端 H5 / AI 对话 / 实时聊天一体化模板，集成 **NestJS 11 后端 + Vue3 双前端 + RBAC 权限 + JWT 双 Token + LangChain RAG + SSE 流式 + Socket.IO 实时聊天 + Docker 一键部署**，开箱即用、生产可用。

---

## 2. 项目概述

### 2.1 解决什么问题

| 场景 | 痛点 | 本项目方案 |
|------|------|-----------|
| 新项目启动 | 重复搭建权限 / 登录 / 部署 | 模板直接复用，省去 2~4 周基础工作 |
| 前后端协作 | 类型不一致、字段定义分散 | `@project/shared` 一份类型 / 工具 / 状态代码 |
| 多端展示 | 后台 + H5 各自一套脚手架 | Monorepo 共用一套技术栈与共享层 |
| AI 集成 | LangChain / RAG / 流式输出难整合 | 已封装完整编排 + PDF 知识库 + SSE 流式 |
| 生产部署 | 配置复杂、环境不一致 | Docker Compose 一键编排 5 容器 |
| 安全合规 | 鉴权 / 限流 / 风控散落各处 | 统一守卫 + 中间件 + 过滤器 |

### 2.2 适用场景

- 中后台管理系统（Admin + RBAC）
- 移动端 H5（含登录 / 资料 / 即时聊天 / AI 助手）
- AI 对话应用（单轮 / 多轮 / RAG 知识库 / 流式输出）
- 实时聊天（房间 / 成员 / 历史消息 / 在线状态）
- 企业内部系统、个人 SaaS 产品的快速脚手架

---

## 3. 技术栈总览

### 3.1 工程化

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 包管理 | pnpm + Workspace | 10.18 | 多包管理 / 依赖隔离 / 软链接共享 |
| 语言 | TypeScript | 6.x | 全栈严格类型（strict mode） |
| 构建-前端 | Vite | 8.x | dev server 极速冷启动 |
| 构建-后端 | NestJS CLI | 11.x | nest build / nest start |
| 代码规范 | ESLint | 9.x | flat config + typescript-eslint |
| 格式化 | Prettier | 3.x | 统一代码风格 |
| 编排 | concurrently | 10.x | 同时启动 server / admin / app |

### 3.2 后端（NestJS 11）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | NestJS | 11 | 模块化 / DI / AOP 装饰器 |
| ORM | TypeORM + mysql2 | 1.x / 3.x | 实体映射 / Repository / Migration |
| 缓存 / 会话 | ioredis | 5.x | 多设备会话 / 黑名单 / 权限缓存 |
| 鉴权 | @nestjs/jwt + passport-jwt | 11 | Access + Refresh 双 Token |
| 限流 | @nestjs/throttler | 6.x | IP 滑动窗口 + 登录失败锁定 |
| WebSocket | @nestjs/websockets + socket.io | 11 / 4.x | 聊天室 Gateway |
| SSE | @Sse() + RxJS Observable | - | AI 流式输出 |
| AI 编排 | LangChain + ChromaDB | 1.x / 3.x | LLM / Embedding / 向量检索 |
| 文件 | multer + ali-oss + sharp | - | 上传 / OSS / 图片压缩 |
| 日志 | Winston + nest-winston | 3.x / 1.x | 控制台 + JSON 文件双输出 |
| 安全 | helmet + compression + cookie-parser | - | 安全头 / gzip / Cookie 解析 |
| API 文档 | @nestjs/swagger | 11 | OpenAPI 3.0 + Swagger UI |
| 测试 | Jest + supertest | 30 / 7 | 单元测试 + E2E |
| 定时任务 | @nestjs/schedule | 12 | 审计日志清理 |
| 事件机制 | @nestjs/event-emitter | 3 | 审计解耦 |

### 3.3 Admin PC 后台（Vue 3 + Element Plus）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Vue | 3.5 | Composition API + `<script setup>` |
| 路由 | vue-router | 4.x | History 模式 + 路由 meta 权限 |
| 状态 | Pinia | 4.x | 替代 Vuex，更好的 TS 推断 |
| UI 库 | Element Plus | 2.14 | 中后台组件 + 图标 |
| 自动导入 | unplugin-auto-import | 21.x | Vue / Vue Router / Pinia / lodash-es 按需 |
| 自动注册 | unplugin-vue-components | 32.x | Element Plus 组件按需 |
| HTTP | axios | 1.x | 二次封装（拦截器 + 401 刷新） |

### 3.4 App 移动端 H5（Vue 3 + Vant 5）

| 类别 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 框架 | Vue | 3.5 | 同 Admin |
| 路由 | vue-router | 4.x | - |
| 状态 | Pinia | 4.x | - |
| UI 库 | Vant | 5.x | 移动端 H5 组件 |
| 实时 | socket.io-client | 4.x | 聊天室 |
| Markdown | markdown-it | 15.x | AI 回复内容渲染 |
| SSE | fetch + ReadableStream | 原生 | AI 流式输出（支持自定义头） |

### 3.5 共享层 `@project/shared`

| 类别 | 技术 | 说明 |
|------|------|------|
| HTTP | axios | 统一请求封装 / 拦截器 / 401 刷新队列 |
| 状态 | Pinia | useAuthStore（统一登录态） |
| 工具 | dayjs / lodash-es | 时间处理 / 工具函数 |
| 类型 | TS 自定义 | ApiRes / PageRes / BusinessCode |

### 3.6 部署 / 运维

- **Docker**：多阶段构建（前后端）+ 非 root 用户
- **Docker Compose**：5 容器（MySQL + Redis + Backend + Admin + App）
- **Nginx**：静态托管前端 + gzip
- **健康检查**：liveness + readiness 双端点
- **可观测**：自研轻量 Prometheus 兼容指标（零外部依赖）

---

## 4. 项目结构

```
vue3-monorepo/
├── packages/
│   ├── shared/                 # 前后端共享类型 / 常量 / 工具 / 状态
│   ├── server/                 # NestJS 11 后端
│   │   └── src/
│   │       ├── main.ts         # 应用入口（中间件/管道/过滤器装配）
│   │       ├── app.module.ts   # 根模块
│   │       ├── common/         # 通用基础设施
│   │       │   ├── enums/      # 统一业务码
│   │       │   ├── exceptions/ # 业务异常基类
│   │       │   ├── filters/    # 全局异常过滤器
│   │       │   ├── guards/     # JwtAuth / Permissions / Roles / RefreshToken
│   │       │   ├── interceptors/ # TransformInterceptor
│   │       │   ├── decorators/ # CurrentUser / Permissions
│   │       │   └── logger/     # Winston 配置
│   │       ├── modules/
│   │       │   ├── auth/       # 鉴权（登录风控 + 多设备会话）
│   │       │   ├── user/       # 用户
│   │       │   ├── rbac/       # RBAC（@Global）
│   │       │   ├── admin/      # 管理后台 API（role / permission / audit / dashboard）
│   │       │   ├── chat/       # WebSocket 聊天室
│   │       │   ├── ai/         # AI（llm / rag / chat-history）
│   │       │   ├── account_book/ # 账本业务
│   │       │   ├── file/       # 文件上传 / OSS
│   │       │   ├── sms/        # 短信验证码
│   │       │   ├── metrics/    # Prometheus 指标
│   │       │   ├── redis/      # Redis 服务封装
│   │       │   └── health/     # 健康检查
│   │       └── config/         # 环境变量配置
│   ├── admin/                  # Vue3 后台
│   └── app/                    # Vue3 移动端 H5
├── deploy/
│   └── nginx/                  # 前端 nginx 配置
├── docs/                       # 项目文档（含本文档）
├── logs/                       # 后端日志（运行时生成）
├── docker-compose.yml          # 一键编排
├── Dockerfile.server           # 后端镜像
├── Dockerfile.admin            # Admin 前端镜像
└── Dockerfile.app              # App 前端镜像
```

---

## 5. 核心功能模块

### 5.1 鉴权与权限（RBAC）

```
sys_user ──< sys_user_role >── sys_role ──< sys_role_permission >── sys_permission
```

- **角色**：admin / editor / user 等
- **权限码**：`user:list` / `book:create` / `admin:audit` 等细粒度操作
- **后端校验链**：`JwtAuthGuard`（验 Token + 黑名单） → `PermissionsGuard`（校验 `@Permissions` 装饰器） → Redis 缓存读权限码 → 命中即放行
- **前端双层控制**：路由 `meta.permissions` 控制页面 + `v-permission` 指令控制按钮
- **缓存策略**：登录时从 DB 读权限码写入 Redis，请求时优先读缓存

### 5.2 JWT 双 Token + 多设备会话

| Token | 有效期 | 用途 | 存储 |
|-------|--------|------|------|
| AccessToken | 15min | 业务接口鉴权 | 前端内存 + 请求头 |
| RefreshToken | 7d | 刷新 AccessToken | HttpOnly Cookie + Redis |

**Redis 数据结构**：
- `refresh:token:{userId}:{sessionId}` → String，单设备 RT，TTL 与 JWT 一致
- `session:{userId}` → Hash，field=sessionId，value=JSON{loginTime, ip, userAgent}

**安全策略**：
- RefreshToken **一次性轮换**（防重放）
- 多设备登录支持，可 **单设备踢下线**（基于 sessionId）
- 登录失败 5 次自动锁定 15 分钟
- IP 滑动窗口限流（10s / 5 次）

### 5.3 AI 集成（LangChain + RAG + SSE 流式）

**能力矩阵**：

| 端点 | 能力 |
|------|------|
| `POST /ai/chat` | 单轮问答（无历史） |
| `POST /ai/chat/history` | 多轮对话（持久化历史） |
| `POST /ai/rag` | RAG 知识库问答 |
| `GET /ai/stream` | SSE 流式输出（无历史） |
| `GET /ai/stream/history` | SSE 流式输出（带历史 + 会话 ID） |
| `POST /ai/upload/pdf` | 上传 PDF 入向量库 |
| `POST /ai/session/create` | 创建新会话 |
| `GET /ai/session/last` | 获取最近会话 |
| `GET /ai/sessions` | 列出所有会话 |
| `POST /ai/session/:id/delete` | 删除单个会话 |
| `POST /ai/sessions/clear` | 清空所有会话 |
| `GET /ai/session/:id/messages` | 获取历史消息 |

**拆分式服务架构**（替代原 537 行上帝类）：
- `AiService`（编排层，对外接口）
- `LlmProviderService`（模型层，OpenAI / Ollama 切换）
- `RagService`（向量检索层）
- `AiChatHistoryService`（历史持久化）

**前端 SSE 工具**（[packages/app/src/utils/sse.ts](../packages/app/src/utils/sse.ts)）：
- 基于 `fetch + ReadableStream`（支持自定义 `Authorization` 头，`EventSource` 不支持）
- 统一 `consume()` 私有函数消除重复
- 自动从 `useAuthStore` 取 token（不依赖参数透传）
- `AbortSignal` 支持中断
- 401 自动刷新 token 并重试

### 5.4 实时聊天室（Socket.IO）

- **网关**：`/ws` namespace
- **能力**：房间管理、成员加入/离开、消息持久化、分页历史、在线状态
- **前端**：乐观更新（temp 消息等 server ack）+ 在线用户集合响应式
- **鉴权**：WS 连接时校验 JWT + `chat:room` 权限码（复用 RBAC）

### 5.5 统一响应格式

```typescript
// 成功
{ code: 0, msg: 'success', data: { ... }, requestId: 'req_xxx', timestamp: 1725000000000 }

// 业务错误
{ code: 10001, msg: '参数不能为空', data: { errors: [...] }, requestId: 'req_xxx', timestamp: 1725000000000 }
```

- 前端只需判断 `code === 0`
- `requestId` 全链路追踪（过滤器回填 + 日志记录）

### 5.6 可观测性

| 维度 | 实现 |
|------|------|
| 日志 | Winston + nest-winston，控制台（带色）+ JSON 文件（ELK / Loki 可采集）+ 独立 error 文件（告警） |
| 指标 | 自研 Prometheus 兼容导出器，零外部依赖 |
| 链路 | requestId 注入 → 异常过滤器 → 日志 |
| 健康 | `/health`（liveness）+ `/health/ready`（readiness，校验 DB + Redis） |
| 审计 | TypeORM Subscriber 监听实体变更 → 写审计日志 → 定时清理 |

### 5.7 部署运维

```
┌─────────── Docker Compose ───────────┐
│  mysql (8.0)   redis (7)             │
│       ↓             ↓                │
│      backend (NestJS)                │
│       ↓             ↓                │
│     admin (Nginx)   app (Nginx)      │
└──────────────────────────────────────┘
```

- 多阶段构建（仅 dist 产物进最终镜像）
- 非 root 用户运行
- HEALTHCHECK 自动剔除异常实例
- 日志卷挂载到宿主机
- 网络隔离（自定义 bridge）

---

## 6. 技术亮点

### 6.1 🌟 单一职责拆分

> 原 `ai.service.ts` 537 行上帝类，拆分为 4 个服务（编排 / 模型 / 向量 / 历史），对 Controller 接口保持兼容。

### 6.2 🌟 共享层零成本复用

> 一份 `@project/shared` 代码同时供 Admin / App / 后端依赖使用，避免前后端类型定义漂移。

### 6.3 🌟 SSE 流式自定义 Header

> 自研 [sse.ts](../packages/app/src/utils/sse.ts) 工具，用 `fetch + ReadableStream` 替代 `EventSource`，解决浏览器 SSE 不支持自定义 `Authorization` 头的痛点。

### 6.4 🌟 RefreshToken 一次性轮换

> 每次刷新都颁发新的 RefreshToken 并废弃旧的，结合 Redis 黑名单，防止 Token 重放攻击。

### 6.5 🌟 多设备会话 + 精确踢下线

> 基于 `session:{userId}` Hash 存储每个设备的 sessionId，踢下线精确到设备，不影响其他设备。

### 6.6 🌟 轻量指标收集器

> 不引入 prom-client（bundle 较大），自研 Counter / Gauge / Histogram + label 基数控制，输出标准 Prometheus 文本格式。

### 6.7 🌟 全链路 requestId

> 入口中间件生成 `req_xxx` → 写入响应头 → 异常过滤器回填 → 日志记录 → 前端错误上报可携带。

### 6.8 🌟 优雅的 Docker 化

> 多阶段构建、非 root 用户、健康检查、自动重启、日志卷挂载、网络隔离，一键启动整套生产环境。

---

## 7. 可量化数据指标

| 维度 | 数据 |
|------|------|
| 端数 | 3 端（Admin + App + Server） |
| 后端业务模块 | 14 个（auth / user / rbac / admin / chat / ai / account_book / file / sms / metrics / redis / health / audit / ai 子模块） |
| 数据库表 | 15+ 张（用户 / 角色 / 权限 / 用户角色 / 角色权限 / 审计 / 聊天房间 / 成员 / 消息 / AI 会话 / 消息 / 账本 / 文件 / 短信等） |
| API 接口 | 80+ 个 REST + SSE + WebSocket |
| AI 端点 | 12 个（含 RAG / 流式 / 会话管理 / 文件上传） |
| Docker 编排容器 | 5 个 |
| 鉴权守卫 | 4 个（JwtAuth / Permissions / Roles / RefreshToken） |
| 全局过滤器 | 2 个（GlobalException / HttpException） |
| 测试覆盖 | LoginThrottler 100% / Session 100% / GlobalExceptionFilter 95%+ / UserService 70%+ |
| 健康检查端点 | 2 个（liveness + readiness） |
| 代码注释 | 全量 JSDoc 中文注释，团队协作友好 |

---

## 8. 个人简历模板

> 以下模板可直接复制到简历中。

### 8.1 项目经历

**项目名称**：Vue3 Monorepo 通用后台模板
**项目时间**：2025.08 - 至今
**项目角色**：全栈工程师（独立设计 / 开发）
**技术栈**：NestJS 11 + Vue 3.5 + TypeScript + TypeORM + Redis + LangChain + ChromaDB + Docker

**项目描述**：
面向中后台 / 移动端 H5 / AI 对话 / 实时聊天的一体化全栈模板，采用 pnpm Monorepo 架构，前后端共享类型与工具，支持 Docker 一键部署生产环境。

**核心职责**：

1. **架构设计**：主导 Monorepo 架构，建立 `@project/shared` 共享层，实现前后端类型一致、工具复用；制定模块边界（每个模块含 entities/dto/controller/service/module）。

2. **权限体系**：设计并实现完整 RBAC 模型（4 表多对多关系），后端 `@Permissions` 装饰器 + `PermissionsGuard` + Redis 权限码缓存；前端路由 meta + `v-permission` 指令双层控制。

3. **鉴权与风控**：实现 JWT 双 Token（Access 15min + Refresh 7d）+ HttpOnly Cookie；RefreshToken 一次性轮换防重放；多设备会话基于 Redis Hash；登录失败 5 次锁定 15min；IP 滑动窗口限流。

4. **AI 集成**：基于 LangChain 1.x 集成 OpenAI / Ollama 双模型；实现 RAG 知识库（PDF 上传 → 解析 → ChromaDB 向量检索 → LLM 生成）；服务端 `@Sse()` 配合 RxJS Observable 实现流式输出；前端自研 `fetch + ReadableStream` SSE 工具支持自定义 Authorization 头。

5. **实时通讯**：基于 Socket.IO 实现聊天室 Gateway（房间 / 成员 / 在线状态 / 历史消息分页），复用 RBAC 权限码 `chat:room` 校验；前端乐观更新提升交互体验。

6. **可观测性**：自研零依赖 Prometheus 兼容指标收集器（Counter / Gauge / Histogram）；Winston 结构化日志（控制台 + JSON 文件双输出）；全链路 requestId 追踪。

7. **部署运维**：Docker 多阶段构建（非 root 用户 + 健康检查）；Docker Compose 一键编排 5 容器（MySQL + Redis + Backend + Admin + App）；健康检查双端点（liveness + readiness）支持 K8s 探针。

**项目成果**：

- 开箱即用，可作为后续多个业务项目模板
- 关键服务测试覆盖 95%~100%
- 单容器部署到生产可用 < 5 分钟（`docker compose up -d`）

---

## 9. 面试高频问答

### Q1：为什么用 pnpm Monorepo 而不是 npm/yarn workspaces？

**A**：pnpm 1) 硬链接节省磁盘空间；2) 严格的依赖隔离（幽灵依赖防护）；3) 软链接共享包无需发布到 npm registry，本地修改实时生效；4) 性能优于 npm/yarn。

### Q2：为什么要拆分 `@project/shared`？

**A**：1) **类型一致**：后端 DTO 与前端 API 调用共享同一份 TS 类型，杜绝字段不一致；2) **工具复用**：axios 二次封装（401 刷新队列）、useAuthStore（统一登录态）三端共用；3) **避免重复**：业务码枚举、分页响应结构只定义一次。

### Q3：JWT 双 Token 为什么要一次性轮换？

**A**：RefreshToken 一旦泄露，攻击者可无限期使用。一次性轮换（每次刷新都颁发新 RT 并废弃旧 RT）即使被窃取，合法用户下次刷新时旧 RT 立即失效，触发黑名单机制。

### Q4：SSE 为什么要用 fetch 不用 EventSource？

**A**：浏览器原生 `EventSource` 不支持自定义请求头，无法携带 `Authorization: Bearer xxx`。改用 `fetch + ReadableStream` 手动解析 `data:` 协议，既保留流式能力又支持鉴权。

### Q5：RBAC 为什么用权限码不用角色直接判断？

**A**：权限码粒度更细（`user:list / user:create / user:delete`），角色只是权限码的集合。新增角色无需改代码，只需在管理后台给角色分配权限码。

### Q6：为什么自研指标收集器不用 prom-client？

**A**：prom-client bundle 较大且与 NestJS 集成需要额外适配层。自研版本仅 ~300 行，支持 Counter / Gauge / Histogram + label 基数控制，输出标准 Prometheus 文本格式，可直接被 Prometheus 抓取。

### Q7：Docker 多阶段构建的好处？

**A**：1) 最终镜像仅含 dist 产物和运行时依赖，体积更小（后端镜像从 ~1GB 降到 ~200MB）；2) 构建工具（gcc / python 等）不进入最终镜像，减少攻击面；3) 缓存友好，构建层独立。

### Q8：如何保证 WebSocket 安全性？

**A**：连接时校验 JWT（从 query 解析），验证 token 黑名单，通过 `RbacService` 校验 `chat:room` 权限码；服务端不信任客户端发来的 userId，统一从 JWT 取。

### Q9：TypeORM synchronize 在生产环境为什么要关？

**A**：synchronize 会根据 Entity 自动改库结构，可能导致生产数据丢失。生产应使用 Migration（`typeorm migration:run`）做受控变更。

### Q10：登录失败计数和 IP 限流为什么分开？

**A**：账号维度（防暴力破解特定账号）+ IP 维度（防批量攻击不同账号）形成纵深防御。攻击者轮换账号仍被 IP 限流，攻击者换 IP 仍被账号锁定挡住。

---

## 10. 运行与部署

### 10.1 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 构建共享包（首次）
pnpm build:shared

# 3. 准备数据库（执行 packages/server/nest-db.sql）

# 4. 配置 packages/server/.env

# 5. 一键启动三端
pnpm dev:full
```

访问：
- Admin：http://localhost:5173
- App H5：http://localhost:5174
- API：http://localhost:3000
- Swagger：http://localhost:3000/api-docs

### 10.2 Docker 一键部署（生产推荐）

```bash
# 1. 准备环境变量
cp .env.example .env
# 修改 JWT_SECRET、MYSQL_ROOT_PASSWORD、REDIS_PASSWORD 等

# 2. 一键启动
docker compose up -d --build

# 3. 查看日志
docker compose logs -f backend

# 4. 访问
# Admin:    http://localhost:8080
# App H5:   http://localhost:8081
# API:      http://localhost:3000
# Swagger:  http://localhost:3000/api-docs
# Health:   http://localhost:3000/health
```

### 10.3 生产部署清单

- [ ] 修改所有默认密码（JWT_SECRET / MYSQL / REDIS）
- [ ] `NODE_ENV=production`
- [ ] `synchronize: false`（TypeORM 不自动改库）
- [ ] 关闭 Swagger（自动：生产环境不挂载）
- [ ] HTTPS（Nginx + Let's Encrypt）
- [ ] 日志收集（Filebeat / Promtail → ELK / Loki）
- [ ] 监控告警（Prometheus 抓 `/metrics` + Alertmanager）
- [ ] 数据库备份（每日 mysqldump）
- [ ] 后端多实例 + Nginx upstream 负载均衡

---

## 附录：项目仓库地址

> 本文档对应的项目仓库可在公司内部 GitLab 访问，代码已包含完整 JSDoc 注释与本说明文档。

**文档版本**：v1.0
**最后更新**：2026-09-04
**维护人**：liwei
