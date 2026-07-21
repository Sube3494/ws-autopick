# syntax=docker/dockerfile:1.7

FROM oven/bun:alpine AS builder
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src
RUN bun run build

FROM oven/bun:alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=22800
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/ws-autopick.sqlite

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

EXPOSE 22800

CMD ["bun", "dist/index.js"]
