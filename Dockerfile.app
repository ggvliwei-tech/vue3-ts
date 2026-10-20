# ============================================================
# App (移动端 H5) 前端镜像 - Vue 3 + Nginx
# 与 admin 共享同一套 nginx 配置模板，但端口不同
# ============================================================

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
WORKDIR /app

# 不写 `.npmrc*`：仓库里没有 .npmrc，COPY 通配符匹配不到文件会让构建直接失败
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY packages/app ./packages/app

WORKDIR /app/packages/shared
RUN pnpm install --frozen-lockfile && pnpm build

WORKDIR /app/packages/app

# 后端地址（构建期注入）。留空 = 走相对路径，由本镜像的 nginx 把 /api/ 反代到 backend。
# 需要前端直连别的域名时：docker compose build --build-arg VITE_API_BASE_URL=https://api.xxx.com
# 注：Vite 里 process.env 的优先级高于 .env.production（见 vite 的 loadEnv 实现），
#     所以这个 ENV 一定能覆盖仓库里的 packages/app/.env.production。
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm install --frozen-lockfile && pnpm build

FROM nginx:1.27-alpine AS runtime
RUN rm /etc/nginx/conf.d/default.conf

# app 与 admin 用同一份 nginx 配置（端口都开 80）
COPY deploy/nginx/admin.conf /etc/nginx/conf.d/app.conf

COPY --from=builder /app/packages/app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]