# NEÓN BLAST — multiplayer server
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY sim.js server.js ./
COPY public ./public

ENV PORT=8080
EXPOSE 8080

RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

CMD ["node", "server.js"]
