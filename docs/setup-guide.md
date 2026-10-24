# Setup Guide

> Environment setup and installation instructions.

**繁體中文版**: 請參閱 [QUICKSTART.zh-TW.md](../QUICKSTART.zh-TW.md) 取得完整的繁體中文快速開始指南。

## Prerequisites

- [x] Python 3.11+
- [x] Node.js 22+ (vitest 5 and jsdom 30 need 22.22 or newer)
- [x] Docker & Docker Compose (for production deployment)

## Installation

### 1. Clone Repository

```bash
git clone https://github.com/username/project-name.git
cd project-name
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
# (Add specific variables that need to be configured)
```

### 3. Dependencies

#### Python Project

```bash
# Create virtual environment
python -m venv .venv

# Activate (Windows)
.venv\Scripts\activate

# Activate (Linux/macOS)
source .venv/bin/activate

# Install dependencies (exact versions from uv.lock; `pip install -e ".[dev]"` also works, unpinned)
uv sync --extra dev
```

#### Node.js Project

```bash
npm install
# or
yarn install
```

### 4. Database Setup

The project uses SQLite — no external database needed. Initialize with:

```bash
alembic upgrade head
```

### 5. Verify Installation

```bash
# Run tests to verify setup
pytest  # Python
npm test  # Node.js
```

## Running the Project

### Development Mode

```bash
# Python
python main.py

# Node.js
npm run dev
```

### Production Mode

```bash
# (Add production run commands)
```

## Common Issues

### Issue 1: [Problem Description]

**Solution**: (How to fix)

### Issue 2: [Problem Description]

**Solution**: (How to fix)

---

*Last updated: 2026-03-15*
