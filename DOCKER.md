# Run Quick Vote with Docker or Podman

This guide runs Quick Vote on a computer that you control, with **no Cloudflare account**. It suits a school, a club or a company that wants one vote across many rooms on its own network.

One container serves the site and the voting centre together. It keeps its data in a SQLite file on a volume.

## Which setup should I use?

| | Docker or Podman (this guide) | Cloudflare ([INSTALLING.md](INSTALLING.md)) |
|---|---|---|
| Good for | A school or an organisation with its own server or network | A public site that anyone can reach, with no server to look after |
| You need | A computer that stays on, and Docker or Podman | A Cloudflare account and a place for the site (for example GitHub Pages) |
| Where the data is | In a file on your machine | In your Cloudflare account |
| Reachable from | Your network, or the internet if you choose | The internet |
| Upkeep | You: updates, backups, HTTPS | Cloudflare |

## Quick start

You need [Docker](https://docs.docker.com/get-docker/) or [Podman](https://podman.io/docs/installation), and `git`.

```sh
git clone https://github.com/mieslep/quick-vote.git
cd quick-vote
docker build -t quick-vote .
docker run -d --name quick-vote \
  -p 8080:8080 \
  -e CREATE_CODE='<a long random string>' \
  -v quick-vote-data:/data \
  --restart unless-stopped \
  quick-vote
```

With Podman, use the same commands and write `podman` in place of `docker`.

Open `http://localhost:8080`. Click **Make a multi-booth poll**. There is no Connect page to fill in: the site finds the server by its own address. Enter the organiser code when the form asks for it.

To make a good organiser code, run `openssl rand -base64 24`. Keep it in a password manager.

## Docker Compose (or Podman Compose)

1. Make a file named `.env` next to `compose.yaml`, with this line:

   ```
   CREATE_CODE=<a long random string>
   ```
2. Start it:

   ```sh
   docker compose up -d        # or: podman compose up -d
   ```

Git ignores `.env` files. Never commit one.

## Run it without a container

You need Node.js **22.13 or newer**. The server has no packages to install.

```sh
CREATE_CODE='<a long random string>' npm start
```

It listens on port 8080 and keeps its data in `./data`.

## A school-wide vote, step by step

1. Run the container on a computer that all the classrooms can reach, for example `http://vote.school.local:8080` (see "Let other devices reach it").
2. Open that address. Make a multi-booth poll with the organiser code. Save the admin link that the page shows. This browser also lists the poll on its home page.
3. Send the **booth link** to one booth host in each class. Send the booth password in a separate message.
4. Each class opens the link on a tablet or a laptop. Each pupil taps the choices in order. A class with no device can count hands, and the host enters the totals.
5. When the time is up, press **Close voting** on the admin page. Wait until every booth shows "All received". Press **Finalise results**.
6. Share the overall result on the school screens. Each booth shows its own result too.

## Settings

Set these with `-e NAME=value`, or in `compose.yaml`.

| Name | Default | What it does |
|---|---|---|
| `CREATE_CODE` | none | The organiser code. A person needs it to make a poll. **Set it.** Without it, anyone who can reach the server can make polls. |
| `PORT` | `8080` | The port inside the container. Change the left side of `-p` to change the port on the host. |
| `DATA_DIR` | `/data` | The folder for the database file `quick-vote.db`. |
| `ALLOW_INDEXING` | off | By default the server tells search engines not to index it. Set to `1` for a public site. |
| `ALLOWED_ORIGIN` | `*` | Only matters if you serve the site from a different address than the server. |

## Let other devices reach it

- **Find the address.** On the server, find its network name or IP address, for example `192.168.1.20`. Other devices open `http://192.168.1.20:8080`.
- **Open the port.** Allow port 8080 in the server's firewall.
- **Use HTTPS if you can.** On plain `http://`, booth passwords travel across the network without encryption, and the browser does not offer the offline cache of the site. A booth still works, and it still saves votes when the signal drops. For a school network, put a reverse proxy with a certificate in front of the container. For example, with Caddy:

  ```
  vote.example.org {
      reverse_proxy localhost:8080
  }
  ```

  Any proxy works (Caddy, nginx, Traefik). It must pass every path to the container. Then close port 8080 to the network, so that people use the HTTPS address.
- **Do not put it on the internet without HTTPS.**

## Data and backups

- The database is one file, `quick-vote.db`, in the volume `quick-vote-data`.
- To back it up, stop the container first, so that the file is complete:

  ```sh
  docker stop quick-vote
  docker run --rm -v quick-vote-data:/data -v "$PWD":/backup alpine tar czf /backup/quick-vote-backup.tgz -C /data .
  docker start quick-vote
  ```
- To restore, put the files back in the volume while the container is stopped.
- To delete everything: `docker rm -f quick-vote && docker volume rm quick-vote-data`.

## Update

```sh
git pull
docker build -t quick-vote .
docker rm -f quick-vote
# run the "docker run" command from the quick start again
```

The data stays in the volume. With Compose: `docker compose up -d --build`.

## Podman notes

- Rootless Podman works. The container runs as an unprivileged user (`node`).
- Podman's default image format ignores the `HEALTHCHECK` line. To keep it, build with `podman build --format docker -t quick-vote .`.
- On a system with SELinux, add `:Z` to a bind mount: `-v /srv/quick-vote:/data:Z`. A named volume needs no change.
- To start the container at boot, use `--restart unless-stopped` with a Podman service, or write a Quadlet unit.

## How it works

`server/index.mjs` is a small Node server. It serves the site files, and it runs the **same API code** as the Cloudflare Worker (`worker/src/index.js`). `server/d1-sqlite.mjs` is a small adapter that gives that code the database calls that it expects, on top of Node's built-in SQLite. The browser tests (`npm run test:browser:node`) run every test against this server.

The server serves only the site files, and it sets `X-Robots-Tag: noindex` (unless `ALLOW_INDEXING=1`) and a few safety headers.

## Security checklist

- Set `CREATE_CODE`.
- Use HTTPS if the server is reachable by more than a trusted room or network.
- Keep the admin link private. It is the only key to the results.
- Back up the volume, and keep the backup private. It holds all polls and ballots.
- Update the image when a new version is released.
