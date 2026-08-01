FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Carrega os ajustes específicos para telas de computador sem alterar o layout mobile.
RUN sed -i 's#</head>#<link rel="stylesheet" href="/desktop.css"></head>#' public/index.html

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
