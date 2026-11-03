FROM node:24-bookworm-slim
RUN npm install --global @anthropic-ai/claude-code@2.1.290
WORKDIR /work
USER node
