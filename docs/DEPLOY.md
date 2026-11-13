# Deploying to a single server

The production stack is six containers run by Docker Compose: Postgres, a one-shot migration job,
the web app, the OAuth server, the MCP server, and Caddy, which serves HTTPS and renews its own
certificates. Only Caddy is reachable from outside. It serves the website at `DOMAIN` and the
endpoint AI apps connect to at `mcp.DOMAIN`.

## What you need

- A Linux server with Docker and the Compose plugin. 1 GB of memory runs the stack; building the
  app image needs about 2 GB, so on a 1 GB machine add swap or build elsewhere.
- Ports 80 and 443 open to the internet.
- A name that resolves to the server, and `mcp.` in front of that name resolving to it too.
  Without a domain, `<ip-with-dashes>.sslip.io` works (for example `203-0-113-7.sslip.io`), and
  `mcp.203-0-113-7.sslip.io` then resolves with no extra setup.
- An SMTP account for sending email. Sign-up cannot complete without it, because new users must
  confirm their address.

## Oracle Cloud specifics

Oracle blocks ports in two places, and both must allow 80 and 443:

1. **In the Oracle console:** Networking → Virtual cloud networks → your VCN → Security Lists →
   add ingress rules for TCP 80 and TCP 443 from `0.0.0.0/0`.
2. **On the server itself:** Oracle's Ubuntu images ship with iptables rules that reject everything
   but SSH.

   ```sh
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## First deploy

```sh
git clone https://github.com/Isaackjoshua/FinPlan.git && cd FinPlan
cp deploy/.env.example deploy/.env
# edit deploy/.env: DOMAIN, the four secrets, SMTP_URL, EMAIL_FROM
chmod 600 deploy/.env

docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Then open `https://<DOMAIN>`. The first request can take a few seconds while Caddy gets its
certificate.

To connect an AI app, give it the address `https://mcp.<DOMAIN>/mcp`. The app sends you to the
website to sign in and choose what it may do.

## Updating

```sh
git pull
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Migrations run automatically before the new app version starts.

## Backups

Two things must be kept, **separately from each other**:

- **The database.** For example, nightly:

  ```sh
  docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres \
    pg_dump -U finplan finplan | gzip > finplan-$(date +%F).sql.gz
  ```

- **`DATA_MASTER_KEY` from `deploy/.env`.** A database backup is unreadable without it, and
  there is no way to recover it. Keep it in a password manager, not next to the backups: anyone
  holding both can read everything.

## Checking it works

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps      # web, auth, mcp, postgres, caddy running; migrate exited 0
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs web
```

```sh
curl -i https://mcp.<DOMAIN>/mcp -X POST -d '{}'    # expect 401 with a WWW-Authenticate header
curl https://<DOMAIN>/.well-known/oauth-authorization-server    # expect JSON naming https://<DOMAIN>
```
