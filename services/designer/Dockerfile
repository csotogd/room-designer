# Microservicio de diseño conversacional.
#   docker build -f services/designer/Dockerfile -t catalog-designer .
#   docker run -p 8790:8790 -v designer-data:/data -e DESIGNER_ROOM_FILE=/data/room.json catalog-designer
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm install --no-save tsx typescript

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DESIGNER_PORT=8790
COPY --from=deps /app/node_modules ./node_modules
COPY services/designer ./services/designer
COPY services/search/core ./services/search/core
COPY public/catalog ./public/catalog
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8790/healthz || exit 1
CMD ["npx", "tsx", "services/designer/server.ts"]
