FROM node:22-slim AS pdfjs

ARG PDFJS_VERSION=5.7.284

WORKDIR /tmp/pdfjs

RUN npm init -y \
    && npm install "pdfjs-dist@${PDFJS_VERSION}" \
    && mkdir -p /out \
    && cp node_modules/pdfjs-dist/build/pdf.min.mjs /out/pdf.mjs \
    && cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs /out/pdf.worker.mjs


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APDF_DATA_DIR=/app/data \
    APDF_FONTS_DIR=/app/fonts

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY app/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY fonts ./fonts

COPY --from=pdfjs /out ./app/static/pdfjs

RUN mkdir -p /app/data/jobs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]