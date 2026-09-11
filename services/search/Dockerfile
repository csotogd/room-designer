# Microservicio de búsqueda del catálogo.
#   docker build -f services/search/Dockerfile -t catalog-search .
#   docker run -p 8787:8787 -v search-data:/data -e SEARCH_DATA_DIR=/data catalog-search
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Solo hace falta tsx para ejecutar TypeScript; el servicio no tiene deps propias.
RUN npm install --no-save tsx typescript

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 SEARCH_DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY services/search ./services/search
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["npx", "tsx", "services/search/server.ts"]
