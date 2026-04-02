FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    python3-tk \
    tk-dev \
    && rm -rf /var/lib/apt/lists/*

RUN pip install poetry

WORKDIR /app

COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.create false && poetry install --no-root

COPY . .

CMD ["python", "main.py"]
