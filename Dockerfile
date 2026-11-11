FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build
FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY server ./server
# The Claude chat runs the Spoolside MCP as its toolset.
COPY mcp/package*.json ./mcp/
RUN cd mcp && npm ci --omit=dev
COPY mcp/server.mjs ./mcp/
USER node
EXPOSE 3000
CMD ["node","server/index.mjs"]
