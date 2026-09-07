FROM node:22-alpine

WORKDIR /opt/demo
COPY --chown=node:node demo/api/ ./demo/api/

USER node
ENV DEMO_HOST=0.0.0.0
ENV DEMO_PORT=4001
EXPOSE 4001

CMD ["node", "demo/api/main.mjs"]
