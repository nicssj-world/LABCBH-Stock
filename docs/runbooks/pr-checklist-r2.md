# Cloudflare R2 for PR checklist files

The PR checklist uses a private Cloudflare R2 bucket. Supabase remains the
source of truth for upload tickets, attachment metadata, committee rosters,
and deletion audit events. Browser uploads use a five-minute presigned PUT;
R2 credentials remain server-only.

## Required environment variables

Configure these independently for Preview/Staging and Production:

```text
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

Create an R2 API token with Object Read & Write access limited to this bucket.
Do not enable a public development URL or copy credentials from another app.

## Bucket CORS

Add every real application origin and the local development origin. Keep the
allowed method and headers narrow because uploads are signed for an exact key,
content type, and `If-None-Match: *`.

```json
[
  {
    "AllowedOrigins": [
      "https://stock.example.go.th",
      "https://stock-staging.example.go.th",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace the example domains with the deployed domains. Do not add a blanket
R2 lifecycle expiration for `labcbh-stock/pr-checklists/uploads/`: active and
expired checklist objects share that namespace, and the application performs
the required lifecycle hard deletes while retaining audit metadata in
Supabase.

## Deployment order

1. Apply the reviewed forward migrations to the target Supabase environment.
2. Create/configure the private R2 bucket and CORS policy.
3. Add the four server-only R2 environment variables to the deployment.
4. Deploy the application and verify one upload, inline preview, Download all,
   committee PDF, and lifecycle deletion in Staging before Production.
