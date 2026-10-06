# Codocs

[한국어](README.ko.md)

Codocs connects code to project knowledge stored in local `.codocs` YAML files. Record domain terms, business rules, and development conventions once, then use the same knowledge in VS Code and your AI assistant.

- **MCP:** Let your AI assistant find, read, create, and update project knowledge.
- **VS Code:** Follow explicit `@codocs` and document links, and navigate back to the code references.

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

| Tool              | Purpose                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `codocs_list`     | Explore root documents and direct children with section names                                                       |
| `codocs_get`      | Read a document or section by `name` or `name:section`, with references and revisions                               |
| `codocs_write`    | Create documents, or update, replace, delete or move them using a read revision, singly or in one `changes` request |
| `codocs_rename`   | Preview and apply a document or section rename together with the references that point to it                        |
| `codocs_validate` | Check documents and `@codocs` references in code files for errors and warnings                                      |
| `codocs_refresh`  | Rebuild the project's document and code reference indexes                                                           |
| `codocs_guide`    | Read guidance for writing, updating, and recovering documents                                                       |

For example, ask your assistant to “find the definition of an order,” “check the project documents for errors,” or “document this business rule.” When updating a document, the assistant first reads it with `codocs_get`, then passes the revision to `codocs_write` to change parts of it (`update`) or to replace the whole document (`replace`, where sections you leave out are deleted); it can also delete (`delete`) or move (`move`) a document. To change several documents at once, send them as `changes`: the final state is validated once and everything is saved or nothing is, and a failure while saving is rolled back. A change that would newly break a reference from another document or from an `@codocs` mark in a code file is rejected without saving. To rename a document or one of its sections (pass `section`), the assistant previews with `codocs_rename` and then applies the previewed result; `codocs_write` does not change a document's name.

## VS Code

### Installation

Requires desktop **VS Code 1.100.0 or later**. Search for `seojaewan.codocs` in Extensions, or run:

```sh
code --install-extension seojaewan.codocs@0.0.1
```

If you have a VSIX file, install it with **Extensions: Install from VSIX...**. The extension includes its language server and uses VS Code's built-in runtime, so no separate Node.js installation is needed.

Open the project folder containing `.codocs` to start using the extension.

### Features

- **Document diagnostics:** Check YAML syntax, the `_codocs` metadata and sections, duplicate IDs and names, parent links, and reference errors in `.codocs` documents.
- **Document links:** Navigate to resolved `[[Document name]]` references, or `[[Document name:Section]]` references to a section of a document, in any section of a document.
- **Document and section rename:** Rename a document or a section (F2 on a name, a section key, or a reference) and update the references that point to it, including `@codocs` references in code files.
- **Explicit code links:** Write `@codocs [[Document name]]` or `@codocs [[Document name:Section]]` in project text to link to a document or to one of its sections. Text after the closing `]]`, such as `#L11`, is not part of the reference.
- **Reverse code references:** Hover a section key to list the code that references that section, or hover the `_codocs.name` value to list the code that references the whole document. Each item opens that code location, and `코드 N곳` next to the section key or on the first row shows only the count.
- **Workspace support:** Use separate project knowledge for each folder in a multi-folder workspace. Document changes are reflected automatically.

If you need to reconnect after resolving a server problem, run **Codocs: Restart Language Servers** from the Command Palette.

## Write your first document

Create `.codocs/order.yaml` in your project:

```yaml
_codocs:
  id: order
  name: Order
Overview: |
  An order records a customer's purchase and its fulfillment rules.
```

Link code to the document with `@codocs [[Order]]` in a comment, or ask your AI assistant to retrieve it through MCP. A document is a `_codocs` object with `id`, `name`, and an optional `parent`, plus one or more sections; each section name is a key whose value is text. Use document references such as `[[Order]]`, or section references such as `[[Order:Cancellation]]`, in any section to connect related knowledge. Codocs does not connect a document just because a variable or function has the same name.

See the [writing guide](docs/guide/README.md) and [sample project](examples/.codocs) for more examples. The detailed guide and sample project are currently in Korean.

## Links

- [Report an issue](https://github.com/SeoJaeWan/codocs/issues)
- [Development documentation](https://github.com/SeoJaeWan/codocs/blob/main/.codocs/index.yaml)

## License

[MIT](LICENSE). Bundled dependency licenses are included in `dist/THIRD-PARTY-NOTICES.txt` and, for the VSIX server, `dist/server/THIRD-PARTY-NOTICES.txt`.
