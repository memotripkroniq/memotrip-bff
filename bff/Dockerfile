FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /app

# kopie package souborů
COPY package*.json ./

# install deps (NEinstaluje znovu browser, už tam je)
RUN npm install

# kopie zdrojáků
COPY . .

# build NestJS
RUN npm run build

# Railway port
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start:prod"]
