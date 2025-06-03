########################  BUILD  ########################
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
# creates the production build in .next/
RUN npm run build

######################  RUNTIME  ########################
FROM node:20-alpine

# every command below now runs inside /app
WORKDIR /app

# install curl for healthcheck
RUN apk add --no-cache curl

# ─── bring everything we need from the build image ──────────────────
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules     ./node_modules
COPY --from=builder /app/.next            ./.next
COPY --from=builder /app/public           ./public
COPY --from=builder /app/next.config.js   ./next.config.js

ENV NODE_ENV=production
EXPOSE 3000

# launch the Next.js server
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
