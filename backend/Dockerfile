FROM python:3.13-slim@sha256:168d3a5d10f2152f8e8d77b6843ac82c22a846cfefeef7afdf9aa630404e82a7 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 POIDEM_ROOT=/app
WORKDIR /app
COPY requirements.lock /app/backend/requirements.lock
RUN pip install --no-cache-dir -r /app/backend/requirements.lock
COPY pyproject.toml alembic.ini /app/backend/
COPY src /app/backend/src
COPY migrations /app/backend/migrations
RUN pip install --no-cache-dir --no-deps /app/backend \
    && useradd --create-home --uid 10001 poidem \
    && mkdir -p /app/uploads/profiles && chown -R poidem:poidem /app/uploads
USER poidem
EXPOSE 8001
CMD ["python", "-m", "poidem", "--host", "0.0.0.0", "--port", "8001"]

FROM runtime AS test
USER root
COPY requirements-dev.lock /app/backend/requirements-dev.lock
RUN pip install --no-cache-dir -r /app/backend/requirements-dev.lock
COPY tests /app/backend/tests
USER poidem
