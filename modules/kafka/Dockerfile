FROM node:22-bookworm-slim

WORKDIR /app

RUN npm install --global pnpm@9.15.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY modules/kafka/events.ts modules/kafka/consumer.mjs ./modules/kafka/

USER node
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "modules/kafka/consumer.mjs"]
