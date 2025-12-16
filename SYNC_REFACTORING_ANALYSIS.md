# Sync.ts Refactoring Analysis

## Current State
The `sync.ts` file is 352 lines and handles multiple responsibilities:
- Request validation and authorization
- Cron log management
- Mapping query building
- Mapping processing orchestration
- Error handling

## Identified Service Extraction Opportunities

### 1. **Cron Log Service** (High Priority)
**Location**: Lines 56-100, 125-135, 254-297, 312-346

**Current Logic**:
- Creating cron log entries
- Updating cron log status
- Creating cron log mapping entries
- Error log creation

**Proposed Service**: `lib/services/cronLogService.ts`

**Functions to Extract**:
```typescript
- createCronLog(cadenceResult: CadenceFilterResult): Promise<number | null>
- updateCronLogMappingsFound(cronLogId: number, count: number): Promise<void>
- updateCronLogStatus(cronLogId: number, status: 'completed' | 'failed', data: {...}): Promise<void>
- createCronLogMapping(cronLogId: number, mappingId: number, status: 'success' | 'failed', error?: string): Promise<void>
- finalizeCronLog(cronLogId: number, mappingStatuses: Map<number, {...}>): Promise<void>
- createErrorCronLog(error: Error): Promise<number | null>
```

**Benefits**:
- Centralizes all cron log database operations
- Makes cron logging testable in isolation
- Reduces sync.ts by ~150 lines

---

### 2. **Mapping Sync Processor Service** (High Priority)
**Location**: Lines 150-251

**Current Logic**:
- Processing a single mapping (all channels)
- Fetching messages, generating summary, creating HubSpot note
- Error handling per mapping
- Result formatting

**Proposed Service**: `lib/services/mappingSyncService.ts`

**Functions to Extract**:
```typescript
- processMapping(
    mapping: Mapping,
    systemPrompt: string | undefined,
    userMap: Map<string, string>,
    isTestMode: boolean
): Promise<{
    success: boolean;
    error?: string;
    results: SyncResult[];
}>
```

**Benefits**:
- Isolates the core sync logic
- Makes mapping processing testable
- Can be reused for individual mapping syncs
- Reduces sync.ts by ~100 lines

---

### 3. **Mapping Query Service** (Medium Priority)
**Location**: Lines 103-122

**Current Logic**:
- Building where clause for mapping queries
- Fetching mappings with relations
- Cadence filtering logic

**Proposed Service**: `lib/services/mappingService.ts`

**Functions to Extract**:
```typescript
- buildMappingWhereClause(mappingId?: number, cadenceResult?: CadenceFilterResult): any
- fetchMappingsForSync(mappingId?: number, cadenceResult?: CadenceFilterResult): Promise<Mapping[]>
```

**Benefits**:
- Centralizes mapping query logic
- Makes query building testable
- Reduces sync.ts by ~20 lines

---

### 4. **Prompt Service** (Low Priority)
**Location**: Lines 141-145

**Current Logic**:
- Fetching active prompt

**Proposed Service**: `lib/services/promptService.ts`

**Functions to Extract**:
```typescript
- getActivePrompt(): Promise<string | undefined>
```

**Benefits**:
- Centralizes prompt fetching
- Makes prompt logic testable
- Small but consistent with service pattern

---

### 5. **Cron Authorization Service** (Medium Priority)
**Location**: Lines 16-39

**Current Logic**:
- Validating cron authorization
- Checking Vercel cron headers
- CRON_SECRET validation

**Proposed Service**: `lib/services/cronAuthService.ts` or middleware

**Functions to Extract**:
```typescript
- validateCronRequest(req: NextApiRequest): { isValid: boolean; isVercelCron: boolean; error?: string }
```

**Benefits**:
- Separates authorization logic
- Makes auth logic testable
- Can be reused for other cron endpoints

---

## Recommended Refactoring Order

### Phase 1: Cron Log Service (Highest Impact)
1. Create `lib/services/cronLogService.ts`
2. Extract all cron log operations
3. Update `sync.ts` to use the service
4. **Impact**: Reduces sync.ts by ~150 lines, improves testability

### Phase 2: Mapping Sync Processor (High Impact)
1. Create `lib/services/mappingSyncService.ts`
2. Extract mapping processing logic
3. Update `sync.ts` to use the service
4. **Impact**: Reduces sync.ts by ~100 lines, improves testability

### Phase 3: Supporting Services (Medium Impact)
1. Create `lib/services/mappingService.ts`
2. Create `lib/services/promptService.ts`
3. Create `lib/services/cronAuthService.ts`
4. **Impact**: Further reduces sync.ts, improves organization

## Expected Results

**Before**: 352 lines, multiple responsibilities
**After**: ~100-150 lines, orchestration only

**Benefits**:
- ✅ Better testability (each service can be tested independently)
- ✅ Improved maintainability (single responsibility per service)
- ✅ Reusability (services can be used in other contexts)
- ✅ Easier debugging (isolated concerns)
- ✅ Better error handling (service-specific error handling)

## Implementation Notes

1. **Error Handling**: Each service should handle its own errors and throw appropriate exceptions
2. **Logging**: Services should maintain their own logging for better traceability
3. **Type Safety**: Create proper TypeScript interfaces for all service inputs/outputs
4. **Testing**: Each service should have comprehensive unit tests

