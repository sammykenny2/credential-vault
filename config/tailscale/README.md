# Tailscale Configuration

This directory contains Tailscale configuration for the Credential Vault.

## Setup Instructions

### 1. Generate Auth Key

1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)
2. Generate a new auth key with the following settings:
   - **Reusable**: No (the node identity is kept in the tailscale_state volume)
   - **Ephemeral**: No (persistent node)
   - **Tags**: `tag:credential-vault` (optional, for ACL)
3. Copy the key and add it to your `.env.production` file as `TS_AUTHKEY`, and clear it after the first deploy.
   Or leave `TS_AUTHKEY` empty: the deploy script prints a login URL to approve the node in the browser.

### 2. Configure serve.json

The `serve.json` file configures Tailscale Serve to expose:
- `/` → Frontend nginx, which serves the React app and proxies `/api` and `/health` to the backend

Do not add `/api` or `/health` handlers that proxy straight to the backend: Tailscale Serve strips the mount path, so the backend would receive `/v1/...` and `/` and answer 404.

**Note**: Leave the `${TS_CERT_DOMAIN}` placeholder as it is; the Tailscale container substitutes the node's real HTTPS name at start. After editing `serve.json`, the deploy script restarts the sidecar so the change takes effect.

### 3. Access Control (ACL) - Recommended

Add these ACL rules to your Tailscale admin console for extra security:

```json
{
  "tagOwners": {
    "tag:credential-vault": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["autogroup:member"],
      "dst": ["tag:credential-vault:443"]
    }
  ]
}
```

This ensures only authenticated Tailscale users can access the vault.

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TS_AUTHKEY` | Tailscale auth key | `tskey-auth-xxx` |
| `TS_HOSTNAME` | Machine hostname on Tailscale | `credential-vault` |
| `TS_CERT_DOMAIN` | Full domain for HTTPS cert | `credential-vault.tail1234.ts.net` |

## Accessing the Vault

Once deployed:
1. Ensure your device is connected to Tailscale
2. Navigate to `https://credential-vault.your-tailnet.ts.net`
3. Complete MFA authentication
4. Access your credentials

## Troubleshooting

### Check Tailscale Status
```bash
docker-compose exec tailscale tailscale status
```

### View Tailscale Logs
```bash
docker-compose logs tailscale
```

### Verify HTTPS Certificate
```bash
docker-compose exec tailscale tailscale cert credential-vault.your-tailnet.ts.net
```
