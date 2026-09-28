# syntax=docker/dockerfile:1

# The build: the client with Vite, the server with tsc. Needs the dev
# dependencies, which stay in this stage.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json tsconfig.web.json ./
COPY src ./src
RUN npm run build:web && npm run build:server

# Production dependencies only.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
# 0.0.0.0: the default, 127.0.0.1, would be the container itself, out of
# reach of the platform's proxy. NODE_ENV=production makes a missing client
# build fatal (see main.ts).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# package.json for "type": "module"; dist holds the server and dist/web.
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The image's built-in unprivileged user. The files stay root's: the server
# reads them and writes nothing.
USER node
EXPOSE 3000
# Node itself, not npm start: npm doesn't reliably pass SIGTERM on, and the
# graceful shutdown (#29) needs it.
CMD ["node", "dist/server/main.js"]
