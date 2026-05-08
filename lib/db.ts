import { PrismaClient } from '@prisma/client'

declare global {
  var prisma: PrismaClient | undefined
}

//this is the retry logic for the database
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 10000;

// Track database health status
let dbHealthStatus: 'healthy' | 'degraded' | 'unavailable' = 'healthy';
let lastFailedConnection: number = 0;
const DB_COOLDOWN_MS = 30000; // 30 seconds before retrying after failure

// Database keepalive/heartbeat system
let heartbeatInterval: NodeJS.Timeout | null = null;
let heartbeatStarted = false;
// Default to 4 minutes - Supabase idle timeout is typically hours, but we want to be safe
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.DB_HEARTBEAT_INTERVAL_MS || '240000', 10);

export function getDbHealthStatus() {
  return dbHealthStatus;
}

// Check if we should attempt connection (rate limit failed connections)
function shouldAttemptConnection(): boolean {
  if (dbHealthStatus === 'healthy') return true;
  
  const timeSinceFailure = Date.now() - lastFailedConnection;
  return timeSinceFailure > DB_COOLDOWN_MS;
}

// Update health status
function setDbHealthStatus(status: 'healthy' | 'degraded' | 'unavailable') {
  dbHealthStatus = status;
  if (status !== 'healthy') {
    lastFailedConnection = Date.now();
  }
}

// Creates modified connection URL with keepalive parameters to prevent idle timeout
function getConnectionUrlWithKeepalive(): string {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) return url;
  
  try {
    const urlObj = new URL(url);
    // Add connection parameters to prevent idle timeout
    // Keepalive settings to maintain connection with Supabase
    urlObj.searchParams.set('connect_timeout', '10');
    urlObj.searchParams.set('statement_timeout', '30000');
    
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

// Stop the heartbeat system
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    heartbeatStarted = false;
    console.log('[DB Heartbeat] Stopped database keepalive system');
  }
}

// Start the database heartbeat system to keep connection alive
// This is called after db is initialized to avoid reference errors
function startHeartbeat() {
  if (heartbeatStarted) return; // Already running
  heartbeatStarted = true;
  
  console.log(`[DB Heartbeat] Starting database keepalive system (interval: ${HEARTBEAT_INTERVAL_MS}ms)`);
  
  heartbeatInterval = setInterval(async () => {
    try {
      // Perform a lightweight query to keep connection alive
      await db.$queryRaw`SELECT 1`;
      
      // If health was degraded, restore it on successful heartbeat
      if (dbHealthStatus !== 'healthy') {
        console.log('[DB Heartbeat] Connection restored via heartbeat');
        setDbHealthStatus('healthy');
      }
    } catch (error: any) {
      console.warn('[DB Heartbeat] Failed to ping database:', error?.message?.substring(0, 100));
      // Don't immediately mark as unhealthy on heartbeat failure
      // The withRetry system will handle actual connection issues
    }
  }, HEARTBEAT_INTERVAL_MS);
}

//creates the prisma client with connection pool settings
const createPrismaClient = () => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    
    datasources: {
      db: {
        url: getConnectionUrlWithKeepalive(),
      },
    },
  });

  //this is the event listener for the database
  const clientWithEvents = client as unknown as {
    $on: (event: string, callback: (e: any) => void) => void;
  } & PrismaClient;

  
  clientWithEvents.$on('query', (e: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.log('Query: ' + e.query);
    }
  });

  clientWithEvents.$on('error', (e: any) => {
    console.error('Prisma Client error:', e);
    setDbHealthStatus('degraded');
  });

  return client;
};

// Helper to check if error is a connection error
function isConnectionError(error: any): boolean {
  const message = error?.message || '';
  return (
    message.includes("Can't reach database server") ||
    message.includes("Connection refused") ||
    message.includes("Connection terminated unexpectedly") ||
    message.includes("Connection timed out") ||
    message.includes("P1001") || // Can't reach database server
    message.includes("P1002") || // Connection timed out
    message.includes("P1003") || // Database does not exist
    message.includes("P1005") || // Query timeout
    message.includes("P1006") || // Connection pool exhausted
    message.includes("prisma-client") && message.includes("connection")
  );
}

// Calculate delay with exponential backoff and jitter
function getRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
    MAX_RETRY_DELAY_MS
  );
  // Add jitter (±25%) to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5);
  return Math.floor(exponentialDelay + jitter);
}

//this is the retry logic for the database with exponential backoff
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    onError?: (error: any, attempt: number) => void;
    fallbackValue?: T;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  let lastError: any;

  // Check if we should even attempt
  if (!shouldAttemptConnection() && dbHealthStatus === 'unavailable') {
    console.warn('Database unavailable - skipping connection attempt (cooldown active)');
    if (options.fallbackValue !== undefined) {
      return options.fallbackValue;
    }
    throw new Error('Database temporarily unavailable');
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      // Success - restore health status
      if (dbHealthStatus !== 'healthy') {
        console.log('Database connection restored');
        setDbHealthStatus('healthy');
      }
      return result;
    } catch (error: any) {
      lastError = error;
      options.onError?.(error, attempt);

      // Check if it's a connection error
      if (isConnectionError(error)) {
        const delay = getRetryDelay(attempt);
        console.warn(`Database connection attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms...`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Non-connection error - throw immediately (don't retry)
      throw error;
    }
  }

  // All retries exhausted - mark as unavailable
  console.error(`Failed to connect to database after ${maxRetries} attempts`);
  setDbHealthStatus('unavailable');
  
  if (options.fallbackValue !== undefined) {
    console.log('Returning fallback value due to database failure');
    return options.fallbackValue;
  }
  
  throw lastError;
}

// Database connection test function
export async function checkDbConnection(): Promise<boolean> {
  try {
    await withRetry(async () => {
      await db.$queryRaw`SELECT 1`;
    }, { maxRetries: 2 });
    return true;
  } catch {
    return false;
  }
}

export const db = globalThis.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalThis.prisma = db;

// Start heartbeat on initialization
startHeartbeat();

// Handle graceful shutdown
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => {
    console.log('[DB] SIGTERM received, stopping heartbeat');
    stopHeartbeat();
  });
  
  process.on('SIGINT', () => {
    console.log('[DB] SIGINT received, stopping heartbeat');
    stopHeartbeat();
  });
}
