FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
COPY docs ./docs
COPY simulation ./simulation
RUN cd frontend && npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY docs /usr/share/nginx/html/docs
EXPOSE 80
