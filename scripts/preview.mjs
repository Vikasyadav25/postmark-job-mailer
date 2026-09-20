import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = createServer(async (req, res) => {
  if (req.url !== "/" && req.url !== "/index.html") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const [index, styles, client, demo] = await Promise.all(
      [
        "Index.html",
        "Styles.html",
        "Client.html",
        "scripts/preview-demo.js",
      ].map((file) => readFile(resolve(root, file), "utf8")),
    );
    const html = index
      .replace(
        "<?!= include_('Styles'); ?>",
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          styles,
      )
      .replace(
        "<?!= include_('Client'); ?>",
        "<script>" + demo + "</script>" + client,
      );
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end("Could not load preview files.");
  }
});
server.listen(4173, "127.0.0.1", () =>
  console.log(
    "Local UI preview: http://127.0.0.1:4173 — sample data only; sending disabled.",
  ),
);
