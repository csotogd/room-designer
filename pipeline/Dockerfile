FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY backend/room_designer ./backend/room_designer
RUN pip install --no-cache-dir -c requirements.lock '.[mesh,clip]' && useradd --create-home app
COPY services/search/eval ./services/search/eval
RUN mkdir -p /app/data /app/public && chown -R app:app /app/data /app/public
USER app
ENTRYPOINT ["catalog"]
CMD ["ingest"]
