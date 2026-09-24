# Publishing

The site is plain files in `output/web/`, so any static host works. `--publish` uploads it to AWS S3 or Cloudflare R2 for you.

## `--publish`

```bash
npm start -- --publish
```

It compares MD5 checksums and uploads only new or changed files. Files deleted locally are deleted from the bucket too, so anything you upload by hand to the same bucket (or prefix) will be removed on the next publish. If `CLOUDFRONT_DISTRIBUTION_ID` is set, it clears the CloudFront cache afterwards.

Set it up in `config.yaml`:

```yaml
publish:
  provider: s3        # or r2
  s3:
    bucket: my-kotoba-bucket
    region: us-east-1
    # prefix: kotoba  # optional folder inside the bucket
  r2:
    bucket: my-kotoba-bucket
    account_id: your-cloudflare-account-id
```

**S3** reads credentials from `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`, or an IAM role.

**R2** reads `CLOUDFLARE_R2_ACCESS_KEY_ID` and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. Turn on public access for the bucket to get a free `https://pub-<hash>.r2.dev` address.

## AWS hosting template

`cloudformation.yaml` creates everything needed to serve the site over HTTPS:

- a private S3 bucket, readable only by CloudFront
- a CloudFront distribution in front of it, which maps missing pages to a 404
- optionally, a certificate and a Route 53 record for your own domain
- an IAM user, with an access key, that can only write to that bucket and clear CloudFront caches

Deploy it in **us-east-1** (CloudFront certificates must live there), with `BucketName`, and optionally `CustomDomain` and `HostedZoneId`. The stack outputs give you the site URL, the bucket name for `config.yaml`, and the distribution ID for `.env`.

## Running it every day

### Windows Task Scheduler

`run-and-publish.ps1` builds, runs the pipeline, and publishes, logging to `logs/kotoba-YYYY-MM-DD.log`. It stops before publishing if the build or the run fails. Point a daily scheduled task at it:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\path\to\kotoba-no-sekai\run-and-publish.ps1
```

Edit `$ProjectDir` at the top of the script to match where the repo lives.

### cron

```cron
0 6 * * * cd /path/to/kotoba-no-sekai && npm run build && npm start && npm start -- --publish
```

### Docker

The image builds the project and runs `dist/index.js`, with arguments passed straight through. `output/`, `config.yaml` and `sources.yaml` are mounted from the repo, so the database and site persist between runs.

```bash
docker compose -f docker/compose.yaml run --rm kotoba                # daily run
docker compose -f docker/compose.yaml run --rm kotoba --publish      # upload to S3 or R2
docker compose -f docker/compose.yaml run --rm kotoba --word 食べる
```

Keys come from `.env`. Translation defaults to an Ollama server on the Docker host (`http://host.docker.internal:11434`); set `OLLAMA_HOST`, `OLLAMA_MODEL` or `OLLAMA_API_KEY` to point it elsewhere.
