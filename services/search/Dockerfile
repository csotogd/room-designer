FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY backend/room_designer ./backend/room_designer
RUN pip install --no-cache-dir -c requirements.lock '.[clip]' && useradd --create-home app
RUN mkdir -p /data && chown app:app /data
ENV PORT=8787 SEARCH_DATA_DIR=/data
USER app
EXPOSE 8787
CMD ["search-serve"]
