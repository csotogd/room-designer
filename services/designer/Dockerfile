FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY backend/room_designer ./backend/room_designer
RUN pip install --no-cache-dir -c requirements.lock . && useradd --create-home app
COPY public/catalog ./public/catalog
RUN mkdir -p /data && chown app:app /data
ENV DESIGNER_PORT=8790 DESIGNER_ROOM_FILE=/data/room.json DESIGNER_SCREENSHOT_DIR=/data/screenshots
USER app
EXPOSE 8790
CMD ["designer-serve"]
