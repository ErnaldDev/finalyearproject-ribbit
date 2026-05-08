import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)', 
  '/sign-up(.*)', 
  '/api/webhooks/clerk(.*)',
  "/api/webhooks(.*)",
  "/api/uploadthing(.*)",
  "/api/keepalive(.*)",
  '/',
  '/(.*)/(.*)', 
  '/(.*)' 
])

export default clerkMiddleware(async (auth, request) => {
  const { nextUrl } = request;
  const isPublic = isPublicRoute(request);
  
  if (isPublic) {
    return;
  }
  
  
  await auth.protect();
})

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
}
