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

The image builds the project and runs `dist/index.js`, with arguments passed straight through. `KOTOBA_DIR` holds `output/`, `config.yaml` and `sources.yaml`, and the container mounts them, so the database and site persist between runs.

```bash
docker compose -f docker/compose.yaml up -d --build                  # start the daily scheduler
docker compose -f docker/compose.yaml logs -f
docker compose -f docker/compose.yaml run --rm kotoba                # run once now
docker compose -f docker/compose.yaml run --rm kotoba --publish      # upload to S3 or R2
docker compose -f docker/compose.yaml run --rm kotoba --word 食べる
```

The `kotoba-scheduler` container runs [supercronic](https://github.com/aptible/supercronic) on `docker/crontab`: the pipeline, then publish if it succeeded, daily at 05:00 in `TZ`. Edit the crontab and re-run `up -d --build` to change the schedule. A run missed while the container was down is not made up. `kotoba` is for one-off commands; don't run it while the scheduler is mid-run, since they share `kotoba.db`.

Two files configure it, and neither goes into the image:

- `.env` holds the app's keys. Set `TZ` here too (for example `TZ=America/Denver`). Output files are named by local date, and the container runs in UTC otherwise.
- `docker/.env` holds `KOTOBA_DIR`, an absolute path to a directory on the Docker host, and any `OLLAMA_HOST`, `OLLAMA_MODEL` or `OLLAMA_API_KEY` overrides. They go here, not in `.env`, because compose's `environment:` block overrides `env_file`. Translation defaults to an Ollama server on the Docker host (`http://host.docker.internal:11434`).

`KOTOBA_DIR` has no default on purpose. To run on the local Docker, point it at the repo (`KOTOBA_DIR=/path/to/kotoba-no-sekai`).

#### On a remote Docker host

Compose runs on your machine and talks to the host's Docker over ssh, so `.env` and `docker/.env` stay local. Copy `output/`, `config.yaml` and `sources.yaml` into `KOTOBA_DIR` on the host first, or the first run starts from an empty database:

```bash
export DOCKER_HOST=ssh://user@host
ssh user@host 'mkdir -p ~/kotoba-no-sekai'
rsync -rlt output/ user@host:kotoba-no-sekai/output/
rsync config.yaml sources.yaml user@host:kotoba-no-sekai/
docker compose -f docker/compose.yaml run --rm kotoba --dry-run     # writes nothing
```

The volumes carry `:z` so SELinux hosts such as Fedora CoreOS can read them. Other hosts ignore it. Run it from only one place: two copies of `output/kotoba.db` will teach the same words twice.
