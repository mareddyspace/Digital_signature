# One container: the built admin web is served by the FastAPI backend on the same origin.
FROM node:20-alpine AS web
WORKDIR /web
COPY admin-web/package.json admin-web/package-lock.json ./
RUN npm ci
COPY admin-web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY outlook-addin/ outlook-addin/
COPY --from=web /web/dist backend/static/admin
# MSAL for the Outlook add-in's sign-in (nested app authentication), served inside /addin/launchevent.js.
COPY --from=web /web/node_modules/@azure/msal-browser/lib/msal-browser.min.js /app/msal/msal-browser.min.js
ENV ADMIN_STATIC_DIR=/app/backend/static/admin \
    ADDIN_DIR=/app/outlook-addin \
    MSAL_BUNDLE=/app/msal/msal-browser.min.js \
    PYTHONUNBUFFERED=1
WORKDIR /app/backend
EXPOSE 8000
# Migrations run once per container start, before the server; the app itself only checks the schema.
CMD ["sh", "-c", "python -m app.migrate && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
