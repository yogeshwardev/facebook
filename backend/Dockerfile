FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install typescript -g
RUN npm install --include=dev
COPY . .
RUN npx prisma generate
RUN npm run build
CMD ["npm", "start"]
