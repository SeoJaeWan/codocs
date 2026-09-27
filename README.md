# Codocs

[한국어](README.ko.md)

Codocs connects code to project knowledge stored in local `.codocs` YAML files. Developers see definitions and source links when hovering over English code identifiers in VS Code. AI assistants use the same knowledge through MCP. Document names and bodies can use any language.

**0.0.1 is an unpublished release candidate.** Publication, publisher permissions, and final Windows/macOS verification are separate release gates. The commands below install local candidate files.

## Install the candidate

Choose MCP, the VS Code extension, or both.

### MCP

Install **Node.js 24.x**, then install the supplied tarball in a directory of your choice:

```sh
npm install /absolute/path/co-documentation-0.0.1.tgz
```

The single package includes the runtime and dependencies. It needs no monorepo, internal tarballs, TypeScript loader, or extra build. Its executable is `codocs`.

Configure a local stdio MCP client with the installed executable and an **absolute project path**:

```json
{
  "mcpServers": {
    "codocs": {
      "command": "/absolute/install/node_modules/.bin/codocs",
      "args": ["--project", "/absolute/path/my-project"]
    }
  }
}
```

On Windows, use `C:\absolute\install\node_modules\.bin\codocs.cmd` in the command field (double backslashes in JSON). Client configuration formats vary; choose stdio and supply the same command and arguments. If a client cannot launch Windows command wrappers, use `node` with the installed `node_modules/co-documentation/dist/runtime/cli.js` path followed by the same arguments.

`--project` selects the directory containing `.codocs`, not the knowledge folder itself. Without it, the server uses its startup working directory. Relative paths resolve from that directory; it does not search parent directories for a project. stdout is reserved for MCP messages; startup/failure messages go to stderr. Disconnecting stdin closes the server and watchers.

After separately approved publication, the pinned registry package will be `co-documentation@0.0.1`. Availability and account rights must be checked before using that route.

### VS Code

In desktop **VS Code 1.100.0 or later**, run **Extensions: Install from VSIX...** and select `codocs-0.0.1.vsix`. The extension ID is `seojaewan.codocs`, version `0.0.1`.

Open the project folder containing `.codocs`. Hover over a matching English code identifier to read its definition and follow the source link to YAML. The VSIX includes its language server and uses VS Code's built-in runtime; a separate system Node installation is not required for the extension.

Each workspace folder has its own server and index. In nested workspaces, a file belongs to its nearest containing workspace folder. Files outside workspace folders are not matched. A missing `.codocs` is not created automatically; adding it later starts indexing.

## Write and use knowledge

Start with the [writing guide](docs/guide/README.md) and [sample project](examples/.codocs). The detailed guide and examples are currently in Korean; full translation is separate work.

Create `.codocs/order.yaml`:

```yaml
id: order
name: Order
domains: [Sales]
definition: |
  An order records a customer's purchase and its fulfillment rules.
```

The identifier `order` can connect code to this document. Codocs provides knowledge and references; it does not rename code automatically or judge compliance with natural-language policies.

| MCP tool          | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `codocs_list`     | List documents using filters and cursors                                |
| `codocs_get`      | Read current IDs, source, references, and revisions                     |
| `codocs_refresh`  | Rebuild the index and recover after an indexing failure                 |
| `codocs_validate` | Inspect project or file diagnostics                                     |
| `codocs_write`    | Create documents or update using a read revision                        |
| `codocs_guide`    | Read writing, updating, and recovery guidance independently of indexing |

Before updating, read with `codocs_get` and use that response's revision. On conflict, read again and review the change; never substitute a new revision blindly. Disk save and index refresh are separate results. If saving succeeded but indexing failed, preserve the saved file, fix the cause, then call `codocs_refresh`. While preparation or refresh is running, wait instead of repeatedly restarting. See [updating](docs/guide/updating.md) and [validation](docs/guide/validation.md).

After fixing a VS Code server startup problem, run **Codocs: Restart Language Servers**. Inspect Codocs output and status details for the affected workspace. Document parse/access failures and server connection failures are distinct.

## Support and limits

Release targets are local disks on Windows and macOS. Results apply only to tested OS, CPU, Node, and VS Code versions. This candidate does **not** claim final two-OS or latest-stable verification. Linux, WSL, containers, SSH/remote workspaces, and network shares are outside the current support scope.

0.0.1 is experimental. Code completion, automatic source renaming, semantic search, remote MCP, and cross-process transactional writes are not promised. Writers check revisions but provide no cross-process lock or transaction; coordinate concurrent edits and inspect conflicts.

Performance goals at 1,000 documents (initial readiness 2 seconds, p95 hover/MCP reads 100 ms, change propagation 500 ms) are reference targets, not measurements or guarantees. Final candidate measurements and unmeasured cases must be reported separately.

## Build and verify

Use the Node version in `.node-version` and pnpm `10.34.5`:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm release:pack
pnpm release:verify /absolute/path/co-documentation-0.0.1.tgz /absolute/path/codocs-0.0.1.vsix
pnpm test:vscode --vsix /absolute/path/codocs-0.0.1.vsix --mcp-tgz /absolute/path/co-documentation-0.0.1.tgz
node packages/vscode/test-runner/lifecycle.mjs --vsix /absolute/path/codocs-0.0.1.vsix
```

`release:pack` builds once into a unique `.workbench/release/candidate-*` directory and records file hashes in `release.json`. Verification consumes the supplied files without rebuilding. The standalone verifier installs one tarball offline outside the repository and runs the installed bin over stdio. Internal package consumer checks remain in `pnpm check`.

Without artifact arguments, the VS Code and lifecycle runners build/package current source. They use isolated profiles and may display real windows. `--vscode-version x.y.z` pins the version; `node packages/vscode/test-runner/run.mjs --resolve-version stable` resolves a version to pin. Performance uses the same runner with `--mode performance`; see `pnpm bench --help`. Windows symlink tests require permission or Developer Mode; preparation failure is not a pass.

Normal commit hooks format staged files and check installation, types, lint, build, and logic in an isolated staged-tree copy. IDE, lifecycle, package-consumer, and performance evidence is collected separately. See the [project knowledge index](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml) for private package boundaries and contribution rules. Internal packages do not become a public JavaScript API.

## License

MIT — see [LICENSE](LICENSE). Bundled dependency licenses are in `dist/THIRD-PARTY-NOTICES.txt` and, for the VSIX server, `dist/server/THIRD-PARTY-NOTICES.txt`.
