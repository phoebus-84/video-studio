// A real HTTP boundary for the AWS SDK and spawned CLI; no credentials or external service needed.
import { createHash } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export async function fakeS3() {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const requests: { method: string; key: string; headers: IncomingHttpHeaders; query: string }[] = [];
  const control = { corrupt: false, headStatus: 0, failParts: false, aborts: 0 };
  let sequence = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const key = decodeURIComponent(url.pathname.replace(/^\/media\//, ""));
    const method = req.method!;
    requests.push({ method, key, headers: req.headers, query: url.search });
    const xml = (status: number, body: string) => {
      res.writeHead(status, { "content-type": "application/xml" });
      res.end(body);
    };
    const error = (status: number, code: string) => xml(status, `<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
    try {
      if (method === "HEAD") {
        if (control.headStatus) { res.writeHead(control.headStatus); res.end(); return; }
        const found = objects.get(key);
        res.writeHead(found ? 200 : 404, found ? { "content-length": found.length } : {});
        res.end(); return;
      }
      if (method === "GET") {
        const found = objects.get(key);
        if (!found) { error(404, "NoSuchKey"); return; }
        res.writeHead(200, { "content-length": found.length });
        res.end(control.corrupt ? Buffer.alloc(found.length, "X") : found);
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      if (method === "POST" && url.searchParams.has("uploads")) {
        const id = String(++sequence);
        uploads.set(id, { key, parts: new Map() });
        xml(200, `<InitiateMultipartUploadResult><Bucket>media</Bucket><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
        return;
      }
      const id = url.searchParams.get("uploadId");
      if (id) {
        const upload = uploads.get(id);
        if (!upload) { error(404, "NoSuchUpload"); return; }
        if (method === "DELETE") {
          control.aborts++;
          uploads.delete(id);
          res.writeHead(204); res.end(); return;
        }
        if (method === "PUT") {
          if (control.failParts) { error(400, "InvalidPart"); return; }
          upload.parts.set(Number(url.searchParams.get("partNumber")), body);
          res.writeHead(200, { etag: `"part-${upload.parts.size}"`, "x-amz-checksum-sha256": createHash("sha256").update(body).digest("base64") });
          res.end(); return;
        }
        if (method === "POST") {
          // As Garage does: the checksum type belongs to CreateMultipartUpload, not to completion.
          if (req.headers["x-amz-checksum-type"]) { error(400, "InvalidRequest"); return; }
          if (objects.has(key) && req.headers["if-none-match"] === "*") { error(412, "PreconditionFailed"); return; }
          objects.set(key, Buffer.concat([...upload.parts].sort(([a], [b]) => a - b).map(([, data]) => data)));
          uploads.delete(id);
          xml(200, `<CompleteMultipartUploadResult><Location>http://localhost/media/${key}</Location><Bucket>media</Bucket><Key>${key}</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>`);
          return;
        }
      }
      if (method === "PUT") {
        if (objects.has(key) && req.headers["if-none-match"] === "*") { error(412, "PreconditionFailed"); return; }
        const expected = req.headers["x-amz-checksum-sha256"];
        if (expected && expected !== createHash("sha256").update(body).digest("base64")) { error(400, "BadDigest"); return; }
        objects.set(key, body);
        res.writeHead(200, { etag: '"object"' }); res.end(); return;
      }
      error(400, "UnexpectedRequest");
    } catch (cause) { error(500, String(cause)); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    objects, uploads, requests, control,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
