FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p var/uploads && chown -R node:node /app
COPY --chown=node:node src ./src
USER node
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node","src/server.js"]
