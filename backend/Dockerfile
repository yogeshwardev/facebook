FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npx playwright install chromium --with-deps
COPY . .
RUN npx prisma generate
RUN npm run build
CMD ["sh", "-c", "npx prisma db push && npm start"]
