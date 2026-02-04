# Tailscale Configuration

This directory contains Tailscale configuration for the Credential Vault.

## Setup Instructions

### 1. Generate Auth Key

1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)
2. Generate a new auth key with the following settings:
   - **Reusable**: Yes (for container restarts)
   - **Ephemeral**: No (persistent node)
   - **Tags**: `tag:credential-vault` (optional, for ACL)
3. Copy the key and add it to your `.env` file as `TS_AUTHKEY`

### 2. Configure serve.json

The `serve.json` file configures Tailscale Serve to expose:
- `/` → Frontend (React app)
- `/api` → Backend API (FastAPI)
- `/health` → Health check endpoint

**Note**: The `${TS_CERT_DOMAIN}` placeholder should be replaced with your actual Tailscale machine name + tailnet domain, e.g., `credential-vault.tail1234.ts.net`.

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
