# Deploying to a single server

The production stack is four containers run by Docker Compose: Postgres, a one-shot migration job,
the web app, and Caddy, which serves HTTPS and renews its own certificate. Only Caddy is reachable
from outside.

## What you need

- A Linux server with Docker and the Compose plugin. 1 GB of memory runs the stack; building the
  app image needs about 2 GB, so on a 1 GB machine add swap or build elsewhere.
- Ports 80 and 443 open to the internet.
- A name that resolves to the server. Without a domain, `<ip-with-dashes>.sslip.io` works
  (for example `203-0-113-7.sslip.io`).
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
# edit deploy/.env: DOMAIN, the three secrets, SMTP_URL, EMAIL_FROM
chmod 600 deploy/.env

docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Then open `https://<DOMAIN>`. The first request can take a few seconds while Caddy gets its
certificate.

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
docker compose -f deploy/docker-compose.yml --env-file deploy/.env ps      # web, postgres, caddy running; migrate exited 0
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs web
```
