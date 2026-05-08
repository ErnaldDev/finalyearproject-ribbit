import { checkDbConnection } from '@/lib/db'

export async function GET() {
  try {
    // Use the existing connection check function which has retry logic
    const isConnected = await checkDbConnection()
    
    if (isConnected) {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    } else {
      return new Response(
        JSON.stringify({ status: 'degraded', timestamp: new Date().toISOString() }),
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
  } catch (error: any) {
    console.error('[Keepalive] Error:', error?.message?.substring(0, 200))
    return new Response(
      JSON.stringify({ status: 'error', timestamp: new Date().toISOString() }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}
