FROM node:22-alpine
RUN apk add --no-cache unzip tzdata
WORKDIR /app
COPY server.js index.html ./
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node","server.js"]
