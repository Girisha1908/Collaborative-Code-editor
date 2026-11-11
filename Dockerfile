# --- build the React client ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY public ./public
COPY src ./src
RUN npm run build

# --- runtime: Express + Socket.IO + WebSocket terminal server ---
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY server ./server
COPY db ./db
COPY src/Actions.js src/languages.js ./src/
COPY --from=build /app/build ./build
EXPOSE 5000
CMD ["node", "server.js"]
