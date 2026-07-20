FROM node:18-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY api ./api
COPY web ./web

ENV NODE_ENV=production
ENV PORT=3080
EXPOSE 3080

CMD ["node", "api/server.js"]
