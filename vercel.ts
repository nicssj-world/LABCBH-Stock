// Vercel project configuration. Secrets and project linkage remain in Vercel,
// never in this repository.
const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: 'nextjs',
  fluid: true,
  /*
  Run beside the database, not beside the user.

  Both Supabase projects live in AWS ap-southeast-2 (Sydney). Without this the
  functions defaulted to iad1 (Washington DC) — confirmed in production from
  `X-Vercel-Id: sin1::iad1::…`, where sin1 is only the edge the request entered
  through. Every query therefore crossed the Pacific twice, roughly 200ms each,
  and a page makes at least two in sequence: the actor, then its own reads.

  A page renders once for the user but queries the database several times, so
  the round trips to move are the database's. Bangkok reaches Sydney in about
  180ms against Singapore's 60ms, and that one extra leg buys back ~200ms on
  every query. Static assets keep coming from the nearest edge regardless.

  If the database is ever moved, this has to move with it.
  */
  regions: ['syd1'],
  crons: [
    {
      path: '/api/internal/storage-cleanup',
      schedule: '*/10 * * * *',
    },
  ],
} as const

export default config
