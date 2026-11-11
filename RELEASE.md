# Releasing PlotForge

Configure these repository Actions secrets for `wdk08/PlotForge`. The private key must match the public key in `src-tauri/tauri.conf.json`.

| Secret | Value |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the PlotForge updater private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for that key |

The initial key and its password are stored outside the checkout in `~/Library/Application Support/PlotForge/Release Signing/`. To load them without printing their contents, run the following from a terminal authenticated as a repository administrator.

```sh
gh secret set TAURI_SIGNING_PRIVATE_KEY -R wdk08/PlotForge < "$HOME/Library/Application Support/PlotForge/Release Signing/plotforge.key"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD -R wdk08/PlotForge < "$HOME/Library/Application Support/PlotForge/Release Signing/plotforge-password.txt"
```

Keep a secure backup of the signing files. Released copies use this key to verify future updates.

## First release

Review and commit the PlotForge release source, then push `main`. Once `main` is clean and synchronized and both secrets exist, run `npm run release -- --first` to validate and tag the existing 1.0.0 commit.

## Later releases

Run `npm run release` from clean, synchronized `main`. Choose patch, minor, major, or enter a stable custom version. The command synchronizes version files and runs browser build and native tests. Confirm the displayed tag to commit the version, create the tag, and push them atomically.

Watch the [PlotForge release workflow](https://github.com/wdk08/PlotForge/actions/workflows/release.yml) for Apple Silicon and Intel macOS DMGs and the Windows x64 NSIS installer. The workflow keeps the release in draft until all signed updater packages, their versions, and the three installer links pass validation. Download the installers from [GitHub Releases](https://github.com/wdk08/PlotForge/releases).

Updater signatures authenticate PlotForge updates independently of OS signing. This workflow uses ad-hoc macOS signing and an unsigned Windows publisher identity. Gatekeeper and Windows reputation or application-control settings can require local approval or block installation.
