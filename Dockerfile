# สำหรับ deploy บน VPS/เซิร์ฟเวอร์ของบริษัท:  docker build -t beq-toolkit . && docker run -p 3000:3000 --env-file .env.local beq-toolkit
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm","start"]
