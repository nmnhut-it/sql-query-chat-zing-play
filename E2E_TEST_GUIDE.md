# E2E Test Guide

## Overview

End-to-End tests that use real CSV files and real AI API calls to verify the complete workflow.

## What Gets Tested

1. **CSV Loading** - Load actual CSV files into DuckDB
2. **Schema Extraction** - Extract table structure, columns, types, samples, stats
3. **AI API Calls** - Make real calls to OpenAI-compatible API
4. **SQL Generation** - AI generates SQL from natural language
5. **Query Execution** - Execute generated SQL against real data
6. **Result Validation** - Verify query results are correct

## Prerequisites

### 1. API Configuration

Create or verify `.env` file exists with:

```env
VITE_OPENAI_API_KEY=your_api_key_here
VITE_OPENAI_BASE_URL=https://api.openai.com/v1/chat/completions
VITE_OPENAI_MODEL=gpt-4o-mini
```

**Note**: Tests will be **skipped** if `VITE_OPENAI_API_KEY` is not set.

### 2. Test Data Files

CSV files are located in `test-data/`:

- `user_events.csv` - User activity events (15 rows)
- `sales_data.csv` - Sales transactions (10 rows)

## Running Tests

### Run All Tests (Unit + Integration + E2E)

```bash
npm test
```

### Run Only E2E Tests (with real AI API)

```bash
npm run test:e2e
```

### Run Only Unit/Integration Tests (no API calls)

```bash
npm run test:unit
```

### Watch Mode

```bash
npm run test:watch
```

## Test Scenarios

### Scenario 1: User Events CSV

**Tests:**
1. Load CSV into DuckDB
2. Extract schema with columns (user_id, timestamp, action, page_url, session_id)
3. Ask AI: "how many events are there?"
4. Ask AI: "count events by user"
5. Ask AI: "query number of date group by user" (the original bug scenario)

**Expected Behavior:**
- ✅ AI should NOT ask for clarification
- ✅ AI should use actual table name: `user_events`
- ✅ AI should use actual column names: `user_id`, `timestamp`
- ✅ SQL should execute successfully
- ✅ Results should contain data

### Scenario 2: Sales Data CSV

**Tests:**
1. Load CSV into DuckDB
2. Extract schema with columns (order_id, customer_id, order_date, product_name, quantity, price, total)
3. Ask AI: "what is the total revenue by customer?"
4. Ask AI: "show daily revenue"

**Expected Behavior:**
- ✅ AI generates SQL with SUM, GROUP BY
- ✅ AI uses correct column names from schema
- ✅ Queries execute and return results

## Test Output

### Successful Run

```
🚀 Initializing DuckDB for E2E tests...
📊 Schema extracted: {...}
🤖 Asking AI: how many events are there?
📝 AI Response: SELECT COUNT(*) FROM user_events
⚡ Executing SQL: SELECT COUNT(*) FROM user_events
✅ Result: { columns: ['count'], rows: [{ count: 15 }] }

✓ src/e2e/ai-with-real-data.test.ts (10 tests) 45s
  ✓ E2E: AI with Real CSV Data
    ✓ Scenario: User Events CSV
      ✓ should load CSV into DuckDB and extract schema
      ✓ should have sample data in schema
      ✓ should call real AI and generate SQL for count query
      ✓ should call real AI and generate SQL for group by query
      ✓ should execute AI-generated SQL and get results
      ✓ should handle the original bug scenario: group by date and user
    ✓ Scenario: Sales Data CSV
      ✓ should load sales CSV and extract schema
      ✓ should generate SQL for sales aggregation
      ✓ should generate SQL for date-based grouping

Test Files  1 passed (1)
Tests       10 passed (10)
Duration    45.2s
```

### Skipped (No API Key)

```
⚠️  Skipping E2E tests: VITE_OPENAI_API_KEY not set in .env

Test Files  1 skipped (1)
Tests       10 skipped (10)
```

## Cost Considerations

**API Usage:**
- Each E2E test scenario makes 3-5 API calls
- Total: ~10 API calls per full E2E test run
- Cost: Minimal with gpt-4o-mini (~$0.01 per test run)

**Recommendation:**
- Run E2E tests before major releases
- Use unit/integration tests for rapid development
- CI/CD can skip E2E tests or run on schedule

## Troubleshooting

### Tests Timeout

Increase timeout in `vitest.config.ts`:

```typescript
testTimeout: 60000, // 60 seconds
```

### API Errors

Check:
1. `.env` file exists and has correct API key
2. API endpoint is accessible
3. API key has sufficient credits/quota
4. Network connection is stable

### CSV Loading Fails

Ensure test CSV files exist:
```bash
ls test-data/
# Should show:
# user_events.csv
# sales_data.csv
```

## What Makes These Tests Valuable

1. **Real Integration** - Tests actual DuckDB + AI API integration
2. **Bug Verification** - Proves the schema loading fix works end-to-end
3. **Regression Prevention** - Catches if schema stops populating
4. **Real AI Responses** - Validates AI prompt engineering works
5. **Data Quality** - Verifies CSV loading and schema extraction
6. **SQL Execution** - Confirms generated SQL is valid DuckDB syntax

## Comparison with Other Test Types

| Test Type | Speed | Cost | Coverage | Use Case |
|-----------|-------|------|----------|----------|
| Unit Tests | ⚡ Fast | Free | Schema formatting | Development |
| Integration Tests | ⚡ Fast | Free | AI prompt logic | Development |
| E2E Tests | 🐢 Slow | 💰 Paid | Full workflow | Pre-release |

## Next Steps

After E2E tests pass:

1. ✅ Schema loading is verified with real data
2. ✅ AI can see and use table/column names
3. ✅ Generated SQL executes successfully
4. 🚀 Ready to deploy to production

The original bug ("I don't see any tables") is **proven fixed** by these E2E tests.
