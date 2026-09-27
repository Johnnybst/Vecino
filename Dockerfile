FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
RUN pip install --no-cache-dir uv==0.12.19
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
RUN python -m playwright install --with-deps chromium
RUN uv pip install --python /app/.venv/bin/python \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

COPY . .
ENV LOCALE=miami DRY_RUN=true DEMO_MODE=true DB_PATH=/var/data/ice_monitor.db
CMD ["python", "-m", "scripts.start_hosted"]
