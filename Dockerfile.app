# ============================================================
# App (移动端 H5) 前端镜像 - Vue 3 + Nginx
# 与 admin 共享同一套 nginx 配置模板，但端口不同
# ============================================================

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc* ./
COPY packages/shared ./packages/shared
COPY packages/app ./packages/app

WORKDIR /app/packages/shared
RUN pnpm install --frozen-lockfile && pnpm build

WORKDIR /app/packages/app
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