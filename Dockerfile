FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/package-lock.json /app/package-lock.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/src /app/src
COPY --from=build /app/dist /app/dist
EXPOSE 8787
CMD ["npm", "start"]
