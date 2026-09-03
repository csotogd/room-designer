# Imagen del pipeline (ingesta + generador) para Cloud Run.
# Local: docker build -f pipeline/Dockerfile -t pipeline .
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install tsx sharp @gradio/client

COPY pipeline ./pipeline
COPY tsconfig.json ./

# Entrypoints:
#   ingest [--site sklum --country es --limit 200]
#   generate [--site sklum]
#   judge [--site sklum]
#   serve-generator   (HTTP para push de Pub/Sub; ciclo siguiente)
ENTRYPOINT ["npx", "tsx"]
CMD ["pipeline/cli/ingest.ts"]
