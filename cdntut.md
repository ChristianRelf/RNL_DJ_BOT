# DigitalOcean Spaces CDN setup for Deck

This guide connects Deck to a DigitalOcean Space so browsers can upload music
directly to object storage. Music does not pass through or remain on the
Droplet's disk.

Deck supports two modes:

| Mode | Access | CDN caching | Recommended for |
| --- | --- | --- | --- |
| Private Spaces | One-hour signed download links | No | Private or licensed libraries |
| Public CDN | Opaque public object URLs | Yes | Material safe to expose to anyone with the URL |

Start with **Private Spaces**. Only enable public CDN mode after accepting that
anyone who obtains an object URL can download that object.

## 1. Create the Space

1. Sign in to the DigitalOcean control panel.
2. Open **Spaces Object Storage**.
3. Select **Create a Space**.
4. Choose **Standard Storage**, not Cold Storage.
5. Choose the same region as the Droplet where possible.
6. Give the Space a DNS-safe name without periods, for example `rnl-deck-media`.
7. Leave file listing and default file permissions private.

Record these values:

```text
Space name:  rnl-deck-media
Region:      lon1
Endpoint:    https://lon1.digitaloceanspaces.com
```

Replace the examples in this guide with the values shown by DigitalOcean.

## 2. Create an access key

1. In DigitalOcean, open **API** and then **Spaces Keys**.
2. Create a new access key for Deck.
3. Restrict the key to the Deck Space if the control panel offers that option.
4. Copy both the access-key ID and secret immediately.

The secret is shown once. Do not put it in Git, browser code, Discord, or a
public support message. It belongs only in the Droplet's `.env` file.

## 3. Configure CORS

Browsers upload straight to Spaces, so the Space must allow requests from the
exact Deck origin.

The repository includes [deploy/spaces-cors.xml](deploy/spaces-cors.xml). Check
that it contains the production origin:

```xml
<AllowedOrigin>https://deck.ronation.live</AllowedOrigin>
```

Do not use `*` for the origin. If Deck uses another hostname, replace the value
with that exact HTTPS origin, without a trailing slash.

Install and configure `s3cmd` on an administrative machine:

```sh
s3cmd --configure
s3cmd setcors deploy/spaces-cors.xml s3://rnl-deck-media
s3cmd info s3://rnl-deck-media
```

Alternatively, configure the same CORS rule from the Space's **Settings** tab
in the DigitalOcean control panel. Allow these methods:

```text
GET
HEAD
PUT
```

Allow all request headers, expose `ETag`, and set the cache duration to 3600
seconds.

## 4. Configure Deck in private mode

Open the production `.env` file beside `docker-compose.yml` on the Droplet and
add:

```dotenv
SPACES_ENDPOINT=https://lon1.digitaloceanspaces.com
SPACES_REGION=lon1
SPACES_BUCKET=rnl-deck-media
SPACES_ACCESS_KEY_ID=replace-with-access-key-id
SPACES_SECRET_ACCESS_KEY=replace-with-secret-access-key

SPACES_CDN_URL=
SPACES_PUBLIC_CDN=false
SPACES_MAX_OBJECT_MB=500
SPACES_GUILD_LIMIT_GB=1
```

All five connection settings are required together. Deck refuses to start if
Spaces is only partly configured, which prevents a broken production setup from
appearing healthy.

In private mode:

- Browser uploads use 15-minute signed PUT URLs.
- Playback/download links expire after one hour.
- Objects remain private.
- DigitalOcean's CDN does not cache the signed downloads.

## 5. Restart Deck

From the directory containing `docker-compose.yml`:

```sh
docker compose build
docker compose up -d
docker compose logs --tail=100 dj
```

Do not print the `.env` file or run commands that echo its contents into logs.

Check the health endpoint:

```sh
curl -s https://deck.ronation.live/api/health
```

The response should include:

```json
"spaces": {
  "enabled": true,
  "cdn": false
}
```

If the container restarts repeatedly, inspect its logs. The most common causes
are a missing variable, an endpoint for the wrong region, or whitespace copied
into a key.

## 6. Test private uploads

After signing in to a rig:

1. Request an upload through Deck's cloud-media API or cloud-library interface.
2. Confirm the browser sends the file directly to a
   `digitaloceanspaces.com` URL.
3. Confirm no large request is sent to the Droplet.
4. Open the Space in DigitalOcean and look under:

   ```text
   rigs/<discord-guild-id>/<random-object-id>.<extension>
   ```

5. Confirm opening the object URL without a signed query string is denied.
6. Confirm `/api/g/<guild-id>/cloud` lists the object as `ready` after upload.

If the browser reports a CORS error, verify that the allowed origin exactly
matches the address in the browser, including `https` and any subdomain.

## 7. Enable the real CDN mode (optional)

Private presigned requests are forwarded to the Spaces origin and are not CDN
cached. For actual edge caching, Deck must create public-read objects with
unguessable paths.

### Enable the Spaces CDN

1. Open the Space in DigitalOcean.
2. Open **Settings**.
3. Enable the CDN.
4. Record the generated endpoint, usually:

   ```text
   https://rnl-deck-media.lon1.cdn.digitaloceanspaces.com
   ```

### Optional custom hostname

For a hostname such as `media.deck.ronation.live`:

1. Add the custom CDN endpoint in DigitalOcean.
2. Create the DNS record DigitalOcean requests.
3. Attach a DigitalOcean-managed TLS certificate.
4. Wait for DNS and certificate provisioning to complete.
5. Test the hostname over HTTPS before placing it in Deck's configuration.

### Switch Deck to public CDN mode

Update `.env`:

```dotenv
SPACES_CDN_URL=https://media.deck.ronation.live
SPACES_PUBLIC_CDN=true
```

Then restart:

```sh
docker compose up -d --build
```

The health response should now show:

```json
"spaces": {
  "enabled": true,
  "cdn": true
}
```

New objects are uploaded with `public-read` access. Existing private objects do
not become public automatically; upload them again or deliberately update their
ACLs using an S3-compatible tool.

## 8. Cache headers

Deck uses immutable UUID-based object names, so a changed track should be a new
object rather than an overwrite. For public CDN objects, use a long cache policy
such as:

```text
Cache-Control: public, max-age=31536000, immutable
```

The current upload adapter can be extended to set this header when public CDN
mode is enabled. Do not use a year-long cache policy for an object key that will
be overwritten.

When removing public objects, delete the object from Spaces. If an edge still
serves a cached response, purge that path from the DigitalOcean CDN control
panel or API.

## 9. Security checklist

- Keep the Space's file listing private.
- Keep access keys only in the Droplet's `.env` file.
- Never send a Spaces secret to the browser; Deck sends presigned URLs instead.
- Use a dedicated Spaces key rather than a general DigitalOcean API token.
- Restrict CORS to the exact Deck origin.
- Keep `SPACES_PUBLIC_CDN=false` for licensed or access-controlled music.
- Treat a public CDN URL as a bearer link: anybody holding it can retrieve it.
- Rotate the Spaces key immediately if it is exposed.
- Test deletion with a disposable object before relying on it operationally.
- Back up the Deck database; Spaces does not include an automatic backup of its
  object catalogue or Deck's metadata.

## 10. Key rotation

To rotate credentials without losing objects:

1. Create a second Spaces key.
2. Replace the two key values in `.env`.
3. Restart Deck and test an upload and download.
4. Revoke the old key in DigitalOcean.

Object URLs and metadata do not change when credentials rotate.

## 11. Disable Spaces safely

To return to browser-only libraries:

1. Stop new cloud uploads.
2. Back up or deliberately delete any objects that must not remain.
3. Clear all `SPACES_*` connection values in `.env`.
4. Set `SPACES_PUBLIC_CDN=false`.
5. Restart Deck.
6. Confirm `/api/health` reports `"enabled": false`.

Removing configuration does not delete existing objects. Destroy the Space only
after confirming that nothing still depends on it.

## Reference

- [DigitalOcean Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/)
- [Configure Spaces CORS](https://docs.digitalocean.com/products/spaces/how-to/configure-cors/)
- [Enable the Spaces CDN](https://docs.digitalocean.com/products/spaces/how-to/customize-cdn-endpoint/)
- [Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing/)
- [Spaces limits](https://docs.digitalocean.com/products/spaces/details/limits/)
