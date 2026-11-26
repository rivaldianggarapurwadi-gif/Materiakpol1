# Two images from one file:
#   app    — the API (small)
#   worker — adds FFmpeg (video) and LibreOffice (Word/PPT/Excel previews)
FROM node:22.20.0-bookworm-slim AS base
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src

FROM base AS app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/app.js"]

FROM base AS worker
# Intel hardware video encoding (Quick Sync / VAAPI) needs the non-free media driver on amd64.
RUN sed -i 's/^Components: main$/Components: main non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      fonts-dejavu fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core \
 && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      apt-get install -y --no-install-recommends intel-media-va-driver-non-free i965-va-driver vainfo; \
    fi \
 && rm -rf /var/lib/apt/lists/*
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/worker.js"]
