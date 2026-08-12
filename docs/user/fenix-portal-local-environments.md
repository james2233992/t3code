# Local environments in the Fenix portal

The Fenix portal can use a Fenix Code server running on your own computer. The
browser remains connected to the current `iaonline.io` origin; the local server
opens an outbound companion tunnel, so the browser does not need direct access
to `localhost`.

## Pair a computer

1. Open Code Lab and go to **Settings > Connections > Add Environment**.
2. Select **Local computer**, choose its display name, and create the one-time
   pairing command.
3. Run that command from a local folder you want Fenix Code to access.
4. Restart the local Fenix Code server. The paired computer appears as another
   environment alongside the existing remote connection modes.

The initial command authorizes only its current directory. Add another local
root from that computer with:

```bash
t3 fenix root add /absolute/path/to/workspaces
```

## Add projects

Use the standard **Add Project** flow after selecting the local environment.
It supports:

- an existing folder under an authorized local root;
- an absolute local Git path or `file://` URL under an authorized root;
- a remote HTTPS, HTTP, SSH, Git, or scp-style repository URL.

Clones must also land under an authorized local root. Canonical paths are
checked before the operation and again after cloning, so symlinks cannot be
used to escape the configured roots.

## Security boundary

- Pairing and browser tickets are short-lived and issued by the authenticated
  Code Lab control plane.
- The durable device credential is stored atomically with mode `0600` in the
  local Fenix Code state directory.
- Company and user identity come only from the server-issued pairing envelope;
  project paths and RPC payloads cannot choose their tenant scope.
- Local workspace registration does not enable terminal, arbitrary VCS,
  provider settings, setup scripts, or custom CLI execution for a Fenix-scoped
  browser session.
