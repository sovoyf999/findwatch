# findwatch Docker 镜像：常驻查找监视器
FROM node:20-alpine

WORKDIR /app

# 仅复制运行所需文件，保持镜像精简（无第三方依赖，无需 npm install）
COPY package.json ./
COPY finders.js notifier.js watcher.js scheduler.js targets.json ./

# 以非 root 用户运行
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV INTERVAL_MINUTES=5
ENV NOTIFY_CHANNEL=none

# 容器作为常驻进程运行调度器
CMD ["node", "scheduler.js"]
