# Testing Strategy

> Testing approach, standards, and procedures.

## Overview

This project uses a multi-layer testing approach:
- **Backend**: pytest for Python code (API, services, models)
- **Frontend**: Vitest for TypeScript/React code (utilities, components)

## Test Types

### Unit Tests

#### Backend (Python)

- **Location**: `tests/`
- **Framework**: pytest
- **Coverage Target**: 80%

#### Frontend (TypeScript)

- **Location**: `frontend/src/__tests__/`
- **Framework**: Vitest
- **Coverage Target**: 80%

### Integration Tests

- **Location**: `tests/integration/`
- **Framework**: pytest + httpx (async client)
- **Scope**: API endpoint testing with database

## Backend Test Structure

### Template System Tests (Phase 3)

| Test File | Description | Tests |
|-----------|-------------|-------|
| `tests/unit/test_template_service.py` | Service layer unit tests | 18 |
| `tests/integration/test_api_templates.py` | API integration tests | 17 |

#### test_template_service.py

- Template CRUD (create, get_by_id, get_by_name, list_by_owner)
- Update with version conflict detection
- Soft delete / hard delete
- Usage tracking (record_usage, get_use_count, get_usage_stats)
- Batch sync for migration
- Ownership verification (template isolation)

#### test_api_templates.py

- API endpoints (GET, POST, PATCH, DELETE)
- Authentication required (401 Unauthorized)
- Authorization (404 for other user's templates)
- Version conflict response (409 Conflict)
- Usage recording and statistics
- Sync/migration endpoint

### End-to-End Tests

- **Location**: `tests/e2e/` (future)
- **Framework**: Playwright (planned)
- **Scope**: Full user flows

## Running Tests

### Backend Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=src --cov-report=html

# Specific test file
pytest tests/test_auth.py
```

### Frontend Tests

```bash
cd frontend

# Install dependencies first
npm install

# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run with coverage
npm run test:coverage
```

## Frontend Test Structure

### Template System Tests

| Test File | Description |
|-----------|-------------|
| `templates.test.ts` | Built-in template validation |
| `templateStorage.test.ts` | localStorage CRUD and usage tracking |
| `templateExport.test.ts` | Export/import encryption and round-trip |

### Test Categories

#### templates.test.ts

- Template structure validation (required fields, unique IDs)
- Category organization
- Secret field detection
- getBuiltInTemplate and isBuiltInTemplateId helpers

#### templateStorage.test.ts

- loadTemplateData / saveTemplateData
- Custom template CRUD (create, read, update, delete)
- Usage tracking (record, stats, sorting)
- Storage capacity checking
- Migration utilities (Phase 3):
  - hasLocalTemplates / needsMigration
  - isMigrationCompleted / markMigrationCompleted
  - prepareSyncRequest
  - clearLocalTemplatesAfterMigration

#### templateExport.test.ts

- Export encryption
- File format validation
- Import with password verification
- Conflict handling strategies (skip, replace, keep-both)
- Round-trip export/import data integrity

## Test Naming Conventions

### Python

```python
def test_function_name_should_expected_behavior_when_condition():
    pass

# Example
def test_create_user_should_return_user_when_valid_email():
    pass
```

### TypeScript

```typescript
describe('ComponentName', () => {
  it('should expected behavior when condition', () => {
    // ...
  });
});

// Example
describe('templateStorage', () => {
  it('should create a custom template', () => {
    // ...
  });
});
```

## Mocking Guidelines

### Frontend

- **localStorage**: Mocked in `setup.ts` with in-memory store
- **crypto.randomUUID**: Polyfilled for Node.js environment
- **URL.createObjectURL**: Mocked for blob URL creation

### Backend

- **Database**: Use test database with fixtures
- **External APIs**: Mock with pytest-mock or responses library

## CI/CD Integration

- Tests run automatically on:
  - [x] Pull requests
  - [x] Main branch commits
  - [ ] Scheduled (nightly)

## Coverage Requirements

| Layer | Target | Enforcement |
|-------|--------|-------------|
| Domain/Core | 90% | Required |
| Application/Service | 80% | Required |
| Infrastructure | 60% | Recommended |
| UI Components | 50% | Recommended |

---

*Last updated: 2025-02-05*
