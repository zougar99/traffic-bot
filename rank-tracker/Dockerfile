FROM node:22-alpine

# node:sqlite is built in — no dependencies to install.
WORKDIR /app

COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY test ./test

ENV NODE_ENV=production \
    PORT=4170 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 4170

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4170)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "src/server.js"]
