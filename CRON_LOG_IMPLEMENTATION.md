# Cron Log Implementation

## Overview

Added comprehensive cron logging to track when cron jobs run and which mappings are executed during each run.

## Database Schema Changes

### New Models

#### `CronLog`
Tracks each cron job execution:
- `id`: Primary key
- `startedAt`: When the cron job started
- `completedAt`: When the cron job finished (null if still running)
- `status`: 'running', 'completed', or 'failed'
- `cadences`: Array of cadences that were active (daily, weekly, monthly)
- `dayOfWeek`: Day of week (0-6) when cron ran
- `dayOfMonth`: Day of month when cron ran
- `lastDayOfMonth`: Last day of the month (for monthly cadence)
- `mappingsFound`: Number of mappings found for sync
- `mappingsExecuted`: Number of mappings successfully executed
- `mappingsFailed`: Number of mappings that failed
- `errorMessage`: Error message if the entire cron run failed
- `mappings`: Relation to CronLogMapping entries

#### `CronLogMapping`
Tracks which mappings were executed in each cron run:
- `id`: Primary key
- `cronLogId`: Foreign key to CronLog
- `mappingId`: Foreign key to Mapping
- `status`: 'success', 'failed', or 'skipped'
- `errorMessage`: Error message if the mapping failed
- `createdAt`: Timestamp

### Updated Models

#### `Mapping`
- Added `cronLogMappings` relation to track cron execution history

## Implementation Details

### Sync API Updates (`pages/api/sync.ts`)

1. **Cron Log Creation**
   - Creates a `CronLog` entry when a cron job starts (GET request)
   - Initial status: 'running'
   - Records cadence information (dayOfWeek, dayOfMonth, lastDayOfMonth)
   - Records which cadences were active

2. **Mapping Execution Tracking**
   - Tracks success/failure status for each mapping
   - Creates `CronLogMapping` entries for each mapping processed
   - Updates counts: `mappingsExecuted` and `mappingsFailed`

3. **Completion Handling**
   - Updates `CronLog` with:
     - `status`: 'completed' or 'failed'
     - `completedAt`: Timestamp
     - Final counts of executed/failed mappings
   - Handles errors gracefully, ensuring cron log is updated even on failure

4. **Early Exit Handling**
   - If no mappings should sync (e.g., Sunday for daily cadence), still creates a log entry
   - Marks as 'completed' immediately with 0 mappings

### API Endpoint

#### `GET /api/cron-logs`
Retrieves cron log history with pagination:
- Query parameters:
  - `limit`: Number of logs to return (default: 50)
  - `offset`: Pagination offset (default: 0)
- Returns:
  - `logs`: Array of CronLog entries with related mappings
  - `total`: Total number of cron logs
  - `limit`: Current limit
  - `offset`: Current offset

**Example Response:**
```json
{
  "logs": [
    {
      "id": 1,
      "startedAt": "2024-01-15T04:00:00Z",
      "completedAt": "2024-01-15T04:02:30Z",
      "status": "completed",
      "cadences": ["daily"],
      "dayOfWeek": 1,
      "dayOfMonth": 15,
      "mappingsFound": 5,
      "mappingsExecuted": 4,
      "mappingsFailed": 1,
      "mappings": [
        {
          "id": 1,
          "mappingId": 1,
          "status": "success",
          "mapping": { ... }
        }
      ]
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

## Usage

### Viewing Cron Logs

```bash
# Get recent cron logs
GET /api/cron-logs?limit=10&offset=0
```

### Database Queries

```typescript
// Get all cron logs
const logs = await prisma.cronLog.findMany({
  orderBy: { startedAt: 'desc' },
  include: { mappings: true }
})

// Get failed cron runs
const failedLogs = await prisma.cronLog.findMany({
  where: { status: 'failed' },
  orderBy: { startedAt: 'desc' }
})

// Get mappings that failed in a specific cron run
const failedMappings = await prisma.cronLogMapping.findMany({
  where: {
    cronLogId: 1,
    status: 'failed'
  },
  include: { mapping: true }
})
```

## Benefits

1. **Audit Trail**: Complete history of when cron jobs ran
2. **Debugging**: Track which mappings failed and why
3. **Monitoring**: Monitor cron job health and success rates
4. **Analytics**: Analyze patterns in cron execution
5. **Troubleshooting**: Identify problematic mappings or time periods

## Migration

Run the following to apply the schema changes:

```bash
npx prisma db push
# or
npx prisma migrate dev --name add_cron_logs
```

Then regenerate the Prisma client:

```bash
npx prisma generate
```

## Notes

- Cron logs are automatically created for all cron executions (GET requests to `/api/sync`)
- Manual syncs (POST requests) do not create cron logs
- Cron logs persist even if the sync process fails
- The `CronLogMapping` table provides detailed tracking of individual mapping executions

