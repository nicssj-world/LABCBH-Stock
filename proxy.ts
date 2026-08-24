import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = new Set(['/login', '/access-denied', '/auth/confirm'])
const AUTH_BYPASS_PATHS = new Set(['/api/internal/storage-cleanup'])

function copyResponseState(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie))
  for (const [key, value] of source.headers.entries()) {
    if (key !== 'location') target.headers.set(key, value)
  }
  return target
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const path = request.nextUrl.pathname

  // Internal cron routes authenticate themselves with a service secret. They
  // must reach the route handler without a browser session so Vercel Cron can
  // invoke them, while the handler still rejects every missing/invalid secret.
  if (AUTH_BYPASS_PATHS.has(path)) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value)
          })
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const isAuthenticated = Boolean(data?.claims?.sub)

  if (!isAuthenticated && !PUBLIC_PATHS.has(path)) {
    const loginUrl = new URL('/login', request.url)
    return copyResponseState(response, NextResponse.redirect(loginUrl))
  }

  if (isAuthenticated && path === '/') {
    return copyResponseState(response, NextResponse.redirect(new URL('/dashboard', request.url)))
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)',
  ],
}
