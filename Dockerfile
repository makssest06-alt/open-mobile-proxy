# Multi-stage Docker build for open-mobile-proxy
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/src/db/schema.ts ./src/db/schema.ts

EXPOSE 3000 10000-10100

CMD ["node", "dist/server.cjs"]
