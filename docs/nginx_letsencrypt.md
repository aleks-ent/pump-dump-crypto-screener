# Nginx + Let's Encrypt Setup

This setup exposes the screener at `https://screener.itnomad.space` with nginx and
Let's Encrypt. The Node app does not handle TLS and does not bind public ports; it
listens locally on `127.0.0.1:3000`.

## 1. Point DNS at the server

Create or update an `A` record:

```text
screener.itnomad.space -> <server IPv4 address>
```

If the server has IPv6, add an `AAAA` record too. If it does not, remove any stale
`AAAA` record for this hostname. Wait until DNS resolves from the server:

```bash
dig +short A screener.itnomad.space
dig +short AAAA screener.itnomad.space
```

## 2. Configure the app for localhost

In `config.js`:

```javascript
web: {
  port: 3000,
  host: "127.0.0.1",
},
```

Deploy and restart PM2:

```bash
./update.sh
pm2 status
pm2 logs pump-web
curl -i http://127.0.0.1:3000/healthz
```

The health check should return `200 OK` with `ok`.

## 3. Install nginx and Certbot

Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install -y nginx snapd
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

Open HTTP/HTTPS in the firewall if UFW is enabled:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw status
```

Also open inbound TCP `80` and `443` in your hosting provider firewall/security
group. UFW only controls the server itself; many VPS providers also have a separate
cloud firewall panel.

## 4. Add the nginx reverse proxy

Create `/etc/nginx/sites-available/pump-screener`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name screener.itnomad.space;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it:

```bash
sudo ln -sf /etc/nginx/sites-available/pump-screener /etc/nginx/sites-enabled/pump-screener
sudo nginx -t
sudo systemctl reload nginx
```

Before running Certbot, confirm nginx is reachable locally and publicly:

```bash
sudo ss -ltnp | grep ':80'
curl -I http://127.0.0.1
curl -I http://screener.itnomad.space
```

## 5. Issue the Let's Encrypt certificate

Do not run Certbot until `curl -I http://screener.itnomad.space` returns an HTTP
response. If it times out, Let's Encrypt will time out too.

```bash
sudo certbot --nginx -d screener.itnomad.space --redirect
```

Follow the prompts and enter your email address. Certbot will update nginx with the
TLS server block and HTTP-to-HTTPS redirect.

Verify renewal:

```bash
sudo certbot renew --dry-run
```

## 6. Useful checks

```bash
pm2 status
pm2 logs pump-web
curl -i http://127.0.0.1:3000/healthz
sudo nginx -t
sudo systemctl status nginx
sudo certbot certificates
```

If the public site times out, check DNS, cloud firewall/security-group rules, and
that ports `80` and `443` are reachable from the internet. If nginx returns `502 Bad
Gateway`, check `pm2 logs pump-web` and the local health check.

For a Certbot error like `Timeout during connect`, use this order:

```bash
dig +short screener.itnomad.space
curl -4 ifconfig.me
sudo systemctl status nginx --no-pager
sudo ss -ltnp | grep ':80'
curl -I http://127.0.0.1
curl -I http://screener.itnomad.space
sudo ufw status verbose
```

The DNS `A` record must match the server's public IP. If localhost works but the
domain times out, open inbound TCP `80` in the provider firewall and any server
firewall, then retry Certbot.

References:

- Certbot nginx instructions: <https://certbot.eff.org/instructions?os=snap&ws=nginx>
- NGINX reverse proxy docs: <https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/>
