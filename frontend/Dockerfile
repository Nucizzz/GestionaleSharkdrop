FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .

ARG EXPO_PUBLIC_BACKEND_URL
ARG EXPO_PUBLIC_WEB_URL
ENV EXPO_PUBLIC_BACKEND_URL=$EXPO_PUBLIC_BACKEND_URL
ENV EXPO_PUBLIC_WEB_URL=$EXPO_PUBLIC_WEB_URL

RUN npx expo export -p web --output-dir dist

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist

RUN npm install -g serve

EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
