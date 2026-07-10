FROM node:20-alpine

# Native build tools + keytool for auto APK signature extraction on deploy
RUN apk add --no-cache openssl python3 make g++ openjdk17-jre

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x docker-entrypoint.sh scripts/resolve-allowed-signatures.sh

ENV NODE_ENV=production
ENV PORT=3847

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
