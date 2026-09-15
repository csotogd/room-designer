FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public/fonts ./public/fonts
RUN npm run build
ARG COMMIT_SHA
RUN COMMIT_SHA="$COMMIT_SHA" node -e 'const fs = require("fs"); const commit = process.env.COMMIT_SHA; if (!/^[a-f0-9]{40}$/.test(commit)) throw Error("Falta el SHA del commit"); fs.writeFileSync("dist/release.json", JSON.stringify({commit}));'

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY services/frontend/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
