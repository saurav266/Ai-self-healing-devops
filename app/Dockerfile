# =========================
# Dependencies
# =========================

FROM node:24-alpine AS dependencies

RUN apk upgrade --no-cache

# Upgrade npm to latest npm 11
RUN npm install -g npm@11.19.1

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev


# =========================
# Runtime
# =========================

FROM node:24-alpine AS runtime

RUN apk upgrade --no-cache

# Upgrade npm to latest npm 11
RUN npm install -g npm@11.19.1

WORKDIR /app

ENV NODE_ENV=production

COPY --from=dependencies /app/node_modules ./node_modules

COPY --chown=node:node src ./src

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]