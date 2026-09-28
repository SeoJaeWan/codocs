# Codocs

[한국어](README.ko.md)

Codocs connects code to project knowledge stored in local `.codocs` YAML files. Record domain terms, business rules, and development conventions once, then use the same knowledge in VS Code and your AI assistant.

- **MCP:** Let your AI assistant find, read, create, and update project knowledge.
- **VS Code:** Hover over code identifiers, follow explicit document links, and navigate back to the exact code references.

Use either integration on its own, or both. Codocs supports projects on local disks on Windows and macOS. Document names and content can be written in any language.

## MCP

### Installation

Requires **Node.js 24.x**. Install the package in a directory of your choice:

```sh
npm install co-documentation@0.0.1
```

In your MCP client's configuration, set the installed executable and the **absolute path to your project**:

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

Replace `/absolute/install` with the directory where you ran `npm install`. `--project` points to the project folder containing `.codocs`.

On Windows, use `C:\\absolute\\install\\node_modules\\.bin\\codocs.cmd` as the JSON command value. If your client cannot run `.cmd` files, set `command` to `node` and pass the absolute path to `node_modules/co-documentation/dist/runtime/cli.js` as the first argument, followed by `--project` and your project path. Client configuration formats vary; use a local stdio connection with these arguments.

### Available tools

| Tool              | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `codocs_list`     | Find documents using filters and paginated results            |
| `codocs_get`      | Read document content, references, and revisions              |
| `codocs_write`    | Create documents or update them using a read revision         |
| `codocs_validate` | Check documents for errors and warnings                       |
| `codocs_refresh`  | Rebuild the project's knowledge index                         |
| `codocs_guide`    | Read guidance for writing, updating, and recovering documents |

Changed saves also return `writeImpact`: saved code occurrences that may be affected, their reasons, and collection/calculation completeness. Review these notices before editing code; explicit row numbers are never moved automatically. A notice failure does not undo a successful save.

For example, ask your assistant to “find the definition of an order,” “check the project documents for errors,” or “document this business rule.” When updating a document, the assistant first reads it with `codocs_get`, then passes its revision to `codocs_write`.

## VS Code

### Installation

Requires desktop **VS Code 1.100.0 or later**. Search for `seojaewan.codocs` in Extensions, or run:

```sh
code --install-extension seojaewan.codocs@0.0.1
```

If you have a VSIX file, install it with **Extensions: Install from VSIX...**. The extension includes its language server and uses VS Code's built-in runtime, so no separate Node.js installation is needed.

Open the project folder containing `.codocs` to start using the extension.

### Features

- **Code hover:** Read a matching document's name, definition, and domain by hovering over an English code identifier.
- **Source navigation:** Open the original YAML document from a hover link.
- **Related knowledge:** Follow links to referenced documents, documents that refer to the current one, and other terms matched in the identifier.
- **Document diagnostics:** Check YAML syntax, required fields, duplicate IDs, and reference errors in `.codocs` documents.
- **Document links:** Navigate to resolved `[[Document name]]` references in YAML content.
- **Explicit code links:** Write `@codocs [[Document name]]`, `@codocs [[Document name]]#L11`, or `@codocs [[Domain:Document name]]#L11-L12` anywhere in eligible text. Links use saved YAML names and one-based, inclusive physical rows. Invalid markers show the reason.
- **Code references:** Navigate from a YAML row to its exact code marker. Multiple occurrences have separate path/row/column hover links. Whole-document references appear as an Inlay Hint before the first row; use the IDE navigation gesture for a single occurrence. The hint follows `editor.inlayHints.enabled`.
- **Workspace support:** Use separate project knowledge for each folder in a multi-folder workspace. Document changes are reflected automatically.

Unsaved source edits replace their saved observations. Navigation preserves dirty target buffers and selects the explicit numeric rows only if both exist. Tracked Git text is included even when ignored; untracked text follows project and nested `.gitignore` rules. Non-Git projects follow the untracked rules. Binary files, links/junctions, `.git`, and files outside the project are excluded. Disk text uses UTF-8. Collection in progress or incomplete collection shows confirmed counts and reasons without claiming a unique link or absence.

If you need to reconnect after resolving a server problem, run **Codocs: Restart Language Servers** from the Command Palette.

## Write your first document

Create `.codocs/order.yaml` in your project:

```yaml
id: order
name: Order
domains: [Sales]
definition: |
  An order records a customer's purchase and its fulfillment rules.
```

Hover over the `order` identifier in code to read its definition, or ask your AI assistant to retrieve it through MCP. Use document references such as `[[Order]]` to connect related knowledge.

See the [writing guide](docs/guide/README.md) and [sample project](examples/.codocs) for more examples. The detailed guide and sample project are currently in Korean.

## Links

- [Report an issue](https://github.com/SeoJaeWan/codocs/issues)
- [Development documentation](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml)

## License

[MIT](LICENSE). Bundled dependency licenses are included in `dist/THIRD-PARTY-NOTICES.txt` and, for the VSIX server, `dist/server/THIRD-PARTY-NOTICES.txt`.
