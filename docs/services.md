# Service Registry

> This file documents all services in this project that listen on network ports.
> Keeping this up to date helps avoid port conflicts and makes onboarding easier.

## Services

| Service Name | Port | Protocol | Description | Start Command |
|--------------|------|----------|-------------|---------------|
| Backend API | 8000 | TCP | FastAPI via uvicorn. In Docker it is reachable only on the `vault-internal` network; no host port is published. | `uvicorn app.main:app --reload` (local) / `docker compose up backend` |
| Frontend dev server | 3000 | TCP | Vite dev server; proxies `/api` to `http://localhost:8000` (`frontend/vite.config.ts`). | `cd frontend && npm run dev` |
| Frontend (nginx) | 80 | TCP | Serves the built SPA and proxies `/api` to `backend:8000` (`frontend/nginx.conf`). Container-internal only. | `docker compose up frontend` |
| Tailscale Serve | 443 | TCP/HTTPS | Tailnet-only HTTPS entry point. Routes `/` to `frontend:80`, `/api` and `/health` to `backend:8000` (`config/tailscale/serve.json`). | `docker compose up tailscale` |

No service publishes a port to the Docker host; the only external entry is the Tailscale sidecar on the tailnet.

The Docker services are deployed together with `scripts/windows/Deploy-CredentialVault.ps1` (or `docker compose --env-file .env.production up -d --build` on other hosts); the per-service commands above are for debugging.

## Environment Variables

Port numbers should be configurable via environment variables so developers can override defaults when needed.

| Variable | Default | Service | Notes |
|----------|---------|---------|-------|
| (none yet) | | | Ports are currently fixed in `Dockerfile` (uvicorn `--port 8000`), `frontend/vite.config.ts` (`server.port: 3000`), `frontend/nginx.conf` (`listen 80`) and `config/tailscale/serve.json` (`443`). Introduce `API_PORT` / `WEB_PORT` when a conflict appears. |

Related non-port variables live in `.env.production.example` (`TS_HOSTNAME`, `TS_CERT_DOMAIN`, `REQUIRE_TAILSCALE`).

## Cross-Project Port Coordination

This project was created from **project-bootstrap**, which maintains a central port registry at:

```
<bootstrap-project>/docs/port-registry.md
```

**For AI agents**: When adding or changing a service port in this project:

1. **MUST** update the **Services** table above
2. **SHOULD** check the bootstrap project's `docs/port-registry.md` for conflicts with other projects
3. **SHOULD** register the new port in the bootstrap project's `docs/port-registry.md`
4. **MUST** warn the user if a port conflict is detected

---

*Last updated: 2026-10-23*
